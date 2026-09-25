# Privacy disclosures for the 1.5 release

The native manifest covers the app and its bundled web game. All declared data is used for App Functionality, is marked linked to the user, and is not used for tracking. This file records the source audit; it does not publish App Store Connect answers.

| Data type | Current use and source |
| --- | --- |
| Name, Email Address, User ID | Account creation, sign-in and sessions in `server/accounts` and `server/migrations/0001_accounts.sql`. Room player names and IDs are also saved with room state. |
| Purchase History | Subscription entitlement and transaction verification in `server/accounts`. Card and bank details are handled outside the app and are not collected by the game. |
| Gameplay Content | Multiplayer room state, player answers and votes persisted by `server/room.mjs`. |
| Product Interaction | Per-account free-game consumption in `trials`, plus short-lived request counts used to enforce service limits. These records implement the game and abuse protection, not marketing analytics. |
| Device ID | The rate limiter in `server/worker.mjs` derives a daily identifier from the connection IP and uses it to associate request counts. Device ID is the applicable network-identifier category under Apple's use-based IP guidance; this is not an advertising ID or a location estimate. Raw IP is not stored by this code. Hashing alone is not treated as proof of anonymity, so it is marked linked. |

The limiter clears its counters after ten minutes without an accepted request. Multiplayer room state is removed by its expiry/closure cleanup. This short retention does not exempt data stored beyond the immediate request from disclosure.

Before submitting 1.5, update the App Store Connect privacy labels to match the seven manifest categories and the actual released behavior, including data collected through the web view. Do not publish descriptions of future functionality as if already released. Validate the final TestFlight build on an iPhone before App Review.

References: [Apple's privacy definitions, IP guidance and web-view guidance](https://developer.apple.com/app-store/app-privacy-details/), [privacy manifest data type constants](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype).
