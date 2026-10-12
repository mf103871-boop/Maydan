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
    private var call: NativeCall?
    private var callPoll: Task<Void, Never>?
    private var pushTokens: [String: String] = [:]
    private var pendingEvents: [(String, [String: Any])] = []
    private var webReady = false
    private var bootstrapped = false
    private var observers: [NSObjectProtocol] = []
    private var audioActive = false
    private var muted = false
    private var speaker = false
    private var privateTurn = UserDefaults.standard.bool(forKey: "maydan.social.privateTurn")
    private var state = "idle"
    private var signingOut = false
    var onEvent: ((String, [String: Any]) -> Void)?

    private struct NativeCall {
        let id: UUID
        let conversationId: String
        let scope: String
        let name: String
        let incoming: Bool
        let userId: String
        var connection: (url: String, token: String)?
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
        session.onRotation = { [weak self] userId, token in
            self?.emit("socialSessionRotated", ["userId": userId, "token": token], retain: true)
        }
        voice.onEvent = { [weak self] payload in self?.emit("socialVoice", payload) }
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let began = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
            Task { @MainActor in
                guard let self, began else { return }
                self.voice.cancel(state: "interrupted")
                if self.call != nil {
                    self.muted = true
                    _ = try? await self.room?.localParticipant.setMicrophone(enabled: false)
                    self.emitCall(error: "AUDIO_INTERRUPTED")
                }
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.speaker = AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .builtInSpeaker }
                self.emitCall()
            }
        })
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.voice.cancel(state: "interrupted") }
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.registerTokens() }
        })
        // Establish PushKit before the web app loads. The Keychain credential may
        // be needed to answer a call delivered into a cold/locked application.
        if session.credential != nil { enablePushRegistry() }
    }

    func webDidReload() { webReady = false }

    func handle(_ command: String, payload: [String: Any]) async throws -> [String: Any] {
        bootstrap()
        guard !signingOut || command == "socialStoredSession" else { throw SocialNativeError.failed("AUTH_REQUIRED") }
        switch command {
        case "socialStoredSession": return session.snapshot()
        case "socialSession":
            guard let userId = payload["userId"] as? String, let token = payload["token"] as? String else { throw SocialNativeError.failed("AUTH_REQUIRED") }
            if let previous = session.credential, previous.userId != userId { await logout() }
            try session.set(userId: userId, token: token)
            webReady = true
            let retained = pendingEvents
            pendingEvents.removeAll()
            for (event, data) in retained { emit(event, data) }
            enablePushRegistry()
            await registerTokens()
            var result = session.snapshot()
            result["call"] = callSnapshot()
            return result
        case "socialLogout":
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
            guard let userId = session.credential?.userId,
                  let rawId = payload["callId"] as? String, let id = UUID(uuidString: rawId),
                  let conversationId = Self.identifier(payload["conversationId"]),
                  let url = payload["url"] as? String, let parsed = URL(string: url),
                  parsed.scheme == "wss", parsed.host?.hasSuffix(".livekit.cloud") == true, parsed.user == nil, parsed.password == nil,
                  let token = payload["token"] as? String, (32...16_384).contains(token.count) else {
                throw SocialNativeError.failed("CALL_INVALID")
            }
            guard call == nil || call?.id == id else { throw SocialNativeError.failed("CALL_BUSY") }
            voice.cancel()
            guard await SocialVoiceRecorder.permission() else { throw SocialNativeError.failed("MICROPHONE_DENIED") }
            guard !signingOut, session.credential?.userId == userId else { throw SocialNativeError.failed("AUTH_REQUIRED") }
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
                do { try await transaction(action) } catch { await finish(reason: .failed); throw error }
            }
            return callSnapshot()
        case "socialCallMute":
            guard let current = call else { throw SocialNativeError.failed("CALL_NOT_FOUND") }
            let value = payload["muted"] as? Bool ?? true
            try await transaction(CXSetMutedCallAction(call: current.id, muted: value))
            return callSnapshot()
        case "socialCallSpeaker":
            guard call != nil else { throw SocialNativeError.failed("CALL_NOT_FOUND") }
            speaker = payload["speaker"] as? Bool ?? false
            try AVAudioSession.sharedInstance().overrideOutputAudioPort(speaker ? .speaker : .none)
            emitCall()
            return callSnapshot()
        case "socialCallEnd":
            if let current = call {
                do { try await transaction(CXEndCallAction(call: current.id)) }
                catch { await finish(reason: .remoteEnded, notifyServer: true) }
            }
            return ["state": "ended"]
        case "socialVoiceStart":
            guard session.credential != nil else { throw SocialNativeError.failed("AUTH_REQUIRED") }
            guard call == nil, !privateTurn else { throw SocialNativeError.failed("AUDIO_BUSY") }
            return try await voice.start()
        case "socialVoiceStop": return try voice.stop()
        case "socialVoiceCancel": voice.cancel(); return ["state": "cancelled"]
        case "socialAudioPrivacy":
            privateTurn = payload["privateTurn"] as? Bool ?? false
            UserDefaults.standard.set(privateTurn, forKey: "maydan.social.privateTurn")
            if privateTurn {
                voice.cancel(state: "interrupted")
                muted = true
                _ = try? await room?.localParticipant.setMicrophone(enabled: false)
                emitCall()
            }
            return ["privateTurn": privateTurn, "muted": muted]
        default: throw SocialNativeError.failed("CALL_INVALID")
        }
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
        if let previous {
            if let previousCall {
                let operation = previousCall.incoming && previousCall.connection == nil ? "reject" : "leave"
                _ = try? await session.request("/api/social/calls/\(previousCall.id.uuidString.lowercased())/\(operation)", retiring: previous)
            }
            _ = try? await session.request("/api/social/devices/\(session.deviceId)", method: "DELETE", retiring: previous)
        }
        signingOut = false
    }

    private func transaction(_ action: CXAction) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            controller.request(CXTransaction(action: action)) { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume() }
            }
        }
    }

    private func connectRoom() async throws {
        guard let current = call, let connection = current.connection, session.credential?.userId == current.userId else {
            throw SocialNativeError.failed("AUTH_REQUIRED")
        }
        if room?.connectionState == .connected { return }
        state = "connecting"
        emitCall()
        let next = Room(delegate: self)
        room = next
        try await next.connect(url: connection.url, token: connection.token)
        guard call?.id == current.id, room === next else { await next.disconnect(); return }
        if audioActive { try await next.localParticipant.setMicrophone(enabled: !muted) }
        state = "connected"
        if !current.incoming { provider.reportOutgoingCall(with: current.id, connectedAt: Date()) }
        emitCall()
        pollCall()
    }

    private func pollCall() {
        callPoll?.cancel()
        callPoll = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard !Task.isCancelled, let self, let current = self.call else { return }
                do {
                    let response = try await self.session.request("/api/social/calls/\(current.id.uuidString.lowercased())", method: "GET")
                    guard self.call?.id == current.id else { return }
                    guard let remote = response["call"] as? [String: Any] else { continue }
                    let status = remote["status"] as? String ?? "ended"
                    let participants = remote["participants"] as? [[String: Any]] ?? []
                    let own = participants.first { $0["userId"] as? String == current.userId }
                    let device = own?["deviceId"] as? String
                    if ["ended", "rejected", "expired", "cancelled"].contains(status) ||
                        (device != nil && device != self.session.deviceId) {
                        await self.finish(reason: device != nil && device != self.session.deviceId ? .answeredElsewhere : .remoteEnded)
                        return
                    }
                } catch {
                    if ["AUTH_REQUIRED", "AUTH_EXPIRED", "NOT_FOUND", "CALL_NOT_FOUND", "CALL_FORBIDDEN", "FORBIDDEN", "BLOCKED"].contains(Self.errorCode(error)) {
                        await self.finish(reason: .remoteEnded)
                        return
                    }
                }
            }
        }
    }

    private func finish(reason: CXCallEndedReason, notifyServer: Bool = false) async {
        guard let current = call else { return }
        call = nil
        callPoll?.cancel()
        callPoll = nil
        let previousRoom = room
        room = nil
        state = "ended"
        provider.reportCall(with: current.id, endedAt: Date(), reason: reason)
        await previousRoom?.disconnect()
        try? AudioManager.shared.setEngineAvailability(.none)
        audioActive = false
        muted = false
        speaker = false
        emit("socialCall", ["callId": current.id.uuidString.lowercased(), "conversationId": current.conversationId,
                            "scope": current.scope, "state": "ended", "muted": false, "speaker": false, "participants": []])
        if notifyServer, session.credential?.userId == current.userId {
            let operation = current.incoming && previousRoom == nil ? "reject" : "leave"
            _ = try? await session.request("/api/social/calls/\(current.id.uuidString.lowercased())/\(operation)")
        }
    }

    private func callSnapshot() -> [String: Any] {
        guard let call else { return ["state": "idle", "participants": []] }
        let participants: [Participant] = room.map { [$0.localParticipant] + Array($0.remoteParticipants.values) } ?? []
        return ["callId": call.id.uuidString.lowercased(), "conversationId": call.conversationId, "scope": call.scope,
                "userId": call.userId,
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
                self.emitCall(error: Self.errorCode(error))
                await self.finish(reason: .failed, notifyServer: true)
            }
        }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        Task { @MainActor in
            guard let current = self.call, current.id == action.callUUID else { action.fail(); return }
            do {
                guard await SocialVoiceRecorder.permission() else { throw SocialNativeError.failed("MICROPHONE_DENIED") }
                let response = try await self.session.request("/api/social/calls/\(current.id.uuidString.lowercased())/accept", body: ["deviceId": self.session.deviceId])
                guard self.call?.id == current.id,
                      let connection = response["connection"] as? [String: String], let url = connection["url"],
                      URL(string: url)?.scheme == "wss", URL(string: url)?.host?.hasSuffix(".livekit.cloud") == true,
                      let token = connection["token"] else { throw SocialNativeError.failed("CALL_INVALID") }
                self.call?.connection = (url, token)
                try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .mixWithOthers])
                action.fulfill()
                try await self.connectRoom()
                self.emit("socialNotification", ["scope": current.scope, "conversationId": current.conversationId, "callId": current.id.uuidString.lowercased()], retain: true)
            } catch {
                action.fail()
                self.emitCall(error: Self.errorCode(error))
                await self.finish(reason: Self.errorCode(error) == "CALL_ANSWERED" ? .answeredElsewhere : .failed)
            }
        }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        Task { @MainActor in
            guard self.call?.id == action.callUUID else { action.fulfill(); return }
            action.fulfill()
            await self.finish(reason: .remoteEnded, notifyServer: true)
        }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        Task { @MainActor in
            guard self.call?.id == action.callUUID else { action.fail(); return }
            guard !self.privateTurn || action.isMuted else { action.fail(); return }
            do {
                self.muted = action.isMuted
                if self.audioActive { _ = try await self.room?.localParticipant.setMicrophone(enabled: !action.isMuted) }
                action.fulfill()
                self.emitCall()
            } catch { action.fail(); self.emitCall(error: Self.errorCode(error)) }
        }
    }

    nonisolated func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        Task { @MainActor in
            guard self.call != nil else { return }
            do {
                try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .mixWithOthers])
                try AudioManager.shared.setEngineAvailability(.default)
                self.audioActive = true
                if self.room?.connectionState == .connected { _ = try await self.room?.localParticipant.setMicrophone(enabled: !self.muted) }
            } catch { self.emitCall(error: "AUDIO_SESSION"); await self.finish(reason: .failed, notifyServer: true) }
        }
    }

    nonisolated func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        Task { @MainActor in
            self.audioActive = false
            try? AudioManager.shared.setEngineAvailability(.none)
        }
    }

    nonisolated func provider(_ provider: CXProvider, timedOutPerforming action: CXAction) {
        action.fail()
        Task { @MainActor in await self.finish(reason: .failed, notifyServer: true) }
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
                    guard parsedId != nil, self.call == nil,
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
            guard let current = self.session.credential,
                  data["recipientId"] as? String == current.userId,
                  let conversationId = Self.identifier(data["conversationId"]) else { return }
            var event: [String: Any] = ["conversationId": conversationId, "scope": data["scope"] as? String ?? "direct"]
            if let id = data["callId"] as? String, UUID(uuidString: id) != nil { event["callId"] = id }
            self.emit("socialNotification", event, retain: true)
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
            if self.room === room { await self.finish(reason: error == nil ? .remoteEnded : .failed, notifyServer: true) }
        }
    }
}
