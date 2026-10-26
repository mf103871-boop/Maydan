import AVFoundation
import CallKit
import LiveKit
import PushKit
import Security
import UIKit
import UserNotifications

/// One account and one audio call per installation. The native call engine owns
/// audio while WebKit is suspended; the web interface only renders its snapshot.
@MainActor
final class SocialCoordinator: NSObject {
    static let shared = SocialCoordinator()
    let session = SocialSession()
    private let voice = SocialVoiceRecorder()
    private let controller = CXCallController()
    private var provider: CXProvider!
    private var registry: PKPushRegistry?
    private var room: Room?
    private var microphoneQueue = NativeMicrophoneTransitionQueue()
    private var call: NativeCall?
    private var callPoll: Task<Void, Never>?
    private var callAuthorizationWatchdog: Task<Void, Never>?
    private var lastCallAuthorization: TimeInterval = 0
    private var callAuthorizationFailures = 0
    private var pushTokens: [String: String] = [:]
    private var pendingEvents: [(String, [String: Any])] = []
    private var webReady = false
    private var bootstrapped = false
    private var observers: [NSObjectProtocol] = []
    private var audioActive = false
    private var audioPolicy = NativeAudioPolicy()
    private var muted = false
    private var speaker = false
    private var preferredSpeaker = false
    private var privateTurn = UserDefaults.standard.bool(forKey: NativeConfig.shared.scopedStorageKey("maydan.social.privateTurn"))
    private var gameCommunicationLocked = false
    private var state = "idle"
    private var signingOut = false
    private var accountGeneration = 0
    private var callGeneration = 0
    private var pendingCallId: UUID?
    private var mafiaEndingCallId: UUID?
    var onEvent: ((String, [String: Any]) -> Void)?
    var onAudioActivityChange: (() -> Void)?
    var onAudioLifecycle: (([String: Any]) -> Void)?
    var isBusyForAppUpdate: Bool { call != nil || pendingCallId != nil || voice.isBusy }

    private struct NativeCall {
        let id: UUID
        let conversationId: String
        let scope: String
        let name: String
        let incoming: Bool
        let userId: String
        var connection: (url: String, token: String)?
        var mediaEpoch: Int = -1
        var canPublish: Bool = true
        var quiet: Bool = false
        var voiceSessionId: String = ""
    }

