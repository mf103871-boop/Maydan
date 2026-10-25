@MainActor
private final class MicrophoneGate {
    private var opened = false
    private var continuation: CheckedContinuation<Void, Never>?
    func wait() async {
        if opened { return }
        await withCheckedContinuation { continuation = $0 }
    }
    func open() { opened = true; continuation?.resume(); continuation = nil }
}

private enum MicrophoneFixtureError: Error { case capture }

@MainActor
private final class MicrophoneFixture {
    var policy = NativeAudioPolicy()
    var queue = NativeMicrophoneTransitionQueue()
    var room = 1
    var active = true
    var secret = false
    var muted = true
    var input = false
    var tracks: [Int: Bool] = [:]
    var events: [String] = []

    // These are the SDK/engine/state hooks supplied to the actual production
    // queue, with deterministic gates replacing only the external SDK await.
    func request(_ name: String, enabled: Bool, gate: MicrophoneGate? = nil,
                 retirement: MicrophoneGate? = nil, fails: Bool = false, automatic: Bool = false) -> Task<Bool, Error> {
        let generation = automatic ? policy.microphoneGeneration : policy.invalidateMicrophoneChange()
        let capturedRoom = room
        let capturedQueue = queue
        if !automatic {
            if !enabled { muted = true; input = false }
            else { policy.userRequestedPlayback() }
        }
        return Task { @MainActor in
            try await capturedQueue.change(isValid: {
                self.room == capturedRoom && self.policy.acceptsMicrophoneChange(generation, muted: !enabled,
                    callKitActive: self.active, privateTurn: self.secret)
                    && (!automatic || enabled == (!self.muted && !self.secret))
            }, publish: {
                self.events.append(name + ":publish")
                self.input = enabled
                await gate?.wait()
                self.tracks[capturedRoom] = enabled
                if fails { throw MicrophoneFixtureError.capture }
            }, commit: {
                self.muted = !enabled
                self.events.append(name + ":commit")
            }, retire: {
                self.events.append(name + ":retire-start")
                if self.room == capturedRoom { self.muted = true; self.input = false }
                await retirement?.wait()
                self.tracks[capturedRoom] = false
                self.events.append(name + ":retire-end")
            })
        }
    }

    func waitFor(_ event: String) async {
        for _ in 0..<10_000 {
            if events.contains(event) { return }
            await Task.yield()
        }
        preconditionFailure("Queued microphone fixture did not reach \(event)")
    }
}

