# Standalone web trial correction — 19 October 2026

The owner-only editor could authenticate while `/api/studio/play/` displayed a login prompt to the same owner. The standalone game artifact inherited an unset API build setting; its account resolver threw `OFFLINE` before the permission request. The catch-all gate then presented that as a login problem.

`buildDesignPreview` now forces `same-origin` only for the standalone game artifact. This covers both the initial owner gate and the real mounted game's account, design and game requests. A native or foreign API build setting cannot redirect this artifact's account credentials to another host. Native packaging, the public game build, the editor and the isolated component-preview artifact retain their existing settings and bytes.

Validation:

- The actual built artifact passed Chromium and WebKit with unset and foreign API environment settings: owner permission, real account loading, private design application, guest gate and denied-account gate. No request reached a foreign origin. Both builds had identical hashes.
- The focused release/site suite passed 11 tests; lint passed for the changed files.
- The live owner-only page opened the real game after deployment, and its account and configuration requests returned 200. The owner identity was checked through the profile UI. The live configuration correctly returned the default design when no account preview was active.
- The owner separately reported successful physical iPhone UI checks on the requested TestFlight 1.8 (20): the private design badge and visual changes, all four sections, a chat draft and keyboard behavior without zoom/overlap, and landscape navigation. This does not claim completed matches, live calls or direct agent observation of the iPhone.

Deployment receipt:

```json
{
  "releaseId": "studio-20261019-a80bcdfc",
  "verifiedAt": "2026-10-19T16:49:18.988Z",
  "sourceCommit": "f616f5d1e77a35af2e870e97fa42d468b0a20329",
  "editorSha256": "47018e319c6a53b7bd3b9c53bafcbf574e3e3ab153b54315a82b9861fdad67cd",
  "previewSha256": "ca346cab5170c80b3e504558cdb2b66a12ca8a4df816e40615dd8cb4187121d3",
  "playSha256": "31411cfa08a4e25855dabc3cfe6903287570c492d451ce9db519a33c0ebfcb4c",
  "checkedOriginalPublicAssets": 63,
  "originalPublicAssetsUnchanged": true,
  "backendModuleBytesUnchanged": true,
  "addedMigrations": [],
  "publicPublishingEnabled": false,
  "newTestFlightBuildRequired": false
}
```

Private draft contents and trial screenshots remain outside the public repository. The editor's **جرّب على حسابي** action can pin a saved draft for another private trial; this repair does not publish a design or reopen the public publication gate.