    func bootstrap() {
        guard !bootstrapped else { return }
        bootstrapped = true
        let config = CXProviderConfiguration(localizedName: "ميدان")
        config.supportsVideo = false
        config.maximumCallsPerCallGroup = 1
        config.maximumCallGroups = 1
        config.supportedHandleTypes = [.generic]
        config.includesCallsInRecents = false
        provider = CXProvider(configuration: config)
        provider.setDelegate(self, queue: .main)
        AudioManager.shared.audioSession.isAutomaticConfigurationEnabled = false
        try? AudioManager.shared.setEngineAvailability(.none)
        UNUserNotificationCenter.current().delegate = self
        session.onRotation = { [weak self] userId, token, previousToken in
            self?.emit("socialSessionRotated", ["userId": userId, "token": token, "previousToken": previousToken], retain: true)
            Task { @MainActor [weak self] in await self?.registerTokens() }
        }
        voice.onEvent = { [weak self] payload in self?.emit("socialVoice", payload) }
        voice.onSessionReleased = { [weak self] in self?.restoreGameAudio() }
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init(rawValue:)) else { return }
            let options = AVAudioSession.InterruptionOptions(rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            Task { @MainActor in
                guard let self else { return }
                if type == .began {
                    self.audioPolicy.interruptionBegan()
                    self.voice.cancel(state: "interrupted")
                    let currentRoom = self.room, callId = self.call?.id
                    if callId != nil {
                        self.muted = true
                        try? AudioManager.shared.setEngineAvailability(.none)
                    }
                    self.audioLifecycle("interruption-began", shouldResume: false)
                    _ = try? await self.changeMicrophone(enabled: false, in: currentRoom)
                    if self.call?.id == callId { self.emitCall(error: "AUDIO_INTERRUPTED") }
                } else {
                    let shouldResume = options.contains(.shouldResume)
                    self.audioPolicy.interruptionEnded(shouldResume: shouldResume)
                    self.restoreCurrentAudio()
                    self.audioLifecycle("interruption-ended", shouldResume: shouldResume && self.audioPolicy.resumeAllowed)
                }
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt).flatMap(AVAudioSession.RouteChangeReason.init(rawValue:))
            Task { @MainActor in
                guard let self else { return }
                self.speaker = AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .builtInSpeaker }
                self.emitCall()
                // Ignore category/override changes caused by our own setup.
                if reason == .newDeviceAvailable { self.preferredSpeaker = false; self.restoreCurrentAudio(); self.audioLifecycle("session-restored") }
                else if reason == .oldDeviceUnavailable { self.audioPolicy.holdForUserGesture(); self.audioLifecycle("session-restored", shouldResume: false) }
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereLostNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.audioPolicy.interruptionBegan()
                self.voice.cancel(state: "interrupted")
                let currentRoom = self.room
                if self.call != nil { self.muted = true; try? AudioManager.shared.setEngineAvailability(.none); self.emitCall(error: "AUDIO_SESSION") }
                self.audioLifecycle("interruption-began", shouldResume: false)
                _ = try? await self.changeMicrophone(enabled: false, in: currentRoom)
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.voice.cancel(state: "interrupted")
                self.audioPolicy.mediaServicesReset()
                let currentRoom = self.room
                if self.call != nil { self.muted = true; self.emitCall(error: "AUDIO_SESSION") }
                try? AudioManager.shared.setEngineAvailability(.none)
                self.restoreCurrentAudio()
                self.audioLifecycle("media-reset")
                _ = try? await self.changeMicrophone(enabled: false, in: currentRoom)
            }
        })
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.audioPolicy.enteredBackground()
                self.voice.cancel(state: "interrupted")
                if self.audioOwner == .blocked { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
                self.audioLifecycle("background", shouldResume: false)
            }
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.audioPolicy.becameActive()
                self.restoreCurrentAudio()
                self.audioLifecycle("foreground")
                await self.registerTokens()
            }
        })
        // Establish PushKit before the web app loads. The Keychain credential may
        // be needed to answer a call delivered into a cold/locked application.
        if session.credential != nil { enablePushRegistry() }
        if UIApplication.shared.applicationState == .active { audioPolicy.becameActive(); restoreGameAudio() }
    }

    private var audioOwner: NativeAudioPolicy.Owner {
        audioPolicy.owner(hasCall: call != nil, pendingCall: pendingCallId != nil, recorderBusy: voice.isBusy)
    }

    private func audioLifecycle(_ state: String, shouldResume: Bool? = nil) {
        onAudioLifecycle?(["state": state, "shouldResume": shouldResume ?? (!audioPolicy.interrupted && audioPolicy.resumeAllowed), "owner": audioOwner.rawValue])
    }

    // Playback uses a known baseline after recording/call categories are gone.
    // CallKit remains the sole owner of activating a live call session.
    private func restoreGameAudio() {
        guard audioOwner == .game else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
            audioLifecycle("session-restored")
        } catch { audioLifecycle("session-restored", shouldResume: false) }
    }

    private func restoreCallOutput() throws {
        guard call != nil, audioPolicy.canRecoverCall(callKitActive: audioActive) else { throw SocialNativeError.failed("AUDIO_SESSION") }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .mixWithOthers])
        let availability = AudioManager.shared.engineAvailability
        try AudioManager.shared.setEngineAvailability(AudioEngineAvailability(isInputAvailable: availability.isInputAvailable && !muted && !privateTurn, isOutputAvailable: true))
        // Reapply a speaker override only when the user selected it. Preserve
        // headset/Bluetooth routing otherwise, including after interruptions.
        if preferredSpeaker { try session.overrideOutputAudioPort(.speaker) }
    }

    private func restoreCurrentAudio() {
        if audioOwner == .call { try? restoreCallOutput() }
        else { restoreGameAudio() }
    }

    func webAudioReady() {
        if UIApplication.shared.applicationState == .active && !audioPolicy.foreground { audioPolicy.becameActive() }
        restoreCurrentAudio()
    }

    func resumeGameAudioFromGesture() {
        guard UIApplication.shared.applicationState == .active, !audioPolicy.interrupted,
              call == nil, pendingCallId == nil, !voice.isBusy else { return }
        audioPolicy.becameActive()
        audioPolicy.userRequestedPlayback()
        restoreGameAudio()
    }

    func webDidReload() { webReady = false }

    func handle(_ command: String, payload: [String: Any]) async throws -> [String: Any] {
        bootstrap()
        guard !signingOut || ["socialStoredSession", "socialSession", "socialLogout"].contains(command) else { throw SocialNativeError.failed("AUTH_REQUIRED") }
        switch command {
        case "socialStoredSession":
            var snapshot = session.snapshot()
            snapshot["call"] = callSnapshot()
            return snapshot
        case "socialSession":
            accountGeneration += 1
            let attempt = accountGeneration
            guard let userId = payload["userId"] as? String, let token = payload["token"] as? String else { throw SocialNativeError.failed("AUTH_REQUIRED") }
            if let previous = session.credential, previous.userId != userId { await logout() }
            guard attempt == accountGeneration else { throw SocialNativeError.failed("AUTH_REQUIRED") }
            try session.set(userId: userId, token: token)
            webReady = true
            let retained = pendingEvents
            pendingEvents.removeAll()
            for (event, data) in retained { emit(event, data) }
            emitCall()
            enablePushRegistry()
            Task { await registerTokens() }
            var result = session.snapshot()
            result["call"] = callSnapshot()
            return result
        case "socialLogout":
            accountGeneration += 1
            await logout()
            return ["cleared": true]
        case "socialNotifications":
            guard session.credential != nil else { throw SocialNativeError.failed("AUTH_REQUIRED") }
            let center = UNUserNotificationCenter.current()
            if payload["request"] as? Bool == true {
                let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
                if granted { UIApplication.shared.registerForRemoteNotifications() }
            }
            let settings = await center.notificationSettings()
            let granted = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
            if granted { UIApplication.shared.registerForRemoteNotifications() }
            return ["authorized": granted, "status": settings.authorizationStatus.rawValue, "deviceId": session.deviceId]
        case "socialCallConnect":
            if payload["scope"] as? String == "mafia" { return try await connectMafia(payload) }
            guard !gameCommunicationLocked else { throw SocialNativeError.failed("AUDIO_PRIVATE") }
            guard let userId = session.credential?.userId,
                  let rawId = payload["callId"] as? String, let id = UUID(uuidString: rawId),
                  let conversationId = Self.identifier(payload["conversationId"]),
                  let url = payload["url"] as? String, let parsed = URL(string: url),
                  parsed.scheme == "wss", parsed.host?.hasSuffix(".livekit.cloud") == true, parsed.user == nil, parsed.password == nil,
                  let token = payload["token"] as? String, (32...16_384).contains(token.count) else {
                throw SocialNativeError.failed("CALL_INVALID")
            }
            guard call == nil || call?.id == id else { throw SocialNativeError.failed("CALL_BUSY") }
            guard payload["userId"] as? String == nil || payload["userId"] as? String == userId else { throw SocialNativeError.failed("AUTH_REQUIRED") }
            callGeneration += 1
            let attempt = callGeneration
            pendingCallId = id
            defer { if pendingCallId == id { pendingCallId = nil }; restoreGameAudio() }
            voice.cancel()
            guard await SocialVoiceRecorder.permission() else { throw SocialNativeError.failed("MICROPHONE_DENIED") }
            guard !signingOut, session.credential?.userId == userId, attempt == callGeneration else { throw SocialNativeError.failed("CALL_CANCELLED") }
            guard call == nil || call?.id == id else { throw SocialNativeError.failed("CALL_BUSY") }
            if call?.id == id {
                call?.connection = (url, token)
                if call?.incoming == true && state == "ringing" { try await transaction(CXAnswerCallAction(call: id)) }
                else { try await connectRoom() }
            } else {
                call = NativeCall(id: id, conversationId: conversationId,
                                  scope: payload["scope"] as? String == "group" ? "group" : "direct",
                                  name: String((payload["callerName"] as? String ?? "مكالمة ميدان").prefix(80)),
                                  incoming: false, userId: userId, connection: (url, token))
                muted = privateTurn || (payload["muted"] as? Bool ?? false)
                state = "connecting"
                let action = CXStartCallAction(call: id, handle: CXHandle(type: .generic, value: call!.name))
                action.isVideo = false
                do { try await transaction(action) } catch { await finish(reason: .failed, expectedCallId: id); throw error }
            }
            return callSnapshot()
        case "socialCallMute":
            guard let current = call else { throw SocialNativeError.failed("CALL_NOT_FOUND") }
            guard payload["callId"] as? String == nil || payload["callId"] as? String == current.id.uuidString.lowercased() else { throw SocialNativeError.failed("CALL_NOT_FOUND") }
            let value = payload["muted"] as? Bool ?? true
            if !value && current.scope == "mafia" && (!current.canPublish || current.quiet) { throw SocialNativeError.failed("AUDIO_PRIVATE") }
            try await transaction(CXSetMutedCallAction(call: current.id, muted: value))
            return callSnapshot()
        case "socialCallResumeAudio":
            guard let current = call, session.credential?.userId == current.userId,
                  payload["callId"] as? String == current.id.uuidString.lowercased() else { throw SocialNativeError.failed("CALL_NOT_FOUND") }
            if payload["userInitiated"] as? Bool == true { audioPolicy.userRequestedPlayback() }
            try restoreCallOutput()
            emitCall()
            return callSnapshot()
        case "socialCallSpeaker":
            guard let current = call else { throw SocialNativeError.failed("CALL_NOT_FOUND") }
            guard payload["callId"] as? String == nil || payload["callId"] as? String == current.id.uuidString.lowercased() else { throw SocialNativeError.failed("CALL_NOT_FOUND") }
            let requestedSpeaker = payload["speaker"] as? Bool ?? false
            try AVAudioSession.sharedInstance().overrideOutputAudioPort(requestedSpeaker ? .speaker : .none)
            preferredSpeaker = requestedSpeaker
            speaker = requestedSpeaker
            emitCall()
            return callSnapshot()
        case "socialCallEnd":
            if let expected = payload["expectedVoiceSessionId"] as? String, call?.scope == "mafia", call?.voiceSessionId != expected { return callSnapshot() }
            if let expected = payload["expectedMediaEpoch"] as? Int, call?.scope == "mafia", call?.mediaEpoch != expected { return callSnapshot() }
            if let target = payload["callId"] as? String,
               target != call?.id.uuidString.lowercased(), target != pendingCallId?.uuidString.lowercased() {
                return ["state": "ended"]
            }
            callGeneration += 1
            pendingCallId = nil
            if let current = call {
                if payload["localOnly"] as? Bool == true {
                    let endReason = payload["endReason"] as? String ?? "local-ended"
                    await finish(reason: endReason == "ownership-lost" ? .answeredElsewhere : .remoteEnded,
                                 endReason: endReason, expectedCallId: current.id)
                } else {
                    do { try await transaction(CXEndCallAction(call: current.id)) }
                    catch { await finish(reason: .remoteEnded, notifyServer: true, expectedCallId: current.id) }
                }
            }
            return ["state": "ended"]
        case "socialCallPauseGame":
            guard let current = call, current.scope == "mafia", payload["callId"] as? String == current.id.uuidString.lowercased() else { return ["state": "idle"] }
            if let expected = payload["expectedMediaEpoch"] as? Int, expected != current.mediaEpoch { return callSnapshot() }
            await pauseMafiaTransport()
            return callSnapshot()
        case "socialVoiceStart":
            guard session.credential != nil else { throw SocialNativeError.failed("AUTH_REQUIRED") }
            guard call == nil, !privateTurn, !gameCommunicationLocked else { throw SocialNativeError.failed("AUDIO_BUSY") }
            return try await voice.start(id: Self.identifier(payload["recordingId"]) ?? UUID().uuidString.lowercased())
        case "socialVoiceStop":
            guard payload["recordingId"] as? String == nil || payload["recordingId"] as? String == voice.recordingId else { throw SocialNativeError.failed("AUDIO_NOT_RECORDING") }
            return try voice.stop()
        case "socialVoiceCancel":
            if payload["recordingId"] as? String == nil || payload["recordingId"] as? String == voice.recordingId { voice.cancel() }
            return ["state": "cancelled"]
        case "socialAudioPrivacy":
            privateTurn = payload["privateTurn"] as? Bool ?? false
            gameCommunicationLocked = payload["communicationLocked"] as? Bool ?? false
            UserDefaults.standard.set(privateTurn, forKey: NativeConfig.shared.scopedStorageKey("maydan.social.privateTurn"))
            if privateTurn {
                audioPolicy.invalidateMicrophoneChange()
                voice.cancel(state: "interrupted")
                muted = true
                if audioActive { try? AudioManager.shared.setEngineAvailability(AudioEngineAvailability(isInputAvailable: false, isOutputAvailable: true)) }
                _ = try? await changeMicrophone(enabled: false, in: room)
                emitCall()
            }
            return ["privateTurn": privateTurn, "muted": muted]
        default: throw SocialNativeError.failed("CALL_INVALID")
        }
    }

    // Every media epoch is issued by the game server after revoking the previous
    // audience. CallKit keeps the same call; the underlying LiveKit room changes.
    private func connectMafia(_ payload: [String: Any]) async throws -> [String: Any] {
        guard let userId = session.credential?.userId,
              let rawId = payload["callId"] as? String, let id = UUID(uuidString: rawId),
              let code = payload["conversationId"] as? String,
              code.range(of: "^[0-9]{6}$", options: .regularExpression) != nil,
              let voiceSessionId = payload["voiceSessionId"] as? String, UUID(uuidString: voiceSessionId) != nil,
              let mediaEpoch = payload["mediaEpoch"] as? Int, mediaEpoch >= 0 else { throw SocialNativeError.failed("CALL_INVALID") }
        guard mafiaEndingCallId != id else { throw SocialNativeError.failed("CALL_ENDING") }
        guard payload["userId"] as? String == nil || payload["userId"] as? String == userId else { throw SocialNativeError.failed("AUTH_REQUIRED") }
        guard call == nil || (call?.id == id && call?.scope == "mafia") else { throw SocialNativeError.failed("CALL_BUSY") }
        if let current = call, mediaEpoch < current.mediaEpoch { return callSnapshot() }
        let quiet = payload["quiet"] as? Bool ?? true
        let mayPublish = payload["canPublish"] as? Bool == true && !quiet
        var connection: (url: String, token: String)?
        if !quiet {
            guard let url = payload["url"] as? String, let parsed = URL(string: url), parsed.scheme == "wss",
                  parsed.host?.hasSuffix(".livekit.cloud") == true, parsed.user == nil, parsed.password == nil,
                  let token = payload["token"] as? String, (32...16_384).contains(token.count) else { throw SocialNativeError.failed("CALL_INVALID") }
            connection = (url, token)
        }
        if let current = call, current.voiceSessionId == voiceSessionId, current.mediaEpoch == mediaEpoch, room != nil, !quiet { return callSnapshot() }
        if let current = call, current.voiceSessionId == voiceSessionId, current.mediaEpoch == mediaEpoch, current.quiet, quiet, state == "silent" { return callSnapshot() }
        callGeneration += 1
        let attempt = callGeneration
        let existing = call != nil
        audioPolicy.invalidateMicrophoneChange(); voice.cancel()
        muted = true
        // Store the epoch before suspension so a late HTTP/bridge response can
        // never reconnect an older audience with the same CallKit identifier.
        if existing {
            call?.mediaEpoch = mediaEpoch; call?.canPublish = mayPublish; call?.quiet = quiet; call?.connection = connection
            call?.voiceSessionId = voiceSessionId
            let old = room; room = nil
            try? AudioManager.shared.setEngineAvailability(AudioEngineAvailability(isInputAvailable: false, isOutputAvailable: audioActive))
            state = "connecting"; emitCall()
            await old?.disconnect()
        } else {
            call = NativeCall(id: id, conversationId: code, scope: "mafia", name: "مافيا ميدان", incoming: false,
                              userId: userId, connection: connection, mediaEpoch: mediaEpoch, canPublish: mayPublish, quiet: quiet, voiceSessionId: voiceSessionId)
        }
        guard !signingOut, session.credential?.userId == userId, attempt == callGeneration, call?.mediaEpoch == mediaEpoch else { throw SocialNativeError.failed("CALL_CANCELLED") }
        // Listening never requests microphone permission. Unmuting is an
        // explicit user action and the server independently enforces publishing.
        let recordingGranted: Bool
        if #available(iOS 17.0, *) {
            recordingGranted = AVAudioApplication.shared.recordPermission == .granted
        } else {
            recordingGranted = AVAudioSession.sharedInstance().recordPermission == .granted
        }
        if payload["muted"] as? Bool == false && mayPublish && !privateTurn && recordingGranted { muted = false }
        state = quiet ? "silent" : "connecting"
        if existing {
            if quiet { emitCall(); pollCall() } else { try await connectRoom() }
        } else {
            let action = CXStartCallAction(call: id, handle: CXHandle(type: .generic, value: "مافيا ميدان"))
            action.isVideo = false
            do { try await transaction(action) }
            catch { await finish(reason: .failed, expectedCallId: id); throw error }
        }
        return callSnapshot()
    }

    private func pauseMafiaTransport() async {
        guard call?.scope == "mafia" else { return }
        callGeneration += 1; audioPolicy.invalidateMicrophoneChange()
        muted = true; call?.canPublish = false; call?.quiet = true; call?.connection = nil
        let old = room; room = nil
        state = "reconnecting"
        try? AudioManager.shared.setEngineAvailability(AudioEngineAvailability(isInputAvailable: false, isOutputAvailable: audioActive))
        emitCall()
        await old?.disconnect()
    }

    private func syncMafiaCall(_ current: NativeCall) async throws {
        let knownEpoch = room == nil && state != "silent" ? -1 : current.mediaEpoch
        let response = try await session.request("/api/rooms/\(current.conversationId)/voice", body:
            ["deviceId": session.deviceId, "voiceSessionId": current.voiceSessionId, "operation": "sync", "knownEpoch": knownEpoch])
        guard !Task.isCancelled, let live = call, live.id == current.id, live.userId == current.userId, live.voiceSessionId == current.voiceSessionId else { return }
        guard let remote = response["call"] as? [String: Any], remote["id"] as? String == current.id.uuidString.lowercased(),
              response["voiceSessionId"] as? String == current.voiceSessionId,
              let epoch = response["mediaEpoch"] as? Int, epoch >= live.mediaEpoch else { return }
        lastCallAuthorization = ProcessInfo.processInfo.systemUptime; callAuthorizationFailures = 0
        if response["unchanged"] as? Bool == true && epoch == live.mediaEpoch { return }
        let connection = response["connection"] as? [String: Any] ?? [:]
        var payload: [String: Any] = ["callId": current.id.uuidString.lowercased(), "userId": current.userId,
            "conversationId": current.conversationId, "mediaEpoch": epoch, "canPublish": response["canPublish"] as? Bool ?? false,
            "quiet": response["quiet"] as? Bool ?? true, "muted": true, "voiceSessionId": current.voiceSessionId]
        payload["url"] = connection["url"]; payload["token"] = connection["token"]
        _ = try await connectMafia(payload)
    }

    private func enablePushRegistry() {
        if registry == nil {
            let registry = PKPushRegistry(queue: .main)
            registry.delegate = self
            registry.desiredPushTypes = [.voIP]
            self.registry = registry
        }
        Task { @MainActor in
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    func registeredAPNs(_ data: Data) {
        pushTokens["apns"] = data.map { String(format: "%02x", $0) }.joined()
        Task { await registerTokens() }
    }

    func registrationFailed() { emit("socialNotificationStatus", ["error": "NOTIFICATIONS_UNAVAILABLE"]) }

    func openNotification(_ data: [AnyHashable: Any]) {
        guard let current = session.credential,
              data["recipientId"] as? String == current.userId else { return }
        var event: [String: Any] = ["userId": current.userId]
        if let conversationId = Self.identifier(data["conversationId"]) {
            event["conversationId"] = conversationId
            event["scope"] = data["scope"] as? String == "group" ? "group" : "direct"
        } else if let category = data["category"] as? String, ["friendRequests", "groupInvites"].contains(category) {
            event["category"] = category
            event["view"] = category == "friendRequests" ? "requests" : "groups"
        } else { return }
        if let id = data["callId"] as? String, UUID(uuidString: id) != nil { event["callId"] = id }
        emit("socialNotification", event, retain: true)
    }

    private var pushEnvironment: String {
        let environment = Bundle.main.object(forInfoDictionaryKey: "MaydanPushEnvironment") as? String
        return environment == "production" ? "production" : "sandbox"
    }

    private func registerTokens() async {
        guard session.credential != nil else { return }
        for (kind, token) in pushTokens {
            do {
                _ = try await session.request("/api/social/devices", method: "PUT", body: [
                    "deviceId": session.deviceId, "token": token, "kind": kind, "environment": pushEnvironment
                ])
                emit("socialDeviceToken", ["deviceId": session.deviceId, "kind": kind, "environment": pushEnvironment, "registered": true])
            } catch { emit("socialNotificationStatus", ["error": Self.errorCode(error)]) }
        }
    }

    private func logout() async {
        signingOut = true
        gameCommunicationLocked = false
        callGeneration += 1
        pendingCallId = nil
        let previous = session.credential
        let previousCall = call
        // Revoke local access before any potentially slow network operation.
        session.clear()
        voice.cancel()
        await finish(reason: .remoteEnded)
        registry?.desiredPushTypes = []
        registry?.delegate = nil
        registry = nil
        UIApplication.shared.unregisterForRemoteNotifications()
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        UIApplication.shared.applicationIconBadgeNumber = 0
        pendingEvents.removeAll()
        webReady = false
        signingOut = false
        if let previous { Task { @MainActor in
            if let previousCall {
                let operation = previousCall.incoming && previousCall.connection == nil ? "reject" : "leave"
                _ = try? await session.request("/api/social/calls/\(previousCall.id.uuidString.lowercased())/\(operation)", body: ["deviceId": session.deviceId], retiring: previous)
            }
            _ = try? await session.request("/api/social/devices/\(session.deviceId)", method: "DELETE", retiring: previous)
        } }
    }

    private func transaction(_ action: CXAction) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            controller.request(CXTransaction(action: action)) { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume() }
            }
        }
    }

    private func changeMicrophone(enabled: Bool, in target: Room?,
                                  requiresCurrentPreference: Bool = false,
                                  commit: @escaping @MainActor () -> Void = {}) async throws -> Bool {
        guard let target, let callId = call?.id, room === target else { return false }
        let generation = audioPolicy.microphoneGeneration
        let queue = microphoneQueue
        return try await queue.change(isValid: { [weak self] in
            guard let self, self.call?.id == callId, self.room === target else { return false }
            return self.audioPolicy.acceptsMicrophoneChange(generation, muted: !enabled,
                callKitActive: self.audioActive, privateTurn: self.privateTurn)
                && (!enabled || (self.call?.canPublish != false && self.call?.quiet != true))
                && (!requiresCurrentPreference || enabled == (!self.muted && !self.privateTurn))
        }, publish: { [weak self] in
            guard let self else { return }
            // The queue calls this synchronously after validating ownership.
            try AudioManager.shared.setEngineAvailability(AudioEngineAvailability(isInputAvailable: enabled,
                isOutputAvailable: self.audioPolicy.canRecoverCall(callKitActive: self.audioActive)))
            _ = try await target.localParticipant.setMicrophone(enabled: enabled)
        }, commit: commit, retire: { [weak self] in
            // Retire SDK publication in its captured room. Global state may be
            // touched only while that room and account/call still own it. Do not
            // invalidate a newer intent: it runs after this cleanup in the queue.
            if let self, self.call?.id == callId, self.room === target {
                self.muted = true
                try? AudioManager.shared.setEngineAvailability(AudioEngineAvailability(isInputAvailable: false,
                    isOutputAvailable: self.audioPolicy.canRecoverCall(callKitActive: self.audioActive)))
            }
            _ = try? await target.localParticipant.setMicrophone(enabled: false)
        })
    }

    private func connectRoom() async throws {
        if let current = call, current.scope == "mafia", current.quiet {
            guard session.credential?.userId == current.userId else { throw SocialNativeError.failed("AUTH_REQUIRED") }
            // A quiet night is an authorized connected match, not an outgoing
            // telephone call that should keep ringing until the next daytime.
            if !current.incoming { provider.reportOutgoingCall(with: current.id, connectedAt: Date()) }
            state = "silent"; emitCall(); pollCall(); return
        }
        guard let current = call, let connection = current.connection, session.credential?.userId == current.userId else {
            throw SocialNativeError.failed("AUTH_REQUIRED")
        }
        if room != nil { return }
        state = "connecting"
        emitCall()
        let next = Room(delegate: self)
        room = next
        microphoneQueue = NativeMicrophoneTransitionQueue()
        try await next.connect(url: connection.url, token: connection.token)
        guard call?.id == current.id, room === next else { await next.disconnect(); return }
        let attemptedMicrophone = audioActive && !muted && !privateTurn
        let microphoneGeneration = audioPolicy.microphoneGeneration
        if audioActive {
            do { _ = try await changeMicrophone(enabled: attemptedMicrophone, in: next, requiresCurrentPreference: true) }
            catch {
                // A capture failure leaves the connected call muted/retryable.
                // It must not end a call after a newer microphone intent wins.
                if call?.id == current.id, room === next, audioPolicy.microphoneGeneration == microphoneGeneration {
                    emitCall(error: Self.errorCode(error))
                }
            }
        }
        guard call?.id == current.id, room === next else { await next.disconnect(); return }
        state = "connected"
        if !current.incoming { provider.reportOutgoingCall(with: current.id, connectedAt: Date()) }
        emitCall()
        pollCall()
    }

    private func pollCall() {
        callPoll?.cancel()
        callAuthorizationWatchdog?.cancel()
        lastCallAuthorization = ProcessInfo.processInfo.systemUptime
        callAuthorizationFailures = 0
        guard let callId = call?.id else { return }
        // Separate from HTTP polling: a request still awaiting its timeout must
        // not extend access after two failed checks and a minute without proof.
        callAuthorizationWatchdog = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard !Task.isCancelled, let self, self.call?.id == callId else { return }
                let game = self.call?.scope == "mafia"
                if (game || self.callAuthorizationFailures >= 2),
                   ProcessInfo.processInfo.systemUptime - self.lastCallAuthorization >= (game ? 4 : 60) {
                    if game {
                        if self.room != nil || self.call?.canPublish == true { await self.pauseMafiaTransport() }
                        self.emitCall(error: "MAFIA_VOICE_VERIFY")
                        continue
                    }
                    await self.finish(reason: .failed, endReason: "authorization-timeout", expectedCallId: callId)
                    return
                }
            }
        }
        callPoll = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: self?.call?.scope == "mafia" ? 1_000_000_000 : 5_000_000_000)
                guard !Task.isCancelled, let self, let current = self.call else { return }
                do {
                    if current.scope == "mafia" {
                        try await self.syncMafiaCall(current)
                        continue
                    }
                    let response = try await self.session.request("/api/social/calls/\(current.id.uuidString.lowercased())", method: "GET")
                    guard !Task.isCancelled, self.call?.id == current.id else { return }
                    guard let remote = response["call"] as? [String: Any] else { throw SocialNativeError.failed("NETWORK") }
                    let status = remote["status"] as? String ?? "ended"
                    let participants = remote["participants"] as? [[String: Any]] ?? []
                    let own = participants.first { $0["userId"] as? String == current.userId }
                    let device = own?["deviceId"] as? String
                    let ownState = own?["state"] as? String
                    if !["ringing", "active"].contains(status) ||
                        own == nil || !["active", "invited"].contains(ownState ?? "") ||
                        (device != nil && device != self.session.deviceId) {
                        let lost = device != nil && device != self.session.deviceId
                        await self.finish(reason: lost ? .answeredElsewhere : .remoteEnded,
                                          endReason: lost ? "ownership-lost" : "authorization-revoked", expectedCallId: current.id)
                        return
                    }
                    self.lastCallAuthorization = ProcessInfo.processInfo.systemUptime
                    self.callAuthorizationFailures = 0
                } catch {
                    guard !Task.isCancelled, self.call?.id == current.id else { return }
                    if ["AUTH_REQUIRED", "AUTH_EXPIRED", "ACCOUNT_SUSPENDED", "NOT_FOUND", "CALL_NOT_FOUND", "CALL_UNAVAILABLE", "CALL_FORBIDDEN", "FORBIDDEN", "BLOCKED", "CALL_ANSWERED", "MAFIA_VOICE_DEVICE", "MAFIA_ACTIVE_ELSEWHERE", "MAFIA_VOICE_SESSION"].contains(Self.errorCode(error)) {
                        await self.finish(reason: .remoteEnded, endReason: "authorization-revoked", expectedCallId: current.id)
                        return
                    }
                    self.callAuthorizationFailures += 1
                }
            }
        }
    }

    private func finish(reason: CXCallEndedReason, notifyServer: Bool = false, endReason: String? = nil, expectedCallId: UUID? = nil) async {
        guard let current = call else { return }
        guard expectedCallId == nil || expectedCallId == current.id else { return }
        callGeneration += 1
        if current.scope == "mafia" { mafiaEndingCallId = current.id }
        defer { if mafiaEndingCallId == current.id { mafiaEndingCallId = nil } }
        let endedReason = endReason ?? (reason == .answeredElsewhere ? "ownership-lost" : "call-ended")
        audioPolicy.invalidateMicrophoneChange()
        muted = true
        state = "ending"
        var ending = callSnapshot()
        ending["localOnly"] = !notifyServer
        ending["endReason"] = endedReason
        emit("socialCall", ending)
        try? AudioManager.shared.setEngineAvailability(.none)
        audioActive = false
        call = nil
        callPoll?.cancel()
        callPoll = nil
        callAuthorizationWatchdog?.cancel()
        callAuthorizationWatchdog = nil
        let previousRoom = room
        room = nil
        state = "ended"
        provider.reportCall(with: current.id, endedAt: Date(), reason: reason)
        await previousRoom?.disconnect()
        if call == nil {
            try? AudioManager.shared.setEngineAvailability(.none)
            audioActive = false
            muted = false
            speaker = false
            preferredSpeaker = false
            restoreGameAudio()
        }
        emit("socialCall", ["callId": current.id.uuidString.lowercased(), "conversationId": current.conversationId,
                            "userId": current.userId, "scope": current.scope, "state": "ended", "muted": true, "speaker": false, "participants": [],
                            "mediaEpoch": current.mediaEpoch, "canPublish": false, "quiet": true,
                            "voiceSessionId": current.voiceSessionId, "mediaGeneration": callGeneration,
                            "localOnly": !notifyServer, "endReason": endedReason])
        if notifyServer, session.credential?.userId == current.userId {
            if current.scope == "mafia" {
                _ = try? await session.request("/api/rooms/\(current.conversationId)/voice", body: ["deviceId": session.deviceId, "operation": "leave", "callId": current.id.uuidString.lowercased(), "voiceSessionId": current.voiceSessionId])
                return
            }
            let operation = current.incoming && current.connection == nil ? "reject" : "leave"
            _ = try? await session.request("/api/social/calls/\(current.id.uuidString.lowercased())/\(operation)", body: ["deviceId": session.deviceId])
        }
    }

    private func callSnapshot() -> [String: Any] {
        guard let call else { return ["state": "idle", "participants": []] }
        let participants: [Participant] = room.map { [$0.localParticipant as Participant] + $0.remoteParticipants.values.map { $0 as Participant } } ?? []
        return ["callId": call.id.uuidString.lowercased(), "conversationId": call.conversationId, "scope": call.scope,
                "userId": call.userId,
                "mediaEpoch": call.mediaEpoch, "canPublish": call.canPublish, "quiet": call.quiet,
                "voiceSessionId": call.voiceSessionId, "mediaGeneration": callGeneration,
                "state": state, "muted": muted, "speaker": speaker,
                "participants": participants.map { ["id": $0.identity?.stringValue ?? "", "name": $0.name ?? "", "speaking": $0.isSpeaking, "muted": !$0.isMicrophoneEnabled()] as [String: Any] }]
    }

    private func emitCall(error: String? = nil) {
        guard call != nil else { return }
        var payload = callSnapshot()
        if let error { payload["error"] = error }
        emit("socialCall", payload)
    }

    private func emit(_ event: String, _ payload: [String: Any], retain: Bool = false) {
        // Native foreground policy checks must also respect incoming calls that
        // arrive before the web bridge is ready to receive social events.
        if event == "socialCall" || event == "socialVoice" { onAudioActivityChange?() }
        if webReady { onEvent?(event, payload) }
        else if retain {
            pendingEvents.removeAll { $0.0 == event }
            pendingEvents.append((event, payload))
        }
    }

    static func errorCode(_ error: Error) -> String { (error as? SocialNativeError)?.code ?? "NETWORK" }
    private static func identifier(_ value: Any?) -> String? {
        guard let string = value as? String, (1...128).contains(string.count),
              string.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { return nil }
        return string
    }
}

