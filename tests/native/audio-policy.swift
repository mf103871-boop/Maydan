@main
enum NativeAudioPolicyTests {
    static func main() {
        var checks = 0
        func expect(_ value: Bool, _ reason: String) {
            precondition(value, reason)
            checks += 1
        }
        var policy = NativeAudioPolicy()
        expect(policy.owner(hasCall: false, pendingCall: false, recorderBusy: false) == .blocked, "No game playback before foreground")
        policy.becameActive()
        expect(policy.owner(hasCall: false, pendingCall: false, recorderBusy: false) == .game, "Foreground can restore game")
        for call in [false, true] {
            for pending in [false, true] {
                for recorder in [false, true] {
                    let owner = policy.owner(hasCall: call, pendingCall: pending, recorderBusy: recorder)
                    expect((owner == .game) == (!call && !pending && !recorder), "A call, pending permission or recorder excludes game ownership")
                    if call || pending { expect(owner == .call, "CallKit ownership wins over a retiring recorder") }
                    else if recorder { expect(owner == .recording, "Pending recorder permission also owns the session") }
                }
            }
        }
        policy.enteredBackground()
        expect(policy.owner(hasCall: false, pendingCall: false, recorderBusy: false) == .blocked, "No background game audio")
        expect(policy.canRecoverCall(callKitActive: true), "An activated background call may recover output")
        expect(!policy.canRecoverCall(callKitActive: false), "Foreground cannot activate CallKit on its behalf")
        policy.interruptionBegan()
        policy.becameActive()
        expect(policy.interrupted, "Foreground does not override an ongoing interruption")
        expect(!policy.canRecoverCall(callKitActive: true), "No engine recovery during interruption")
        policy.interruptionEnded(shouldResume: false)
        policy.becameActive()
        expect(policy.owner(hasCall: false, pendingCall: false, recorderBusy: false) == .blocked, "No automatic restart when the OS denies resume")
        expect(!policy.canRecoverCall(callKitActive: true), "Call playback also respects OS resume permission")
        policy.userRequestedPlayback()
        expect(policy.owner(hasCall: false, pendingCall: false, recorderBusy: false) == .game, "A later user gesture permits game recovery")
        expect(policy.canRecoverCall(callKitActive: true), "Explicit playback recovery still requires CallKit activation")
        policy.interruptionBegan()
        policy.userRequestedPlayback()
        expect(!policy.canRecoverCall(callKitActive: true), "A gesture cannot override a live phone interruption")
        policy.interruptionEnded(shouldResume: true)
        expect(policy.owner(hasCall: false, pendingCall: false, recorderBusy: false) == .game, "Permitted interruption end restores foreground playback")
        policy.enteredBackground()
        policy.interruptionBegan()
        policy.mediaServicesReset()
        expect(policy.owner(hasCall: false, pendingCall: false, recorderBusy: false) == .blocked, "Media reset does not start game audio in the background")
        expect(policy.canRecoverCall(callKitActive: true), "Media reset can restore an activated background call's output")
        policy.interruptionBegan()
        policy.callKitActivated()
        expect(policy.canRecoverCall(callKitActive: true), "An authoritative CallKit activation clears stale interruption state")
        expect(policy.owner(hasCall: false, pendingCall: false, recorderBusy: false) == .blocked, "CallKit activation cannot start a background game")
        policy.becameActive()
        expect(policy.owner(hasCall: false, pendingCall: true, recorderBusy: false) == .call, "Cancelling a recording for a pending call never restores game audio")
        expect(policy.owner(hasCall: false, pendingCall: false, recorderBusy: false) == .game, "A failed/cancelled call releases the foreground session")
        policy.holdForUserGesture()
        policy.enteredBackground()
        policy.becameActive()
        policy.mediaServicesReset()
        expect(policy.owner(hasCall: false, pendingCall: false, recorderBusy: false) == .blocked, "Headphone hold survives foreground and media reset")
        policy.interruptionBegan()
        policy.interruptionEnded(shouldResume: true)
        expect(!policy.resumeAllowed, "A later interruption hint cannot clear an existing user-gesture hold")
        policy.userRequestedPlayback()
        expect(policy.owner(hasCall: false, pendingCall: false, recorderBusy: false) == .game, "Only actual user intent clears the held game playback")
        print("NativeAudioPolicy: \(checks) executable ownership/lifecycle checks passed")
    }
}
