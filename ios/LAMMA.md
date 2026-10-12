# Lamma native integration

The native social coordinator adds audio-only LiveKit calls, CallKit, genuine
incoming-call PushKit notifications, ordinary APNs registration and AAC voice
notes to the existing trusted `maydan://app` bridge. It does not request payment,
provision any external account, upload a build, or turn on a production rollout.

## Bridge contract

All commands use `webkit.messageHandlers.maydan.postMessage({type,id,...payload})`
and the existing `window.maydanNative.resolve(id,{ok,result,error})` convention.
Only the app's main frame can invoke them. Native errors are stable codes, never
credential-bearing upstream descriptions.

| Command | Input / result |
| --- | --- |
| `socialStoredSession` | Returns `{deviceId,userId?,token?,call}`. Read before account hydration, because a call answered while WebKit was suspended may rotate the account session. |
| `socialSession` | `{userId,token}` → canonical `{userId,token,deviceId,call}`; binds the current account and enables pending event delivery. |
| `socialLogout` | Ends media, clears Keychain and pending events, unregisters this installation's push devices. Invoke before account-session revocation. Network cleanup is best effort; local credentials are cleared first. |
| `socialNotifications` | `{request:boolean}` → `{authorized,status,deviceId}`. `request:true` must follow an explicit notification-enable gesture. |
| `socialCallConnect` | `{userId,callId,scope,conversationId,url,token,callerName?,muted?}` → call snapshot. Credentials come from the authenticated server; only secure LiveKit Cloud URLs are accepted. |
| `socialCallMute` | `{callId,muted:boolean}` → call snapshot. CallKit is kept in sync. |
| `socialCallSpeaker` | `{callId,speaker:boolean}` → call snapshot. `false` restores system routing (receiver/headset/Bluetooth). |
| `socialCallEnd` | `{callId,localOnly?,endReason?}` ends only that call and cancels its pending permission/connect attempt. With `localOnly:true`, it does not leave/reject on the server (required when another installation owns the call). Otherwise cleanup includes the installation's `deviceId`. |
| `socialAudioPrivacy` | `{privateTurn:boolean}`. A visible secret cancels a recording and mutes a call; clearing the flag never automatically unmutes. |
| `socialVoiceStart` | `{recordingId}` requests microphone permission and records up to 120 seconds, only in the foreground and outside a call/private turn. |
| `socialVoiceStop` | `{recordingId}` → `{recordingId,base64,mimeType:'audio/mp4',durationMs}`. Idempotent within this recording, including after native automatic stop. Preview in the web composer before upload. |
| `socialVoiceCancel` | `{recordingId}` discards only that recording/preview and removes its temporary file. |

Events use `window.maydanNative.event(name,payload)`:

- `socialCall`: `{callId,conversationId,scope,userId,state,muted,speaker,participants,error?,localOnly?,endReason?}`. Ending snapshots mute locally; `endReason` distinguishes `ownership-lost`, `authorization-revoked`, `authorization-timeout`, and `call-ended`. A `localOnly` termination must never trigger a JavaScript leave/reject request.
  Participants have `{id,name,speaking,muted}`. States are ringing, connecting,
  connected, reconnecting, ended (or idle in an empty snapshot).
- `socialVoice`: `{state:'recording'|'ready'|'cancelled'|'interrupted',...}`. At the
  120-second limit, `ready` contains the same audio fields as `socialVoiceStop`.
- `socialNotification`: `{userId,scope,conversationId,callId?}` (or
  `{userId,category,view:'requests'|'groups'}` for an invitation). Open the social drawer,
  preserving the active match. It is held until the signed-in bridge is ready.
- `socialSessionRotated`: `{userId,token,previousToken}`. Adopt only for the matching account and current previous token.
  The canonical token is also persisted in Keychain for cold launch recovery.
- `socialDeviceToken`: `{deviceId,kind,environment,registered:true}` and
  `socialNotificationStatus:{error}`. Tokens themselves are sent directly to the
  API, not passed through social UI state.

