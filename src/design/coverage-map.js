// Actual production-node inventory verified by the semantic browser coverage test.
// Each template ID names a semantic component; it never identifies an array index or a user.
export const DESIGN_RENDERED_NODE_IDS = Object.freeze({
  "home": Object.freeze(["brand","footer","game-card.badeeha","game-card.beep","game-card.ersomha","game-card.fabraka","game-card.jabeen","game-card.mamnoo","game-card.meenfina","games","header","presence","privacy-link","profile","refunds-link","rooms","roster","terms-link","title","tools"]),
  "game-details": Object.freeze(["actions","back","facts","game-description","game-icon","game-name","hero","online","steps","title","topbar"]),
  "players": Object.freeze(["add-player","avatar-choice","avatar-picker","back","name-input","player-remove","player-row","players","title","topbar"]),
  "settings": Object.freeze(["about","clear-data","music-volume","pricing-link","privacy-link","refunds-link","setting","setting-toggle","settings-account","settings-audio","settings-experience","settings-local","settings-privacy","settings-support","share-reports","sound-test","sound-volume","terms-link","title","topbar"]),
  "account.card": Object.freeze(["account-delete","account-signin","account-signout","profile","purchase","restore","title"]),
  "store": Object.freeze(["artwork","store-empty","title","topbar"]),
  "about": Object.freeze(["back","license-link","pricing-link","privacy-link","refunds-link","show-all","source-link","terms-link","title","topbar"]),
  "audio-credits": Object.freeze(["content","license-link","source-link"]),
  "legal": Object.freeze(["back","support-link","title","topbar"]),
  "play-setup": Object.freeze(["actions","add-player","player-choice","players","players-setup","start"]),
  "badeeha.home": Object.freeze(["actions","history","intro","rules","start","title"]),
  "badeeha.setup": Object.freeze(["back","categories-reset","category-card","category-filter","category-search","clear-history","favorite","header","mode-choice","random-categories","round-size","start","team-count","team-name","timer-length","title"]),
  "badeeha.board": Object.freeze(["actions","finish","header","score-cards","scoreboard","tier","undo"]),
  "badeeha.question": Object.freeze(["answer","answer-toggle","cancel","category","header","judge","judge-nobody","judge-team","options-list","pause","question","report","reveal","timer","tool","tools","turn"]),
  "badeeha.result": Object.freeze(["actions","history","setup","share-result","start"]),
  "badeeha.history": Object.freeze(["back","clear-results","header","title"]),
  "beep.three.intro": Object.freeze(["intro","players","start"]),
  "beep.three.prompt": Object.freeze(["continue","prompt","timer","turn"]),
  "beep.three.judge": Object.freeze(["correct","judge","players","prompt","wrong"]),
  "beep.three.over": Object.freeze(["actions","exit","options","podium","restart"]),
  "beep.bomb.intro": Object.freeze(["intro","lives","players","start"]),
  "beep.bomb.prompt": Object.freeze(["bomb","continue","lives","players","prompt","turn"]),
  "beep.bomb.boom": Object.freeze(["continue","lives","results"]),
  "beep.bomb.over": Object.freeze(["actions","exit","options","podium","restart"]),
  "mamnoo.intro": Object.freeze(["intro","scoreboard","start"]),
  "mamnoo.play": Object.freeze(["actions","category","correct","header","options-list","question","skip","timer","word","wrong"]),
  "mamnoo.roundEnd": Object.freeze(["continue","intro","results","scoreboard"]),
  "mamnoo.over": Object.freeze(["exit","options","podium","restart"]),
  "jabeen.intro": Object.freeze(["intro","start"]),
  "jabeen.play": Object.freeze(["content","continue","controls","correct","header","rotate","skip","timer","word"]),
  "jabeen.review": Object.freeze(["continue","option","results"]),
  "jabeen.over": Object.freeze(["exit","options","podium","restart"]),
  "meenfina.local.intro": Object.freeze(["intro","scoreboard","start"]),
  "meenfina.local.countdown": Object.freeze(["question"]),
  "meenfina.local.pick": Object.freeze(["option","options-list","question","skip","submit"]),
  "meenfina.local.vote": Object.freeze(["option","options-list","question"]),
  "meenfina.local.result": Object.freeze(["continue","question","results"]),
  "meenfina.local.over": Object.freeze(["exit","options","podium","restart"]),
  "fabraka.local.intro": Object.freeze(["header","intro","pause","scoreboard","start"]),
  "fabraka.local.question": Object.freeze(["continue","header","pause","question"]),
  "fabraka.local.host": Object.freeze(["answer-aliases","answer-input","draft","header","pause","question","skip","submit"]),
  "fabraka.local.write": Object.freeze(["answer-input","assistance","draft","header","pause","question","skip","submit","timer"]),
  "fabraka.local.discussion": Object.freeze(["continue","discussion","header","option","pause","question","timer"]),
  "fabraka.local.vote": Object.freeze(["header","option","pause","question","skip","submit"]),
  "fabraka.local.gather": Object.freeze(["continue","header","pause"]),
  "fabraka.local.reveal": Object.freeze(["header","pause","question","reveal","reveal-card"]),
  "fabraka.local.roundEnd": Object.freeze(["continue","header","pause","round-scores"]),
  "fabraka.local.over": Object.freeze(["exit","options","podium","restart"]),
  "online.entry": Object.freeze(["avatar-choice","avatar-picker","categories-reset","category-choice","cycles","difficulty","entry","entry-create","entry-join","entry-mode","game-choice.ersomha","game-choice.fabraka","game-choice.meenfina","game-picker","hero","name-input","room-code","start"]),
  "online.lobby": Object.freeze(["allow-replay","categories-reset","category-choice","cycles","difficulty","header","invite","invite-code","invite-copy","invite-qr","invite-share","member","member-remove","players","ready","room-settings","save","start"]),
  "online.chrome": Object.freeze(["connection","exit","room-actions","title","topbar"]),
  "online.meenfina.vote": Object.freeze(["abstain","option","options-list","question","scoreboard","submit","timer","vote-panel"]),
  "online.meenfina.result": Object.freeze(["continue","players","question","scoreboard"]),
  "online.meenfina.over": Object.freeze(["podium","restart"]),
  "online.fabraka.host": Object.freeze(["answer-aliases","answer-input","draft","question","scoreboard","skip","submit","timer"]),
  "online.fabraka.write": Object.freeze(["answer-input","assistance","draft","question","scoreboard","skip","submit","timer"]),
  "online.fabraka.discussion": Object.freeze(["continue","option","question","scoreboard","timer"]),
  "online.fabraka.vote": Object.freeze(["abstain","funny-clear","option","question","scoreboard","submit","timer"]),
  "online.fabraka.reveal": Object.freeze(["question","reveal","scoreboard","timer"]),
  "online.fabraka.result": Object.freeze(["continue","question","round-scores","scoreboard","timer"]),
  "online.fabraka.over": Object.freeze(["podium","restart","round-scores"]),
  "ersomha.select.drawer": Object.freeze(["header","report","timer","title","word-choice","word-choices"]),
  "ersomha.select.guesser": Object.freeze(["header","report","timer","title"]),
  "ersomha.draw.drawer": Object.freeze(["aside","canvas","canvas-panel","clear","color","drawing-tools","eraser","focus-toggle","guesses","header","mic-note","orientation","palette","pen","players","redo","report","timer","title","tools-more","undo","width","widths","word-banner"]),
  "ersomha.draw.guesser": Object.freeze(["aside","canvas","canvas-panel","guess-form","guess-input","guess-send","guesses","header","players","report","timer","title","word-banner"]),
  "ersomha.result.drawer": Object.freeze(["aside","canvas","canvas-panel","guesses","header","players","report","results","timer","title","word-banner"]),
  "ersomha.result.guesser": Object.freeze(["aside","canvas","canvas-panel","guesses","header","players","report","results","timer","title","word-banner"]),
  "ersomha.over": Object.freeze(["podium","restart","results","title"]),
  "ersomha.private-wait": Object.freeze(["privacy","title"]),
  "social.list": Object.freeze(["account-signin","add-friend","code","favorite","friend-accept","friend-avatar","friend-chat","friend-filter","friend-reject","friend-row","group-row","header","list","new-group","preferences","profile","retry","search","search-input","tab.chats","tab.friends","tab.groups","tab.requests","tabs"]),
  "social.conversation": Object.freeze(["account-signin","back","call","composer","game-invite","header","menu","message","message-input","messages","preferences","profile","retry","send"]),
  "social.voice": Object.freeze(["composer","header","menu","message","message-input","messages","profile","record","send","voice-message","voice-play"]),
  "social.group-editor": Object.freeze(["actions","avatar-choice","cancel","close","content","group-name","header","leave-group","member","member-picker","member-role","member-transfer","members","save"]),
  "social.invite": Object.freeze(["actions","cancel","close","content","header","room-code","submit"]),
  "social.preferences": Object.freeze(["close","content","header","notification-enable","notification-setting","notification-toggle"]),
  "social.search": Object.freeze(["add-friend","close","content","header","profile","search-input"]),
  "social.action": Object.freeze(["actions","cancel","close","confirm","content","header","message-input"]),
  "social.call": Object.freeze(["call-collapse","call-drag","close","content","end-call","friend-chat","header","mute","participants","speaker"]),
  "profile": Object.freeze(["account-signin","achievement","achievements","back","badges","bio","code","contact","cover","edit","friend-chat","header","identity","menu","name","retry","share","stat","stats","title"]),
  "profile.editor": Object.freeze(["actions","avatar-choice","avatar-upload","badge-choice","bio-input","cancel","close","content","cover-upload","edit-section","field","header","name-input","save","theme-choice","title-select"]),
  "profile.crop": Object.freeze(["actions","cancel","close","content","crop","header","save","zoom","zoom-input"]),
  "profile.safety": Object.freeze(["actions","cancel","close","content","field","header","report-details","report-reason","submit"]),
  "shell.navigation": Object.freeze(["friends","games","navigation","settings","store"]),
  "shell.game-frame": Object.freeze(["continue","header","home","privacy","sound","title"]),
  "system.dialog": Object.freeze(["actions","cancel","close","confirm","content","header"]),
  "system.sheet": Object.freeze(["cancel","close","confirm","content","header","sheet-drag-handle"]),
  "account.paywall": Object.freeze(["legal","legal-privacy","legal-refunds","legal-terms","plan-option","products","purchase","restore"]),
  "account.signin": Object.freeze(["close","content","header","privacy-note","providers","sheet-drag-handle","signin-apple","signin-google"]),
  "play-setup.teams": Object.freeze(["actions","segment-option","start","team-count","team-name","team-row","teams-setup"]),
  "setup.add-player": Object.freeze(["actions","add-player","avatar-choice","avatar-picker","close","content","header","name-input"]),
  "setup.pass-phone": Object.freeze(["continue","player-name","privacy","privacy-hint","title"]),
  "setup.beep": Object.freeze(["options","segment-option","setting-duration","setting-mode","setting-rounds"]),
  "setup.mamnoo": Object.freeze(["options","segment-option","setting-duration","setting-rounds"]),
  "setup.jabeen": Object.freeze(["category-card","options","segment-option","setting-duration"]),
  "setup.meenfina": Object.freeze(["options","segment-option","setting-mode","setting-rounds"]),
  "setup.fabraka": Object.freeze(["category-card","option","options","rules","segment-option","setting-discussion-time","setting-double","setting-funny","setting-rounds","setting-style","setting-write-time"]),
});