extension SocialCoordinator: CXProviderDelegate {
    nonisolated func providerDidReset(_ provider: CXProvider) {
        Task { @MainActor in await self.finish(reason: .failed, notifyServer: true) }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        Task { @MainActor in
            guard self.call?.id == action.callUUID else { action.fail(); return }
            do {
                try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .mixWithOthers])
                provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
                action.fulfill()
                try await self.connectRoom()
            } catch {
                guard self.call?.id == action.callUUID else { return }
                self.emitCall(error: Self.errorCode(error))
                await self.finish(reason: .failed, notifyServer: true, expectedCallId: action.callUUID)
            }
        }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        Task { @MainActor in
            guard let current = self.call, current.id == action.callUUID else { action.fail(); return }
            var fulfilled = false
            do {
                guard await SocialVoiceRecorder.permission() else { throw SocialNativeError.failed("MICROPHONE_DENIED") }
                guard self.call?.id == current.id else { action.fail(); return }
                // Foreground acceptance already received scoped credentials from
                // the authenticated API before invoking CallKit. Only a cold or
                // lock-screen answer needs to make that request here.
                if current.connection == nil {
                    let response = try await self.session.request("/api/social/calls/\(current.id.uuidString.lowercased())/accept", body: ["deviceId": self.session.deviceId])
                    guard self.call?.id == current.id,
                          let connection = response["connection"] as? [String: String], let url = connection["url"],
                          URL(string: url)?.scheme == "wss", URL(string: url)?.host?.hasSuffix(".livekit.cloud") == true,
                          let token = connection["token"] else { throw SocialNativeError.failed("CALL_INVALID") }
                    self.call?.connection = (url, token)
                }
                guard self.call?.id == current.id, self.session.credential?.userId == current.userId else {
                    throw SocialNativeError.failed("AUTH_REQUIRED")
                }
                try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .mixWithOthers])
                action.fulfill()
                fulfilled = true
                try await self.connectRoom()
                guard self.call?.id == current.id else { return }
                self.emit("socialNotification", ["scope": current.scope, "conversationId": current.conversationId, "callId": current.id.uuidString.lowercased()], retain: true)
            } catch {
                if !fulfilled { action.fail() }
                guard self.call?.id == current.id else { return }
                self.emitCall(error: Self.errorCode(error))
                let answeredElsewhere = Self.errorCode(error) == "CALL_ANSWERED"
                await self.finish(reason: answeredElsewhere ? .answeredElsewhere : .failed, notifyServer: !answeredElsewhere, expectedCallId: current.id)
            }
        }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        Task { @MainActor in
            guard self.call?.id == action.callUUID else { action.fulfill(); return }
            action.fulfill()
            await self.finish(reason: .remoteEnded, notifyServer: true, expectedCallId: action.callUUID)
        }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        Task { @MainActor in
            guard self.call?.id == action.callUUID else { action.fail(); return }
            guard !self.privateTurn || action.isMuted else { action.fail(); return }
            if !action.isMuted, let current = self.call, current.scope == "mafia" {
                guard current.canPublish, !current.quiet else { action.fail(); return }
                guard await SocialVoiceRecorder.permission(), self.call?.id == current.id,
                      self.call?.voiceSessionId == current.voiceSessionId,
                      self.call?.mediaEpoch == current.mediaEpoch, self.call?.canPublish == true,
                      self.call?.quiet == false else { action.fail(); self.emitCall(error: "MICROPHONE_DENIED"); return }
            }
            guard !self.audioPolicy.interrupted || action.isMuted else { action.fail(); return }
            let currentRoom = self.room
            // Unmuting needs actual CallKit ownership. A UI request while the
            // call is activating must not promise an open microphone yet.
            guard action.isMuted || (self.audioActive && currentRoom != nil) else { action.fail(); return }
            let generation = self.audioPolicy.invalidateMicrophoneChange()
            if action.isMuted {
                self.muted = true
                try? AudioManager.shared.setEngineAvailability(AudioEngineAvailability(isInputAvailable: false,
                    isOutputAvailable: self.audioPolicy.canRecoverCall(callKitActive: self.audioActive)))
            } else { self.audioPolicy.userRequestedPlayback() }
            if currentRoom == nil { action.fulfill(); self.emitCall(); return }
            do {
                let completed = try await self.changeMicrophone(enabled: !action.isMuted, in: currentRoom) {
                    // Commit occurs inside the serialized room operation, only
                    // after its current-generation and ownership checks pass.
                    self.muted = action.isMuted
                    action.fulfill()
                    self.emitCall()
                }
                if !completed { action.fail() }
            } catch {
                action.fail()
                // Cleanup already completed INSIDE the queue. Never let this
                // caller's late continuation overwrite a newer completed intent.
                if self.call?.id == action.callUUID, self.room === currentRoom,
                   self.audioPolicy.microphoneGeneration == generation { self.emitCall(error: Self.errorCode(error)) }
            }
        }
    }

    nonisolated func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        Task { @MainActor in
            guard let callId = self.call?.id else { return }
            let activeRoom = self.room
            do {
                try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .mixWithOthers])
                self.audioPolicy.callKitActivated()
                try AudioManager.shared.setEngineAvailability(AudioEngineAvailability(isInputAvailable: false, isOutputAvailable: true))
                self.audioActive = true
                if activeRoom?.connectionState == .connected {
                    let generation = self.audioPolicy.microphoneGeneration
                    do { _ = try await self.changeMicrophone(enabled: !self.muted && !self.privateTurn, in: activeRoom, requiresCurrentPreference: true) }
                    catch {
                        if self.call?.id == callId, self.room === activeRoom, self.audioPolicy.microphoneGeneration == generation {
                            self.emitCall(error: Self.errorCode(error))
                        }
                    }
                }
                guard self.call?.id == callId, self.room === activeRoom else { return }
                self.audioLifecycle("session-restored")
            } catch {
                guard self.call?.id == callId, self.room === activeRoom else { return }
                self.emitCall(error: "AUDIO_SESSION")
                await self.finish(reason: .failed, notifyServer: true, expectedCallId: callId)
            }
        }
    }

    nonisolated func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        Task { @MainActor in
            self.audioPolicy.invalidateMicrophoneChange()
            self.audioActive = false
            try? AudioManager.shared.setEngineAvailability(.none)
            self.restoreGameAudio()
        }
    }

    nonisolated func provider(_ provider: CXProvider, timedOutPerforming action: CXAction) {
        action.fail()
        guard let callAction = action as? CXCallAction else { return }
        Task { @MainActor in await self.finish(reason: .failed, notifyServer: true, expectedCallId: callAction.callUUID) }
    }
}

