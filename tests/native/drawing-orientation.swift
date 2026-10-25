import Foundation

@main
struct DrawingOrientationChecks {
    static func main() {
        let valid = ["ers-a", "ers-round_1-token", "ers-" + String(repeating: "x", count: 56)]
        for token in valid { precondition(DrawingOrientationPolicy.validLease(token)) }
        for token in ["", "round", "ers-", "ers-a b", "ers-🖌", "ers-" + String(repeating: "x", count: 57)] {
            precondition(!DrawingOrientationPolicy.validLease(token))
        }
        for value in ["maydan://app/index.html#/room/123456", "maydan://app/#/room/123456?join=1"] {
            precondition(DrawingOrientationPolicy.isRoomURL(URL(string: value)))
        }
        for value in ["https://maydan-game.mf103871.workers.dev/#/room/123456", "maydan://auth/#/room/123456", "maydan://app/index.html#/game/ersomha", "maydan://app/studio/#/room/123456", "maydan://user@app/#/room/123456", "maydan://app/#/room/1234567", "maydan://app/#/room/12345", "maydan://app/#/room/123456/other"] {
            precondition(!DrawingOrientationPolicy.isRoomURL(URL(string: value)))
        }
        var policy = DrawingOrientationPolicy()
        let first = policy.acquire("ers-first")!
        let next = policy.acquire("ers-next")!
        precondition(!policy.accepts("ers-first", generation: first))
        precondition(!policy.release("ers-first"))
        precondition(policy.accepts("ers-next", generation: next))
        precondition(policy.release("ers-next"))
        precondition(!policy.accepts("ers-next", generation: next))
        let recreated = policy.acquire("ers-next")!
        precondition(recreated != next && !policy.accepts("ers-next", generation: next))
        precondition(policy.release())
        precondition(!policy.release())
        precondition(policy.acquire("bad token") == nil && policy.lease == nil)
        print("Drawing orientation eligibility, finite token and stale-cleanup checks passed.")
    }
}
