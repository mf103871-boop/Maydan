import Foundation

@main
struct MigrationWatchdogTests {
    static func main() {
        var checks = 0
        func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
            precondition(condition(), message)
            checks += 1
        }
        var read = StorageMigrationWatchdog()
        expect(!read.isActive, "No timer before a collection")
        let first = read.begin(at: 100)
        expect(read.phase == .loading, "Initial phase includes cold WebKit loading")
        expect(read.remaining(generation: first, at: 104) == 26, "The former four-second timeout must not fail loading")
        expect(!read.hasExpired(generation: first, at: 112), "A twelve-second cold startup remains valid")
        expect(read.documentReady(generation: first, at: 112), "Current navigation advances to acknowledgement waiting")
        expect(read.phase == .awaitingResult, "Document readiness is not storage success")
        expect(read.deadline == 120, "Readiness gets an eight-second acknowledgement budget")
        expect(!read.documentReady(generation: first, at: 116), "Repeated didFinish cannot extend a deadline")
        expect(read.deadline == 120, "Duplicate readiness preserves deadline")
        expect(!read.hasExpired(generation: first, at: 119.99), "Do not expire before acknowledgement deadline")
        expect(read.finish(generation: first), "A verified result may finish after delayed loading")
        expect(!read.hasExpired(generation: first, at: 500), "Retired watchdog cannot turn success into failure")
        expect(!read.finish(generation: first), "Duplicate completion must not fire")
        expect(!read.documentReady(generation: first, at: 500), "Late navigation cannot revive completed operation")

        let timedOut = read.begin(at: 200)
        expect(!read.hasExpired(generation: timedOut, at: 229.99), "Loading budget is bounded but tolerant")
        expect(read.hasExpired(generation: timedOut, at: 230), "A stalled load really expires")
        expect(read.finish(generation: timedOut), "Timeout consumes this operation only")
        let retry = read.begin(at: 231)
        expect(retry != timedOut, "Retry has a fresh generation")
        expect(!read.finish(generation: timedOut), "Late old result cannot complete the retry")
        expect(!read.documentReady(generation: timedOut, at: 232), "Late old navigation cannot advance retry")
        expect(!read.hasExpired(generation: timedOut, at: 300), "Queued old timeout cannot fail retry")
        expect(read.phase == .loading && read.deadline == 261, "All stale callbacks preserve current state")
        expect(read.documentReady(generation: retry, at: 240), "Current retry remains usable")
        expect(read.hasExpired(generation: retry, at: 248), "Missing storage result expires independently")
        expect(read.finish(generation: retry), "Result timeout terminates pending state without marking storage done")

        var seed = StorageMigrationWatchdog()
        let seedAttempt = seed.begin(at: 0)
        expect(seed.documentReady(generation: seedAttempt, at: 29), "Slow seed navigation retains result opportunity")
        expect(seed.deadline == 37, "Seed result deadline follows readiness")
        expect(seed.finish(generation: seedAttempt), "Explicit failed result consumes operation just like success")
        expect(!seed.documentReady(generation: seedAttempt, at: 35), "A navigation after quota failure cannot revive seed")
        expect(!seed.finish(generation: seedAttempt), "Late seed result after failure is ignored")
        let earlyProof = seed.begin(at: 40)
        expect(seed.finish(generation: earlyProof), "Verified inline-JS acknowledgement may arrive before didFinish")
        expect(!seed.documentReady(generation: earlyProof, at: 41), "Late didFinish after inline acknowledgement stays retired")

        let delayedMain = seed.begin(at: 100)
        expect(seed.documentReady(generation: delayedMain, at: 135), "Late main-thread delivery remains bounded")
        expect(seed.deadline == 138, "Phase transition cannot exceed loading plus result maximum")
        expect(seed.hasExpired(generation: delayedMain, at: 138), "A delayed scheduler cannot extend waiting indefinitely")
        let reset = seed.begin(at: 150)
        expect(!seed.finish(generation: delayedMain), "Process restart generation rejects old completion")
        expect(seed.remaining(generation: reset, at: 151) == 29, "Restart receives its own bounded loading budget")
        print("PASS native storage migration watchdog (\(checks) checks)")
    }
}