// These controls are state-dependent and intentionally absent from the default fixture.
export const DESIGN_CONDITIONAL_NODE_REASONS = Object.freeze({
  "home": {
    "pricing-link": "Web accounts show the pricing link; the iPhone fixture intentionally omits web checkout.",
    "groups": "Stable exported HomeGroups component; the current Home does not mount this optional group strip.",
    "group-card": "Stable exported HomeGroups component; the current Home does not mount this optional group strip."
  },
  "game-details": {
    "local": "Local play is available for the six local games; the baseline fixture shows the online-only drawing game.",
    "home": "MissingGame renders the home action only for an unknown game link."
  },
  "settings": {},
  "badeeha.home": {
    "resume": "A resumable stored match adds these actions; the isolated default fixture starts without a saved session.",
    "discard-save": "A resumable stored match adds these actions; the isolated default fixture starts without a saved session."
  },
  "badeeha.setup": {
    "download-pack": "Media-bearing selected categories add the download action; the baseline fixture selects a text category."
  },
  "badeeha.board": {
    "cancel": "The finish-match confirmation adds a cancel action after the finish button is pressed."
  },
  "badeeha.question": {
    "assistance": "Question type, media load state and reveal stage determine these real puzzle controls; the baseline fixture is a text question.",
    "hint": "Question type, media load state and reveal stage determine these real puzzle controls; the baseline fixture is a text question.",
    "question-media": "Question type, media load state and reveal stage determine these real puzzle controls; the baseline fixture is a text question.",
    "image-enlarge": "Question type, media load state and reveal stage determine these real puzzle controls; the baseline fixture is a text question.",
    "media-close": "Question type, media load state and reveal stage determine these real puzzle controls; the baseline fixture is a text question.",
    "media-retry": "Question type, media load state and reveal stage determine these real puzzle controls; the baseline fixture is a text question.",
    "tiles-reveal": "Question type, media load state and reveal stage determine these real puzzle controls; the baseline fixture is a text question.",
    "audio-play": "Question type, media load state and reveal stage determine these real puzzle controls; the baseline fixture is a text question.",
    "audio-restart": "Question type, media load state and reveal stage determine these real puzzle controls; the baseline fixture is a text question.",
    "question-audio": "Question type, media load state and reveal stage determine these real puzzle controls; the baseline fixture is a text question."
  },
  "badeeha.history": {
    "share-reports": "The action appears only when locally saved question reports exist."
  },
  "setup.beep": {
    "resume": "SetupOptions shows resume only when memory storage contains a valid resumable match."
  },
  "setup.mamnoo": {
    "resume": "SetupOptions shows resume only when memory storage contains a valid resumable match."
  },
  "setup.jabeen": {
    "resume": "SetupOptions shows resume only when memory storage contains a valid resumable match."
  },
  "setup.meenfina": {
    "resume": "SetupOptions shows resume only when memory storage contains a valid resumable match."
  },
  "setup.fabraka": {
    "resume": "SetupOptions shows resume only when memory storage contains a valid resumable match.",
    "setting-cycles": "Friend mode replaces round-count settings with the existing per-player cycle selector.",
    "history": "A previous completed Fabraka session adds the existing result-history action."
  },
  "fabraka.local.roundEnd": {
    "laugh-award": "The optional laugh-vote result appears only when the completed round has a winning funny answer."
  },
  "jabeen.play": {
    "tilt-retry": "Auto-tilt mode shows the recovery button if the motion permission or sensor becomes unavailable."
  },
  "online.entry": {
    "round-count": "Meenfina room creation uses this round selector; the default creation fixture shows Ersomha settings.",
    "home": "The full Online route adds the shared TopBar around Entry; the narrow isolated Entry fixture omits that route wrapper.",
    "topbar": "The full Online route adds the shared TopBar around Entry; the narrow isolated Entry fixture omits that route wrapper.",
    "title": "The full Online route adds the shared TopBar around Entry; the narrow isolated Entry fixture omits that route wrapper."
  },
  "online.chrome": {
    "dropped": "Disconnected host seats and WebSocket reconnection states reveal these actual room recovery controls.",
    "member-remove": "Disconnected host seats and WebSocket reconnection states reveal these actual room recovery controls.",
    "reconnect": "Disconnected host seats and WebSocket reconnection states reveal these actual room recovery controls."
  },
  "ersomha.draw.drawer": {
    "canvas-status": "Canvas synchronization, paused rounds and network reconnect states show this required status overlay."
  },
  "ersomha.draw.guesser": {
    "canvas-status": "Canvas synchronization, paused rounds and network reconnect states show this required status overlay."
  },
  "ersomha.result.drawer": {
    "canvas-status": "Canvas synchronization, paused rounds and network reconnect states show this required status overlay.",
    "cooperative-result": "Two-player cooperative matches render the shared cooperative result; baseline fixtures use competitive mode."
  },
  "ersomha.result.guesser": {
    "canvas-status": "Canvas synchronization, paused rounds and network reconnect states show this required status overlay.",
    "cooperative-result": "Two-player cooperative matches render the shared cooperative result; baseline fixtures use competitive mode."
  },
  "ersomha.over": {
    "cooperative-result": "Two-player cooperative matches render the shared cooperative result; baseline fixtures use competitive mode."
  },
  "social.list": {
    "friend-invite": "An active room-invitation workflow adds invite buttons to friend and group rows.",
    "group-accept": "Pending group invitations and outgoing friend requests reveal their matching request actions.",
    "group-reject": "Pending group invitations and outgoing friend requests reveal their matching request actions.",
    "friend-cancel": "Pending group invitations and outgoing friend requests reveal their matching request actions."
  },
  "social.conversation": {
    "group-manage": "Group conversations expose member and management controls; the baseline conversation fixture is direct.",
    "members": "Group conversations expose member and management controls; the baseline conversation fixture is direct.",
    "older-messages": "Pagination, off-screen new arrivals, message menus and failed outgoing messages reveal these existing actions.",
    "new-messages": "Pagination, off-screen new arrivals, message menus and failed outgoing messages reveal these existing actions.",
    "message-edit": "Pagination, off-screen new arrivals, message menus and failed outgoing messages reveal these existing actions.",
    "message-delete": "Pagination, off-screen new arrivals, message menus and failed outgoing messages reveal these existing actions.",
    "message-retry": "Pagination, off-screen new arrivals, message menus and failed outgoing messages reveal these existing actions.",
    "report": "Pagination, off-screen new arrivals, message menus and failed outgoing messages reveal these existing actions.",
    "record-stop": "The real microphone recording/review phases reveal these controls; preview never captures microphone data.",
    "record-preview": "The real microphone recording/review phases reveal these controls; preview never captures microphone data.",
    "record-cancel": "The real microphone recording/review phases reveal these controls; preview never captures microphone data.",
    "game-invite-card": "A valid game-invitation message renders its existing join card; the default sample contains text and voice messages.",
    "game-invite-join": "A valid game-invitation message renders its existing join card; the default sample contains text and voice messages."
  },
  "social.voice": {
    "older-messages": "Pagination, off-screen new arrivals, message menus and failed outgoing messages reveal these existing actions.",
    "new-messages": "Pagination, off-screen new arrivals, message menus and failed outgoing messages reveal these existing actions.",
    "message-edit": "Pagination, off-screen new arrivals, message menus and failed outgoing messages reveal these existing actions.",
    "message-delete": "Pagination, off-screen new arrivals, message menus and failed outgoing messages reveal these existing actions.",
    "message-retry": "Pagination, off-screen new arrivals, message menus and failed outgoing messages reveal these existing actions.",
    "report": "Pagination, off-screen new arrivals, message menus and failed outgoing messages reveal these existing actions.",
    "record-stop": "The real microphone recording/review phases reveal these controls; preview never captures microphone data.",
    "record-preview": "The real microphone recording/review phases reveal these controls; preview never captures microphone data.",
    "record-cancel": "The real microphone recording/review phases reveal these controls; preview never captures microphone data.",
    "game-invite-card": "A valid game-invitation message renders its existing join card; the default sample contains text and voice messages.",
    "game-invite-join": "A valid game-invitation message renders its existing join card; the default sample contains text and voice messages."
  },
  "social.group-editor": {
    "member-select": "Only friends outside the group and pending invitations are selectable; the baseline group already contains its sample friends."
  },
  "social.invite": {
    "game-choice": "Creating a new game invite shows game choices and the existing-room toggle; the baseline fixture starts with a supplied room code.",
    "options-list": "Creating a new game invite shows game choices and the existing-room toggle; the baseline fixture starts with a supplied room code.",
    "entry-join": "Creating a new game invite shows game choices and the existing-room toggle; the baseline fixture starts with a supplied room code.",
    "entry-create": "Creating a new game invite shows game choices and the existing-room toggle; the baseline fixture starts with a supplied room code."
  },
  "social.preferences": {
    "members": "The blocked-account list appears only when the account has blocked another user.",
    "member": "The blocked-account list appears only when the account has blocked another user.",
    "unblock": "The blocked-account list appears only when the account has blocked another user."
  },
  "social.search": {
    "friend-chat": "Search returns this action only for an existing friend; other results show the add-friend action."
  },
  "social.action": {
    "report-reason": "Reporting a user/message shows reason and detail fields; the default action fixture edits a message.",
    "report-details": "Reporting a user/message shows reason and detail fields; the default action fixture edits a message."
  },
  "social.call": {
    "call-open": "Collapsed/inline call UI, available output devices and audio-permission recovery reveal these existing controls.",
    "audio-output": "Collapsed/inline call UI, available output devices and audio-permission recovery reveal these existing controls.",
    "resume-audio": "Collapsed/inline call UI, available output devices and audio-permission recovery reveal these existing controls."
  },
  "profile": {
    "add-friend": "Relationship-specific actions appear on another player profile for none/incoming/outgoing request states.",
    "friend-accept": "Relationship-specific actions appear on another player profile for none/incoming/outgoing request states.",
    "friend-cancel": "Relationship-specific actions appear on another player profile for none/incoming/outgoing request states."
  },
  "profile.editor": {
    "avatar-remove": "Image removal actions appear only when an approved image or pending image review exists.",
    "cover-remove": "Image removal actions appear only when an approved image or pending image review exists."
  },
  "account.card": {
    "subscription": "The active subscription state shows manage-subscription instead of the purchase offer."
  },
  "account.paywall": {
    "legal-pricing": "Web checkout alone shows its pricing policy link; the baseline fixture is iPhone."
  },
  "system.dialog": {
    "rules": "Stable MaydanModal/Profile modal content exposes these real child controls when rules, score editing, question reports or share-link dialogs are opened.",
    "score-cards": "Stable MaydanModal/Profile modal content exposes these real child controls when rules, score editing, question reports or share-link dialogs are opened.",
    "score-minus": "Stable MaydanModal/Profile modal content exposes these real child controls when rules, score editing, question reports or share-link dialogs are opened.",
    "score-plus": "Stable MaydanModal/Profile modal content exposes these real child controls when rules, score editing, question reports or share-link dialogs are opened.",
    "undo": "Stable MaydanModal/Profile modal content exposes these real child controls when rules, score editing, question reports or share-link dialogs are opened.",
    "report": "Stable MaydanModal/Profile modal content exposes these real child controls when rules, score editing, question reports or share-link dialogs are opened.",
    "field": "Stable MaydanModal/Profile modal content exposes these real child controls when rules, score editing, question reports or share-link dialogs are opened.",
    "share-link": "Stable MaydanModal/Profile modal content exposes these real child controls when rules, score editing, question reports or share-link dialogs are opened."
  }
});
