# Private audio candidate release — 1.9 (36)

This is an isolated TestFlight listening candidate, not a public audio approval.
It builds from the committed Mafia/tutorial baseline and the audio architecture,
without copying concurrent uncommitted Mafia work from another checkout.
The native API destination remains `mafia-preview`; no Worker deployment, public
release, purchase product, tester invitation or minimum-version change belongs
to this release.

## What is included

- 24 complete, attenuation-only AAC auditions retain their decoded source rates
  and source/license provenance. Ten separate 48 kHz transient crops serve UI,
  outcome, clock and public Mafia event cues. Upsampling the two 24 kHz sources
  is a compatibility operation and does not add source detail.
- Nine scene candidates use streaming playback, not long PCM buffers. Existing
  privacy/silence phases and calls/recordings continue to take priority.
- The Settings listening room is enabled by BOTH the compiled preview origin and
  an explicit private-audio build flag. Native media controls require a user
  action; only one audition plays, and interruptions never automatically replay it.
- Candidates remain `listeningApproved: false`. Production and ordinary preview
  builds retain the existing audio and do not materialize candidate assets.

## Asset confidentiality and reproducibility

The repository is public. It holds metadata, a hash manifest and an authenticated
AES-256-GCM encrypted candidate pack. Original Pixabay downloads, certificates,
the plaintext pack, data keys and decoded audio are excluded from Git. The data
key is DPAPI-protected locally and temporarily supplied through an Actions
secret; it grants no account/API permissions and is removed after reconciliation.

The runner validates the catalog hash, every path, size and SHA-256 before
materialization. It validates the exact materialized set before building. The
native resource preparation copies these local files and verifies every byte.
Only short effects enter the preview service-worker precache; full music remains
streamed. No extra network audio host or public standalone media gallery is used.

The signed IPA artifact is also encrypted; its authenticated identity binds the
app, source commit, environment, version and build. Apple receives the existing
signed export through the established TestFlight upload. The release verifier
checks the CI run, original artifact digest, authenticated capsule, IPA identity,
native API origin, Mach-O dependencies and all 34 candidate files. It distinguishes
CI codesign evidence from checks possible on Windows.

## Release boundary

The existing signed workflow remains one macOS job with a 45-minute timeout.
Dispatch and beta-note writes have exclusive operation journals. Unknown results
are reconciled with reads, not retried. No source fix is claimed installed until
the exact new build is ready in TestFlight. Physical iPhone listening, background,
headphone and simultaneous-call acceptance still require the user's report.

## iPhone trial

1. Install 1.9 (36) without deleting the prior preview, then use Settings →
   «معاينة أصوات التحديث» to compare the complete music and effects.
2. Try scene changes, correct/wrong answers, clicks and countdowns. Confirm music
   and effects volume independently, and return from the home screen twice.
3. Try headphones, a call and a voice recording; confirm the listening room stops
   and game audio respects the current communication/privacy state.
4. Report the preferred tracks and any clipped, sharp, slow or missing cue. This
   trial is not a public launch or a human approval recorded by automated tests.
