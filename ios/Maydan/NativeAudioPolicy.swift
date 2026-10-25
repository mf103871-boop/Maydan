// Pure ownership decisions, shared by the UIKit lifecycle and native tests.
// Recovery never changes microphone consent or the user's mute preference.
struct NativeAudioPolicy {
    enum Owner: String { case game, call, recording, blocked }
    private(set) var foreground = false
    private(set) var interrupted = false
    private(set) var resumeAllowed = true
    private(set) var microphoneGeneration: UInt64 = 0

    mutating func becameActive() {
        foreground = true
    }
    mutating func enteredBackground() { foreground = false }
    mutating func interruptionBegan() { interrupted = true; invalidateMicrophoneChange() }
    mutating func interruptionEnded(shouldResume: Bool) { interrupted = false; resumeAllowed = resumeAllowed && shouldResume }
    mutating func mediaServicesReset() { interrupted = false; invalidateMicrophoneChange() }
    mutating func holdForUserGesture() { resumeAllowed = false; invalidateMicrophoneChange() }
    mutating func callKitActivated() { interrupted = false; resumeAllowed = true }
    mutating func userRequestedPlayback() { if !interrupted { resumeAllowed = true } }

    func owner(hasCall: Bool, pendingCall: Bool, recorderBusy: Bool) -> Owner {
        if hasCall || pendingCall { return .call }
        if recorderBusy { return .recording }
        return foreground && !interrupted && resumeAllowed ? .game : .blocked
    }
    func canRecoverCall(callKitActive: Bool) -> Bool {
        callKitActive && !interrupted && resumeAllowed
    }

    // An interruption can begin AND end while a microphone publication awaits.
    // Its old request must still be rejected after the Boolean state recovers.
    @discardableResult
    mutating func invalidateMicrophoneChange() -> UInt64 {
        microphoneGeneration &+= 1
        return microphoneGeneration
    }
    func acceptsMicrophoneChange(_ generation: UInt64, muted: Bool,
                                 callKitActive: Bool, privateTurn: Bool) -> Bool {
        generation == microphoneGeneration && (muted || (!privateTurn && canRecoverCall(callKitActive: callKitActive)))
    }
}

/// One queue per LiveKit room. Validation, publication, retirement and commit
/// are one serialized operation; a newer request cannot publish before an old
/// request's delayed cleanup finishes. A different room owns a different queue.
@MainActor
final class NativeMicrophoneTransitionQueue {
    private var tail: Task<Void, Never>?

    func change(isValid: @escaping @MainActor () -> Bool,
                publish: @escaping @MainActor () async throws -> Void,
                commit: @escaping @MainActor () -> Void,
                retire: @escaping @MainActor () async -> Void) async throws -> Bool {
        let previous = tail
        let transition = Task { @MainActor in
            await previous?.value
            guard isValid() else { return false }
            do { try await publish() }
            catch { await retire(); throw error }
            guard isValid() else { await retire(); return false }
            commit()
            return true
        }
        tail = Task { @MainActor in _ = try? await transition.value }
        return try await transition.value
    }
}
