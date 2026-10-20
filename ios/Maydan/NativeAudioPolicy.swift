// Pure ownership decisions, shared by the UIKit lifecycle and native tests.
// Recovery never changes microphone consent or the user's mute preference.
struct NativeAudioPolicy {
    enum Owner: String { case game, call, recording, blocked }
    private(set) var foreground = false
    private(set) var interrupted = false
    private(set) var resumeAllowed = true

    mutating func becameActive() {
        foreground = true
    }
    mutating func enteredBackground() { foreground = false }
    mutating func interruptionBegan() { interrupted = true }
    mutating func interruptionEnded(shouldResume: Bool) { interrupted = false; resumeAllowed = resumeAllowed && shouldResume }
    mutating func mediaServicesReset() { interrupted = false }
    mutating func holdForUserGesture() { resumeAllowed = false }
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
}