extension SocialCoordinator: PKPushRegistryDelegate {
    nonisolated func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        guard type == .voIP else { return }
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in self.pushTokens["voip"] = token; await self.registerTokens() }
    }

    nonisolated func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        Task { @MainActor in
            self.pushTokens.removeValue(forKey: "voip")
            // The backend removes the installation's two token kinds, then the
            // valid ordinary token is registered again.
            _ = try? await self.session.request("/api/social/devices/\(self.session.deviceId)", method: "DELETE")
            await self.registerTokens()
        }
    }

    nonisolated func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload,
                                 for type: PKPushType, completion: @escaping () -> Void) {
        guard type == .voIP else { completion(); return }
        let data = payload.dictionaryPayload
        Task { @MainActor in
            let parsedId = (data["callId"] as? String).flatMap(UUID.init(uuidString:))
            let id = parsedId ?? UUID()
            let update = CXCallUpdate()
            update.localizedCallerName = "مكالمة ميدان"
            update.remoteHandle = CXHandle(type: .generic, value: "ميدان")
            update.hasVideo = false
            update.supportsHolding = false
            update.supportsGrouping = false
            update.supportsUngrouping = false
            update.supportsDTMF = false
            // Report before network work. Apple requires even stale/invalid VoIP
            // notifications to pass through CallKit, then end them immediately.
            self.provider.reportNewIncomingCall(with: id, update: update) { error in
                completion()
                Task { @MainActor in
                    guard error == nil else { return }
                    guard parsedId != nil, self.call == nil, !self.gameCommunicationLocked,
                          let auth = self.session.credential,
                          data["recipientId"] as? String == auth.userId,
                          let conversationId = Self.identifier(data["conversationId"]),
                          let expires = data["expiresAt"] as? Double, expires > Date().timeIntervalSince1970 * 1_000 else {
                        self.provider.reportCall(with: id, endedAt: Date(), reason: .unanswered)
                        return
                    }
                    self.voice.cancel(state: "interrupted")
                    self.call = NativeCall(id: id, conversationId: conversationId,
                        scope: data["scope"] as? String == "group" ? "group" : "direct", name: "مكالمة ميدان",
                        incoming: true, userId: auth.userId, connection: nil)
                    self.state = "ringing"
                    self.muted = self.privateTurn
                    self.emitCall()
                    self.pollCall()
                    Task { @MainActor in
                        let delay = min(60, max(1, expires / 1_000 - Date().timeIntervalSince1970))
                        try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                        if self.call?.id == id, self.state == "ringing" { await self.finish(reason: .unanswered, notifyServer: true) }
                    }
                }
            }
        }
    }
}

