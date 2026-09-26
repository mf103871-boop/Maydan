# Privacy disclosures for the 1.5 release

Source audit updated 2026-09-25 for the native app and its bundled web game, including friends, private text conversations, player profiles and account statistics. The manifest declares **12 data types**, each for **App Functionality**, **linked to the user**, and **not used for tracking**. This document and the manifest do not publish App Store Connect privacy answers.

## App Store Connect disclosure mapping

The final column is the suffix of `NSPrivacyCollectedDataType` in `Maydan/PrivacyInfo.xcprivacy`.

| App Store data type | What the app sends and stores; source | Manifest suffix |
| --- | --- | --- |
| Name | Apple/Google account names when supplied, editable display names, and multiplayer player names. `server/accounts`, `server/social/model.mjs`, `server/profiles/db.mjs`, `server/room.mjs`. | `Name` |
| Email Address | Sign-in email when supplied by the identity provider, including Apple relay addresses. It is not exposed in public profiles or friend search. `server/accounts`. | `EmailAddress` |
| User ID | Provider and internal account identifiers, persistent friend code, room player identifiers and session associations. `server/accounts`, `server/social`, `server/profiles`, `server/room.mjs`. | `UserID` |
| Contacts | The in-app social graph: friend requests, accepted friendships and block relationships associated with account IDs. `server/social/db.mjs` and the social migration. This does **not** import or access the device address book. | `Contacts` |
| Purchase History | Product and transaction identifiers, subscription status, renewal/expiry information and entitlements. `server/accounts`. The game does not receive payment-card or bank details from Apple. | `PurchaseHistory` |
| Gameplay Content | Multiplayer answers, votes and room state; recorded completed game events and account statistics/achievements. `server/room.mjs`, `server/profiles/db.mjs`, `server/migrations/0005_profiles.sql`. Local-only guest game saves remain on the device. | `GameplayContent` |
| Product Interaction | Consumed free-game trials, service request limits, message read positions, presence and last activity used to operate the service. `server/accounts`, `server/social`, `server/worker.mjs`. These records are not marketing analytics. | `ProductInteraction` |
| Device ID | A daily digest derived from the connection IP associates request-limit counters. `server/worker.mjs`. It is a network identifier, not an advertising ID or a location estimate; the limiter does not store the raw IP. Hashing alone is not treated as anonymity, so this is marked linked. | `DeviceID` |
| Emails or Text Messages | Private friend-message text, sender, conversation recipient association, timestamps, edits/deletions and reported-message evidence. `server/social/db.mjs`, `server/social/router.mjs`. No voice messages, chat attachments or email-inbox access. | `EmailsOrTextMessages` |
| Photos or Videos | The avatar and cover photos a user chooses. The client uploads a cropped/compressed JPEG, not the original file; the server strips JPEG metadata. `src/profiles/client-images.js`, `server/profiles/images.mjs`, `server/profiles/db.mjs`. This category covers photos only; no video upload exists. | `PhotosorVideos` |
| Customer Support | User-submitted abuse reports requesting operator intervention: reasons/details, account or message references and retained evidence, plus the associated handling history. `server/social/db.mjs` and `server/moderation/db.mjs`. | `CustomerSupport` |
| Other User Content | Profile biography and user-selected profile customization. `server/profiles/model.mjs`, `server/profiles/db.mjs`. Report reasons and administrative handling are classified above under Customer Support. | `OtherUserContent` |

Apple's [Contacts definition includes a social graph](https://developer.apple.com/app-store/app-privacy-details/), so Contacts applies to stored friend relationships without address-book access. Customer Support is included because the report form requests intervention by the service operator. The same Apple reference covers web-view collection and classification of IP-derived identifiers by use.

## Storage, visibility and deletion

- Profile metadata and friend search require a signed-in account; profile access and conversations enforce blocking in both directions. Presence is shown to accepted friends. The account email is not part of the public profile/search payload.
- Chats are available between accepted friends. Message content is stored on the server and access is checked for each participant; this is **not end-to-end encryption**. Typing signals do not contain the unsent draft. The client does not persist chat history in localStorage or IndexedDB.
- Deleting a message removes its conversation text and leaves deletion metadata. A previously submitted report may retain its evidence copy. The service purges messages and reports after the configured retention period (365 days by default, with a 30-day minimum). Account deletion removes the account's related social/profile rows, moderation decisions and audit records, images, recorded game events, statistics and awards; separate copies made by another person are outside the service's control.
- Profile images are stored in a private review queue first. Only the owner and a configured moderator can view a pending image. Approval publishes the selected, metadata-stripped image at its versioned URL; the previously approved image remains visible while a replacement is reviewed. Rejection or removal hides the image. The queue and decision handling are implemented in `server/moderation` and migrated by `0007_moderation.sql`. A photo retained pending review is still collected and remains covered by Photos or Videos; pending review is not approval.
- Request-limit counters expire after ten minutes without an accepted request. Multiplayer room state is removed by room expiry/closure cleanup. Account statistics and earned achievements are separate persistent records; they are not removed merely because a room closes. Short retention does not exempt data stored beyond the immediate request from disclosure.
- App Store purchase records retained by Apple follow Apple's policies. Deleting a Maydan account does not itself cancel an App Store subscription; subscription management remains in the Apple account.

The native UserDefaults declaration remains `NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1`. `NSPrivacyTracking` is false and `NSPrivacyTrackingDomains` is empty. Do not add a Contacts permission solely to match the social-graph disclosure.

## Before submission

The 12 App Store Connect privacy categories were updated and showed Published during the release check. Verify that status again at submission and confirm the live [privacy policy](https://maydan-game.mf103871.workers.dev/#/privacy) matches the final shipped behavior. Configure an authorized `MODERATOR_USER_IDS` account and verify its access before deploying the moderation migration; existing profile photos enter the review queue and stay hidden until approved. Test the actual signed iPhone build; a manifest or successful web test does not establish native behavior or publication.

Release observations and draft reviewer text are in [the submission record](../docs/releases/2026-09-25/app-store-submission.md). References: [Apple privacy definitions](https://developer.apple.com/app-store/app-privacy-details/), [manifest constants](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype), [user-generated content requirements](https://developer.apple.com/app-store/review/guidelines/#user-generated-content).