@main
enum NativeAudioPolicyTests {
    @MainActor static func main() async {
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

        // Deterministic suspended-publication schedules use the exact policy
        // invoked by CXSetMutedCallAction after its SDK await.
        var microphone = NativeAudioPolicy()
        let first = microphone.invalidateMicrophoneChange()
        expect(microphone.acceptsMicrophoneChange(first, muted: false, callKitActive: true, privateTurn: false), "Unchanged active call accepts explicit unmute")
        microphone.interruptionBegan()
        expect(!microphone.acceptsMicrophoneChange(first, muted: false, callKitActive: true, privateTurn: false), "An interruption invalidates suspended unmute")
        microphone.interruptionEnded(shouldResume: true)
        expect(!microphone.acceptsMicrophoneChange(first, muted: false, callKitActive: true, privateTurn: false), "Ending an interruption cannot revive its old unmute")
        let afterInterruption = microphone.invalidateMicrophoneChange()
        expect(microphone.acceptsMicrophoneChange(afterInterruption, muted: false, callKitActive: true, privateTurn: false), "A fresh explicit unmute can succeed after recovery")
        expect(!microphone.acceptsMicrophoneChange(afterInterruption, muted: false, callKitActive: false, privateTurn: false), "Unmute cannot complete after CallKit ownership loss")
        expect(!microphone.acceptsMicrophoneChange(afterInterruption, muted: false, callKitActive: true, privateTurn: true), "Unmute cannot complete during a secret turn")
        microphone.invalidateMicrophoneChange() // privacy began then ended
        expect(!microphone.acceptsMicrophoneChange(afterInterruption, muted: false, callKitActive: true, privateTurn: false), "An ended private turn cannot revive its old unmute")
        let staleUnmute = microphone.invalidateMicrophoneChange()
        let newerMute = microphone.invalidateMicrophoneChange()
        expect(!microphone.acceptsMicrophoneChange(staleUnmute, muted: false, callKitActive: true, privateTurn: false), "A newer mute supersedes an awaiting unmute")
        expect(microphone.acceptsMicrophoneChange(newerMute, muted: true, callKitActive: false, privateTurn: true), "Muting remains valid without audio ownership and in secret turns")
        let beforeReset = microphone.invalidateMicrophoneChange()
        microphone.mediaServicesReset()
        expect(!microphone.acceptsMicrophoneChange(beforeReset, muted: false, callKitActive: true, privateTurn: false), "Media reset retires pending publication")
        let beforeRouteLoss = microphone.invalidateMicrophoneChange()
        microphone.holdForUserGesture()
        microphone.userRequestedPlayback()
        expect(!microphone.acceptsMicrophoneChange(beforeRouteLoss, muted: false, callKitActive: true, privateTurn: false), "Later playback recovery cannot revive a publication held by route loss")

        for olderEnabled in [false, true] {
            for fails in [false, true] {
                let f = MicrophoneFixture(), oldGate = MicrophoneGate(), retirement = MicrophoneGate()
                let older = f.request("older", enabled: olderEnabled, gate: oldGate, retirement: retirement, fails: fails)
                await f.waitFor("older:publish")
                let newer = f.request("newer", enabled: true)
                oldGate.open()
                await f.waitFor("older:retire-start")
                expect(!f.events.contains("newer:publish"), "New intent waits for old SDK completion AND cleanup")
                expect(!f.input && f.muted, "Retirement closes input before any later publication")
                retirement.open()
                _ = try? await older.value
                let won = (try? await newer.value) == true
                expect(won && !f.muted && f.input && f.tracks[1] == true, "A newer unmute wins after old mute/unmute success or failure")
                expect(!f.events.contains("older:commit"), "Superseded SDK result cannot commit stale mute state")
                expect(f.events.firstIndex(of: "older:retire-end")! < f.events.firstIndex(of: "newer:commit")!, "Old cleanup cannot run after new intent commits")
            }
        }
        for safety in ["interruption", "secret", "ownership"] {
            let f = MicrophoneFixture(), gate = MicrophoneGate()
            let old = f.request("old", enabled: true, gate: gate)
            await f.waitFor("old:publish")
            if safety == "interruption" { f.policy.interruptionBegan() }
            else { f.policy.invalidateMicrophoneChange() }
            if safety == "secret" { f.secret = true }
            if safety == "ownership" { f.active = false }
            f.muted = true; f.input = false
            expect(!f.input, "Safety events close input immediately without waiting for SDK")
            if safety == "interruption" { f.policy.interruptionEnded(shouldResume: true) }
            if safety == "secret" { f.secret = false }
            gate.open()
            let result = try? await old.value
            expect(result == false && f.muted && !f.input && f.tracks[1] == false, "Safety begin/end retires old publication without reopening input")
        }
        do {
            let f = MicrophoneFixture(), gate = MicrophoneGate()
            let explicit = f.request("explicit-unmute", enabled: true, gate: gate)
            await f.waitFor("explicit-unmute:publish")
            // connect/activation snapshots the old displayed mute preference
            // while explicit publication is pending, without changing its epoch.
            let generation = f.policy.microphoneGeneration
            let automatic = f.request("automatic-old-mute", enabled: false, automatic: true)
            expect(f.policy.microphoneGeneration == generation, "Automatic reconciliation shares the current intent generation")
            gate.open()
            let explicitResult = try? await explicit.value
            let automaticResult = try? await automatic.value
            expect(explicitResult == true && automaticResult == false, "Automatic stale disable cannot override a completed explicit unmute")
            expect(!f.events.contains("automatic-old-mute:publish") && !f.muted && f.input && f.tracks[1] == true,
                   "Current preference is rechecked in both directions before an automatic SDK write")
        }
        do {
            let f = MicrophoneFixture(), oldGate = MicrophoneGate()
            let old = f.request("old-room", enabled: true, gate: oldGate, fails: true)
            await f.waitFor("old-room:publish")
            f.room = 2
            f.queue = NativeMicrophoneTransitionQueue()
            let current = f.request("new-room", enabled: true)
            let accepted = (try? await current.value) == true
            expect(accepted && f.tracks[2] == true, "A stalled retired room does not block a new room's queue")
            oldGate.open()
            _ = try? await old.value
            expect(!f.muted && f.input && f.tracks[2] == true && f.tracks[1] == false, "Retired room failure cannot mute or clear the new room's audio")
        }
        print("NativeAudioPolicy: \(checks) executable ownership/lifecycle checks passed")
    }
}