extension SocialCoordinator: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                           withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // The web social client handles foreground badges/toasts with game privacy
        // rules. Never display a second system banner over a hidden player role.
        completionHandler([])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                           withCompletionHandler completionHandler: @escaping () -> Void) {
        let data = response.notification.request.content.userInfo
        Task { @MainActor in
            defer { completionHandler() }
            self.openNotification(data)
        }
    }
}

extension SocialCoordinator: RoomDelegate {
    nonisolated func room(_ room: Room, didUpdateSpeakingParticipants participants: [Participant]) {
        Task { @MainActor in if self.room === room { self.emitCall() } }
    }
    nonisolated func room(_ room: Room, participantDidConnect participant: RemoteParticipant) {
        Task { @MainActor in if self.room === room { self.emitCall() } }
    }
    nonisolated func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        Task { @MainActor in if self.room === room { self.emitCall() } }
    }
    nonisolated func room(_ room: Room, participant: Participant, trackPublication: TrackPublication, didUpdateIsMuted isMuted: Bool) {
        Task { @MainActor in if self.room === room { self.emitCall() } }
    }
    nonisolated func room(_ room: Room, didStartReconnectWithMode reconnectMode: ReconnectMode) {
        Task { @MainActor in if self.room === room { self.state = "reconnecting"; self.emitCall() } }
    }
    nonisolated func room(_ room: Room, didCompleteReconnectWithMode reconnectMode: ReconnectMode) {
        Task { @MainActor in if self.room === room { self.state = "connected"; self.emitCall() } }
    }
    nonisolated func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        Task { @MainActor in
            if self.room === room, let current = self.call, current.scope == "mafia" {
                await self.pauseMafiaTransport()
                do { try await self.syncMafiaCall(current) }
                catch { self.callAuthorizationFailures += 1; self.emitCall(error: Self.errorCode(error)) }
                return
            }
            if self.room === room { await self.finish(reason: error == nil ? .remoteEnded : .failed, notifyServer: true) }
        }
    }
}