CallKit owns audio-session activation. The SDK engine is disabled outside
CallKit's activated window, and microphone publication waits for activation.
Call interruptions mute the mic and require an explicit unmute. Voice recording
is interrupted when the app leaves the foreground. Calls are never recorded.

## Server contracts

The configured account API HTTPS origin is the only native API destination.
Redirects are refused. Requests use the account bearer and `Origin: maydan://app`;
`x-maydan-session` rotation is handled on successful and error responses.

- `PUT /api/social/devices` accepts `{deviceId,kind:'apns'|'voip',token,environment:'sandbox'|'production'}`.
- `DELETE /api/social/devices/:deviceId` removes both token kinds for the account.
- `POST /api/social/calls/:id/accept` accepts `{deviceId}` and returns
  `{call,connection:{url,token}}`; the server enforces one answering installation.
- `GET /api/social/calls/:id` returns `{call}`. A native poll reconciles expired,
  cancelled and answered-elsewhere calls even when the web app is suspended.
- `POST /api/social/calls/:id/leave` or `/reject` uses `{deviceId}` to end only this installation's participation. Stale actions from another device must be an idempotent no-op.

Both native and web engines end local media immediately for explicit authorization
revocation, including account suspension. After at least two failed checks, an
independent watchdog ends media at 60 seconds without a successful authorized
response, including while a later HTTP request is still pending. Success resets
the failure count and deadline. Device-ownership loss never sends server cleanup.

Ordinary APNs custom fields: `{recipientId,scope,conversationId,callId?}`. The
notification body must follow the user's server-side preview preference.
Foreground system banners are suppressed because the web app owns privacy-aware
toasts; there must not be a second banner over a hidden-role screen.

Genuine incoming direct-call VoIP fields:
`{recipientId,callId,scope,conversationId,expiresAt}` (expiry in epoch milliseconds).
`callId` must be a UUID. Never include a session token, LiveKit token or message
text. The app reports the incoming call to CallKit before any network request,
then ends invalid, cross-account, expired or busy calls. The backend must send
VoIP only for actual new incoming calls, with `apns-expiration:0`; messages and
group-call invitations use ordinary notifications.

## Provisioning and validation

1. Configure the server's LiveKit Cloud project and APNs token credentials. No
   provider secret belongs in `native-config.json` or the application bundle.
2. Enable **Push Notifications** on the existing explicit `Maydan` App ID,
   regenerate its App Store distribution profile, and update the existing build
   secret. The signing preflight deliberately rejects a profile without
   `aps-environment:production`.
3. Debug uses the APNs development environment; Release uses production. Both
   Info.plist and entitlements use `MAYDAN_PUSH_ENVIRONMENT` to prevent divergent
   token registration and signing. TestFlight uses production APNs.
4. Build with the existing Xcode 26+ workflow. LiveKit Swift is pinned to 2.17.0;
   the resolved dependency file contains verified upstream tag commit IDs. The
   macOS build must resolve and compile those pins before calling the build valid.
   The app target must include `@executable_path/Frameworks` in its runpaths for
   the embedded LiveKitWebRTC and RustLiveKitUniFFI binaries. Run the actual
   package dependency validator on the simulator app, archive and exported IPA,
   and pass the Release simulator launch smoke before uploading to TestFlight.
5. Update App Store Connect privacy answers and the live policy for audio data,
   device push identifiers, group membership and call metadata. The local privacy
   manifest alone does not update published answers.

Required physical-device tests: permission refusal, two-device private call,
12-member group call, locked and cold-start answer, duplicate/expired call push,
answer on a second device, caller cancellation, remote block/removal, Wi-Fi to
cellular transition, Bluetooth/receiver/speaker, interruption by a cellular call,
background audio, privacy auto-mute, recording auto-stop/preview/cancel, account
switch and sign-out with an active call, session rotation while locked, ordinary
notifications after force-close, and returning to the same saved match.

Windows source checks and web tests cannot verify CallKit, APNs delivery, audio
routing, or microphone behavior. Those remain device acceptance checks.

References: [LiveKit Swift SDK](https://github.com/livekit/client-sdk-swift/tree/2.17.0),
[Apple PushKit call handling](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit).
