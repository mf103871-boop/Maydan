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
    private var callAuthorizationWatchdog: Task<Void, Never>?
    private var lastCallAuthorization: TimeInterval = 0
    private var callAuthorizationFailures = 0
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
    private var accountGeneration = 0
    private var callGeneration = 0
    private var pendingCallId: UUID?
    var onEvent: ((String, [String: Any]) -> Void)?
    var onAudioActivityChange: (() -> Void)?
    var isBusyForAppUpdate: Bool { call != nil || pendingCallId != nil || voice.isRecording }

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
        session.onRotation = { [weak self] userId, token, previousToken in
            self?.emit("socialSessionRotated", ["userId": userId, "token": token, "previousToken": previousToken], retain: true)
            Task { @MainActor [weak self] in await self?.registerTokens() }
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
            defer { if pendingCallId == id { pendingCallId = nil } }
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
            try await transaction(CXSetMutedCallAction(call: current.id, muted: value))
            return callSnapshot()
        case "socialCallSpeaker":
            guard let current = call else { throw SocialNativeError.failed("CALL_NOT_FOUND") }
            guard payload["callId"] as? String == nil || payload["callId"] as? String == current.id.uuidString.lowercased() else { throw SocialNativeError.failed("CALL_NOT_FOUND") }
            speaker = payload["speaker"] as? Bool ?? false
            try AVAudioSession.sharedInstance().overrideOutputAudioPort(speaker ? .speaker : .none)
            emitCall()
            return callSnapshot()
        case "socialCallEnd":
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
        case "socialVoiceStart":
            guard session.credential != nil else { throw SocialNativeError.failed("AUTH_REQUIRED") }
            guard call == nil, !privateTurn else { throw SocialNativeError.failed("AUDIO_BUSY") }
            return try await voice.start(id: Self.identifier(payload["recordingId"]) ?? UUID().uuidString.lowercased())
        case "socialVoiceStop":
            guard payload["recordingId"] as? String == nil || payload["recordingId"] as? String == voice.recordingId else { throw SocialNativeError.failed("AUDIO_NOT_RECORDING") }
            return try voice.stop()
        case "socialVoiceCancel":
            if payload["recordingId"] as? String == nil || payload["recordingId"] as? String == voice.recordingId { voice.cancel() }
            return ["state": "cancelled"]
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

    private func connectRoom() async throws {
        guard let current = call, let connection = current.connection, session.credential?.userId == current.userId else {
            throw SocialNativeError.failed("AUTH_REQUIRED")
        }
        if room != nil { return }
        state = "connecting"
        emitCall()
        let next = Room(delegate: self)
        room = next
        try await next.connect(url: connection.url, token: connection.token)
        guard call?.id == current.id, room === next else { await next.disconnect(); return }
        if audioActive { try await next.localParticipant.setMicrophone(enabled: !muted) }
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
                if self.callAuthorizationFailures >= 2,
                   ProcessInfo.processInfo.systemUptime - self.lastCallAuthorization >= 60 {
                    await self.finish(reason: .failed, endReason: "authorization-timeout", expectedCallId: callId)
                    return
                }
            }
        }
        callPoll = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard !Task.isCancelled, let self, let current = self.call else { return }
                do {
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
                    if ["AUTH_REQUIRED", "AUTH_EXPIRED", "ACCOUNT_SUSPENDED", "NOT_FOUND", "CALL_NOT_FOUND", "CALL_UNAVAILABLE", "CALL_FORBIDDEN", "FORBIDDEN", "BLOCKED"].contains(Self.errorCode(error)) {
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
        let endedReason = endReason ?? (reason == .answeredElsewhere ? "ownership-lost" : "call-ended")
        muted = true
        state = "ending"
        var ending = callSnapshot()
        ending["localOnly"] = !notifyServer
        ending["endReason"] = endedReason
        emit("socialCall", ending)
        try? AudioManager.shared.setEngineAvailability(.none)
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
        }
        emit("socialCall", ["callId": current.id.uuidString.lowercased(), "conversationId": current.conversationId,
                            "userId": current.userId, "scope": current.scope, "state": "ended", "muted": true, "speaker": false, "participants": [],
                            "localOnly": !notifyServer, "endReason": endedReason])
        if notifyServer, session.credential?.userId == current.userId {
            let operation = current.incoming && current.connection == nil ? "reject" : "leave"
            _ = try? await session.request("/api/social/calls/\(current.id.uuidString.lowercased())/\(operation)", body: ["deviceId": session.deviceId])
        }
    }

    private func callSnapshot() -> [String: Any] {
        guard let call else { return ["state": "idle", "participants": []] }
        let participants: [Participant] = room.map { [$0.localParticipant as Participant] + $0.remoteParticipants.values.map { $0 as Participant } } ?? []
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
                let response = try await self.session.request("/api/social/calls/\(current.id.uuidString.lowercased())/accept", body: ["deviceId": self.session.deviceId])
                guard self.call?.id == current.id,
                      let connection = response["connection"] as? [String: String], let url = connection["url"],
                      URL(string: url)?.scheme == "wss", URL(string: url)?.host?.hasSuffix(".livekit.cloud") == true,
                      let token = connection["token"] else { throw SocialNativeError.failed("CALL_INVALID") }
                self.call?.connection = (url, token)
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
            guard let callId = self.call?.id else { return }
            do {
                try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .mixWithOthers])
                try AudioManager.shared.setEngineAvailability(.default)
                self.audioActive = true
                if self.room?.connectionState == .connected { _ = try await self.room?.localParticipant.setMicrophone(enabled: !self.muted) }
            } catch {
                guard self.call?.id == callId else { return }
                self.emitCall(error: "AUDIO_SESSION")
                await self.finish(reason: .failed, notifyServer: true, expectedCallId: callId)
            }
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
            if self.room === room { await self.finish(reason: error == nil ? .remoteEnded : .failed, notifyServer: true) }
        }
    }
}
