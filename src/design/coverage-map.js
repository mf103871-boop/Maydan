// Identical metadata is shared, not repeated in the shipped document.
// Exact explanations retain every Studio meaning; each node list keeps its identity.

const reasonPrivacy = "The entire live council is replaced by the privacy screen when the application is backgrounded.";
const reasonVoiceJoin = "Displayed when voice is disconnected; joining is optional and never assumes microphone consent.";
const reasonObserverNotice = "Displayed only to an eliminated player who remains to observe the ongoing council.";
const reasonChatChannel = "An eliminated observer can switch between public read-only chat and observer chat.";
const reasonComposer = "Shown only when the viewer may speak in the selected channel and current authoritative phase.";
const reasonMessageInput = "Available inside the composer only when this viewer may write in the authoritative phase.";
const reasonSend = "Enabled only for a non-empty permitted message while the authenticated room is connected.";
const reasonHerald = "Displayed only for a living Herald with an unused charge during the discussion phase.";
const reasonReports = "Private evidence is mounted only in its owner-only evidence dialog after the player explicitly opens it.";
const reasonNotebook = "Session-local notes are mounted only in the explicitly opened private notebook dialog, without replacing the public timeline.";
const reasonNotesInput = "The notebook text field is mounted only inside the explicitly opened owner-only notebook dialog.";
const reasonVoiceResume = "Displayed only when the owned active Mafia call reports blocked audio, allowing the player to resume playback with a gesture.";
const reasonCancelAbility = "Displayed after a valid night choice is stored, allowing its owner to cancel before the deadline.";
const reasonReturnCall = "Displayed only when a previous social call can be explicitly resumed after the match ends.";
const reasonAbilitySubmit = "Night action confirmation appears for an available power; Mafia helpers first choose the ability tab.";
const reasonAbility = "Authoritative ability controls are mounted only in the open decision panel for a living assigned player with a current permitted action.";
const reasonChat = "Permitted phase messages are mounted only while the council tab is selected by the viewer.";
const reasonMessages = "The list of messages belongs to the currently visible permitted channel in the council tab.";
const reasonNarrative = "The public phase illustration and explanation appear when the player switches from private notes or evidence to the council tab.";
const reasonEvent = "Public event cards appear in the council timeline only when the player selects that tab and the server has supplied public events.";
const reasonGroups = "Stable exported HomeGroups component; the current Home does not mount this optional group strip.";
const reasonRetiredHome = "Retired Home shortcut retained for saved-design compatibility; friends use the navigation tab and player management now lives in Settings. No placeholder element is mounted.";
const reasonMovedMode = "Retired instruction-page mode action retained for saved-design compatibility; the actual mode choices now live in the home.game-mode bottom sheet before instructions.";
const reasonDirectoryOptions = "This real control is mounted only after the player opens the directory options panel; the default directory fixture keeps that panel closed.";
const directoryConditional = Object.freeze({
  'directory-filter': reasonDirectoryOptions, 'directory-help': reasonDirectoryOptions, 'directory-options-close': reasonDirectoryOptions,
  loading: 'The real directory shows a loading status only while its authenticated room-list request is pending.',
  empty: 'The enabled directory renders this real empty state only when no suitable rooms are returned.',
  notice: 'The real directory displays this status only when its caller supplies a notice about room availability.',
});
const reasonResume = "A resumable stored match adds these actions; the isolated default fixture starts without a saved session.";
const reasonAssistance = "Question type, media load state and reveal stage determine these real puzzle controls; the baseline fixture is a text question.";
const reasonResume2 = "SetupOptions shows resume only when memory storage contains a valid resumable match.";
const reasonHome = "The full Online route adds the shared TopBar around Entry; the narrow isolated Entry fixture omits that route wrapper.";
const reasonDropped = "Disconnected host seats and WebSocket reconnection states reveal these actual room recovery controls.";
const reasonAudioPlay = "Audio questions expose playback and repeat controls; the isolated online fixture shows a clue question.";
const reasonCanvasStatus = "Canvas synchronization, paused rounds and network reconnect states show this required status overlay.";
const reasonCooperativeResult = "Two-player cooperative matches render the shared cooperative result; baseline fixtures use competitive mode.";
const reasonGroupAccept = "Pending group invitations and outgoing friend requests reveal their matching request actions.";
const reasonGroupManage = "Group conversations expose member and management controls; the baseline conversation fixture is direct.";
const reasonOlderMessages = "Pagination, off-screen new arrivals, message menus and failed outgoing messages reveal these existing actions.";
const reasonRecordStop = "The real microphone recording/review phases reveal these controls; preview never captures microphone data.";
const reasonGameInviteCard = "A valid game-invitation message renders its existing join card; the default sample contains text and voice messages.";
const reasonGameChoice = "Creating a new game invite shows game choices and the existing-room toggle; the baseline fixture starts with a supplied room code.";
const reasonMembers = "The blocked-account list appears only when the account has blocked another user.";
const reasonReportReason = "Reporting a user/message shows reason and detail fields; the default action fixture edits a message.";
const reasonCallOpen = "Collapsed/inline call UI, available output devices and audio-permission recovery reveal these existing controls.";
const reasonAddFriend = "Relationship-specific actions appear on another player profile for none/incoming/outgoing request states.";
const reasonAvatarRemove = "Image removal actions appear only when an approved image or pending image review exists.";
const reasonRules = "Stable MaydanModal/Profile modal content exposes these real child controls when rules, score editing, question reports or share-link dialogs are opened.";

// Actual production-node inventory verified by the semantic browser coverage test.
// Each template ID names a semantic component; it never identifies an array index or a user.
export const DESIGN_RENDERED_NODE_IDS = Object.freeze({
  "mafia.tutorial": Object.freeze(["tutorial-disclosure","tutorial-coach","tutorial-exit","tutorial-help-toggle","tutorial-continue"]),
  "online.mafia.tools": Object.freeze(["close","content","header","player-safety","rules","tab.notes"]),
  "online.mafia.spectator": Object.freeze(["chat","event","header","mafia-tools","messages","narrative","observer-delay","phase-title","player-rail","player-seat","players","timer"]),
  "online.mafia.role-card": Object.freeze(["actions","close","content","header","role-content","role-hide"]),
  "online.mafia.history": Object.freeze(["close","content","header","history","history-review","history-reference","history-previous","history-next","refresh","stats"]),
  "online.mafia.privacy": Object.freeze(["privacy"]),
  "online.mafia.guide": Object.freeze(["tutorial-start","specialist-training","back","close","content","continue","header"]),
  "online.mafia.safety": Object.freeze(["block-exit","close","content","header","report-category","report-details","submit"]),
  "online.mafia.setup": Object.freeze(["capacity","mode-choice","mode-option","room-name","rules","visibility","voice-mode"]),
  "online.mafia.directory": Object.freeze(["rules","create-public-room","directory-options","directory-mode","directory-next","directory-previous","directory-status","directory-voice","profile","profile-footer","quick-join","refresh","room","room-join","room-observe","rooms","toolbar"]),
  "online.mafia.lobby": Object.freeze(["chat","close","composer","content","event","header","invite","message-input","messages","player-rail","player-seat","players","ready","room-settings","room-theme","rules","send","start","voice","voice-join"]),
  "online.mafia.role": Object.freeze(["audio-output","chat","event","header","mafia-tools","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.opening": Object.freeze(["audio-output","chat","composer","event","header","mafia-tools","message-input","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","send","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.night": Object.freeze(["ability","ability-submit","audio-output","chat","event","header","mafia-tools","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.dawn": Object.freeze(["audio-output","chat","event","header","mafia-tools","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.discussion": Object.freeze(["audio-output","chat","composer","event","header","mafia-tools","message-input","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","send","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.nomination": Object.freeze(["ability","ability-submit","abstain","audio-output","chat","composer","event","header","mafia-tools","message-input","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","send","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.defense": Object.freeze(["audio-output","chat","defense","event","header","mafia-tools","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.verdict": Object.freeze(["ability","audio-output","chat","composer","event","header","mafia-tools","message-input","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","send","tab.clues","tab.council","tab.notes","tabs","timer","verdict-no","verdict-yes","voice","voice-leave"]),
  "online.mafia.over": Object.freeze(["header","mafia-tools","phase-title","recap","restart","results","rules"]),
  "online.mafia.closed": Object.freeze(["header","mafia-tools","phase-title","recap","results","rules"]),
  "online.mafia.waiting": Object.freeze(["notice","rules"]),
  "online.mafia.night.citizen": Object.freeze(["ability","audio-output","chat","event","header","mafia-tools","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.night.investigator": Object.freeze(["ability","ability-submit","audio-output","chat","event","header","mafia-tools","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.night.doctor": Object.freeze(["ability","ability-submit","audio-output","chat","event","header","mafia-tools","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.night.guard": Object.freeze(["ability","audio-output","chat","event","header","mafia-tools","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.night.observer": Object.freeze(["ability","ability-submit","audio-output","chat","event","header","mafia-tools","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.night.reporter": Object.freeze(["ability","ability-submit","audio-output","chat","event","header","mafia-tools","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.night.herald": Object.freeze(["ability","audio-output","chat","event","header","mafia-tools","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.night.analyst": Object.freeze(["ability","ability-submit","audio-output","chat","event","header","mafia-tools","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.night.mafia": Object.freeze(["ability","abstain","audio-output","chat","composer","event","header","mafia-tools","mafia-vote","message-input","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","send","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.night.masker": Object.freeze(["ability","abstain","audio-output","chat","composer","event","header","mafia-tools","mafia-vote","message-input","messages","mute","narrative","night-ability-tab","night-attack-tab","phase-title","player-rail","player-seat","players","role-card","role-toggle","send","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.night.blocker": Object.freeze(["ability","abstain","audio-output","chat","composer","event","header","mafia-tools","mafia-vote","message-input","messages","mute","narrative","night-ability-tab","night-attack-tab","phase-title","player-rail","player-seat","players","role-card","role-toggle","send","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.night.leader": Object.freeze(["ability","ability-submit","audio-output","chat","composer","event","header","mafia-tools","message-input","messages","mute","narrative","phase-title","player-rail","player-seat","players","role-card","role-toggle","send","tab.clues","tab.council","tab.notes","tabs","timer","voice","voice-leave"]),
  "online.mafia.clues": Object.freeze(["actions","close","content","header","reports","tab.council"]),
  "online.mafia.notes": Object.freeze(["actions","close","content","header","notebook","notes-input","tab.council"]),
  "home": Object.freeze(["brand","footer","game-card.badeeha","game-card.mafia","game-card.beep","game-card.ersomha","game-card.fabraka","game-card.jabeen","game-card.mamnoo","game-card.meenfina","games","header","privacy-link","profile","refunds-link","terms-link","title"]),
  "home.game-mode": Object.freeze(["close","content","header","local-mode","online-mode","sheet-drag-handle"]),
  "game-details": Object.freeze(["actions","back","facts","game-description","game-icon","game-name","hero","skip-instructions","steps","title","topbar"]),
  "players": Object.freeze(["add-player","avatar-choice","avatar-picker","back","name-input","player-remove","player-row","players","title","topbar"]),
  "settings": Object.freeze(["about","clear-data","manage-roster","music-volume","plus-store","pricing-link","privacy-link","refunds-link","setting","setting-toggle","settings-account","settings-audio","settings-experience","settings-local","settings-privacy","settings-support","share-reports","sound-test","sound-volume","terms-link","title","topbar"]),
  "account.card": Object.freeze(["account-delete","account-signin","account-signout","profile","purchase","restore","title"]),
  "store": Object.freeze(["artwork","collection","collection-preview","collection-use","collections","plus-details","plus-retry","store-empty","title","topbar"]),
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
  "online.entry": Object.freeze(["avatar-choice","avatar-picker","categories-reset","category-choice","cycles","difficulty","entry","entry-create","entry-join","entry-mode","entry-public","name-input","room-code","room-name","room-visibility","setup-presets-toggle","start"]),
  ...Object.fromEntries(['badeeha','ersomha','fabraka','meenfina'].map(game => [`online.${game}.directory`, Object.freeze(['toolbar','create-public-room','entry-join','refresh','directory-options','rooms','room','room-join','directory-previous','directory-next','profile-footer','profile'])])),
  "online.lobby": Object.freeze(["allow-replay","appearance-toggle","categories-reset","category-choice","cycles","difficulty","header","invite","invite-code","invite-copy","invite-qr","invite-share","invite-toggle","member","member-remove","players","ready","room-settings","room-theme","rules-toggle","save","start"]),
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
  "online.badeeha.setup": Object.freeze(["category-choice","mode-choice","random-categories","round-size","timer-length"]),
  "online.badeeha.board": Object.freeze(["board","finish","round","scoreboard","tier","turn","undo"]),
  "online.badeeha.question": Object.freeze(["assistance","category","hint","prompt","question","reveal","round","scoreboard","timer","tool","tools","turn"]),
  "online.badeeha.reveal": Object.freeze(["answer","category","judge","judge-nobody","judge-team","prompt","question","round","scoreboard","turn"]),
  "online.badeeha.over": Object.freeze(["podium","restart"]),
  "ersomha.select.drawer": Object.freeze(["header","report","timer","title","word-choice","word-choices"]),
  "ersomha.select.guesser": Object.freeze(["header","report","timer","title"]),
  "ersomha.draw.drawer": Object.freeze(["aside","camera-controls","camera-hand","camera-view","canvas","canvas-panel","clear","color","drawing-tools","eraser","focus-toggle","guesses","header","mic-note","orientation","palette","pen","players","redo","report","timer","title","tools-more","undo","width","widths","word-banner"]),
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
  "profile": Object.freeze(["account-signin","achievement","achievements","back","badges","bio","code","contact","cover","edit","friend-chat","header","identity","menu","name","plus-store","retry","share","stat","stats","title"]),
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
const conditionalNodeReasons = {
  "mafia.tutorial": {
    "tutorial-retry":"The actual rule-engine decision consequence exposes this whole-checkpoint retry only after an incorrect action or a missed deadline.",
    "tutorial-answer":"The two local learning checks expose their explicit choices only after the full two-night scenario has reached its real ending.",
    "tutorial-finish":"Entering live rooms becomes available only after the local scenario, two learning checks and role encyclopedia have been completed.",
    "tutorial-resume":"The resume chooser is mounted only for validated current-owner, current-version decision history saved on this device.",
    "tutorial-restart":"Starting over is offered beside resume for a validated saved lesson; completed lessons replay from the beginning on explicit request.",
    "tutorial-save-exit":"The actual exit confirmation saves the owner-scoped decision prefix and marks the skippable lesson dismissed before navigating.",
    "tutorial-stay":"The actual exit confirmation lets the learner dismiss the dialog and keep the current local checkpoint without changing accounts.",
    "rules":"The real twelve-role encyclopedia is available at the final required reference step, after the scenario and learning checks.",
    "close":"The training exit confirmation exposes the common close action only while its accessible dialog is mounted.",
    "content":"The training exit confirmation owns this common dialog content container only while the learner asks to leave.",
    "header":"The training exit confirmation owns the common dialog heading and close area only during an explicit exit request."
  },
  "online.mafia.lobby": {"event":"Waiting-room event cards appear only when a public event is supplied by the server; a fresh lobby has no dawn or elimination from a prior match."},
  "store": {"earned-cosmetics":"Displayed only for an authenticated owner with a server-issued permanent cosmetic grant; the isolated default store fixture has no earned license. Ownership labels and access to equipping earned items must remain visible."},
  "online.mafia.tools": {},
  "online.mafia.spectator": {},
  "online.mafia.history": {"loading":"Displayed only while the authenticated history request is pending for this account.","error":"Displayed when the history request fails; old account data is never retained as a fallback.","empty":"Displayed only after the server returns a successful empty result for this account."},
  "online.mafia.directory": {"loading":"Displayed only while the authenticated public-room directory request is in flight.","empty":"Displayed only when the feature is enabled and no suitable waiting rooms are returned.","notice":"Displayed only when the service explicitly reports that new Mafia matches are disabled."},
  "online.mafia.role": {"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.opening": {"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.night": {"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.dawn": {"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.discussion": {"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.nomination": {"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.defense": {"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.verdict": {"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.over": {"return-call":reasonReturnCall,"timeline-toggle":"The completed match exposes its real retained, read-only timeline behind this disclosure; no ended-match composer is mounted."},
  "online.mafia.closed": {"return-call":reasonReturnCall,"timeline-toggle":"The technically closed match preserves its real read-only timeline behind this disclosure without reopening chat or secret actions."},
  "online.mafia.night.citizen": {"ability-submit":reasonAbilitySubmit,"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.night.investigator": {"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.night.doctor": {"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.night.guard": {"ability-submit":reasonAbilitySubmit,"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.night.observer": {"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.night.reporter": {"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.night.herald": {"ability-submit":reasonAbilitySubmit,"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.night.analyst": {"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.night.mafia": {"ability-submit":reasonAbilitySubmit,"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.night.masker": {"ability-submit":reasonAbilitySubmit,"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.night.blocker": {"ability-submit":reasonAbilitySubmit,"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.night.leader": {"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"herald":reasonHerald,"reports":reasonReports,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"voice-resume":reasonVoiceResume},
  "online.mafia.clues": {"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"notebook":reasonNotebook,"notes-input":reasonNotesInput,"ability":reasonAbility,"chat":reasonChat,"messages":reasonMessages,"voice-resume":reasonVoiceResume,"narrative":reasonNarrative,"event":reasonEvent},
  "online.mafia.notes": {"cancel-ability":reasonCancelAbility,"privacy":reasonPrivacy,"voice-join":reasonVoiceJoin,"observer-notice":reasonObserverNotice,"chat-channel":reasonChatChannel,"composer":reasonComposer,"message-input":reasonMessageInput,"send":reasonSend,"herald":reasonHerald,"reports":reasonReports,"ability":reasonAbility,"chat":reasonChat,"messages":reasonMessages,"voice-resume":reasonVoiceResume,"narrative":reasonNarrative,"event":reasonEvent},
  "home": {
    "presence": reasonRetiredHome, "tools": reasonRetiredHome, "rooms": reasonRetiredHome, "roster": reasonRetiredHome,
    "pricing-link": "Web accounts show the pricing link; the iPhone fixture intentionally omits web checkout.",
    "groups": reasonGroups,
    "group-card": reasonGroups
  },
  "game-details": {
    "local": reasonMovedMode, "online": reasonMovedMode,
    "home": "MissingGame renders the home action only for an unknown game link."
  },
  "settings": {},
  ...Object.fromEntries(['badeeha','ersomha','fabraka','meenfina'].map(game => [`online.${game}.directory`, directoryConditional])),
  "badeeha.home": {
    "resume": reasonResume,
    "discard-save": reasonResume
  },
  "badeeha.setup": {
    "resume": reasonResume, "discard-save": reasonResume,
    "history": "The platform local entry opens the real team/category setup directly and exposes previous results here; standalone and explicit design-preview entries retain their original Home actions.",
    "rules": "The platform local setup preserves this real rules action after the shared instruction page; explicit standalone/design-preview fixtures retain the legacy Home entry.",
    "download-pack": "Media-bearing selected categories add the download action; the baseline fixture selects a text category."
  },
  "badeeha.board": {
    "cancel": "The finish-match confirmation adds a cancel action after the finish button is pressed."
  },
  "badeeha.question": {
    "assistance": reasonAssistance,
    "hint": reasonAssistance,
    "question-media": reasonAssistance,
    "image-enlarge": reasonAssistance,
    "media-close": reasonAssistance,
    "media-retry": reasonAssistance,
    "tiles-reveal": reasonAssistance,
    "audio-play": reasonAssistance,
    "audio-restart": reasonAssistance,
    "question-audio": reasonAssistance
  },
  "badeeha.history": {
    "share-reports": "The action appears only when locally saved question reports exist."
  },
  "setup.beep": {
    "resume": reasonResume2
  },
  "setup.mamnoo": {
    "resume": reasonResume2
  },
  "setup.jabeen": {
    "resume": reasonResume2
  },
  "setup.meenfina": {
    "resume": reasonResume2
  },
  "setup.fabraka": {
    "resume": reasonResume2,
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
    "room-name": "The real room-name field is mounted only after public visibility is chosen; the default isolated create form starts with private visibility.",
    ...Object.fromEntries(['game-picker','game-choice.badeeha','game-choice.ersomha','game-choice.fabraka','game-choice.mafia','game-choice.meenfina','hero'].map(id => [id, 'Retired cross-game entry selector retained for saved-design compatibility; the selected game is now fixed by its route and the shared mode sheet, without placeholder controls.'])),
    "my-history":"Displayed only for a signed-in account while Mafia is the selected game; its data is account scoped.","entry-public":"Available only after selecting Mafia; opens the existing-room directory without creating a paid room.",
    "round-count": "Meenfina room creation uses this round selector; the default creation fixture shows Ersomha settings.",
    "home": reasonHome,
    "topbar": reasonHome,
    "title": reasonHome
  },
  "online.lobby": {
    "host-handover": "Shown only to a Mafia host while another seat is connected; the waiting-room fixture is an Ersomha room."
  },
  "online.chrome": {"observer-join":"Shown only for an authenticated delayed observer when the authoritative snapshot permits promotion to a waiting seat.",
    "dropped": reasonDropped,
    "member-remove": reasonDropped,
    "reconnect": reasonDropped
  },
  "online.badeeha.question": {
    "question-media": "Other question types render image/audio/video media; the isolated online fixture shows a clue question.",
    "image-enlarge": "Image questions expose enlargement after their image loads; the isolated online fixture shows a clue question.",
    "media-close": "An enlarged image exposes its close control; the isolated online fixture does not open an image.",
    "media-retry": "Failed question media exposes the retry control; the isolated online fixture shows no failed media.",
    "tiles-reveal": "The composition image question exposes progressive tiles; the isolated online fixture shows a clue question.",
    "audio-play": reasonAudioPlay,
    "audio-restart": reasonAudioPlay,
    "question-audio": "A synthetic sound question exposes this play button; the isolated online fixture shows a clue question.",
    "options-list": "Choice and ordering question variants render their option list; the isolated fixture shows a clue question."
  },
  "online.badeeha.reveal": {
    "question-media": "Revealed image/audio/video question variants retain media; the isolated online fixture shows a clue question.",
    "image-enlarge": "Revealed image questions expose enlargement; the isolated online fixture shows a clue question.",
    "media-close": "An enlarged revealed image exposes its close control; the isolated online fixture does not open an image.",
    "media-retry": "Failed revealed media exposes a retry control; the isolated online fixture shows no failed media.",
    "audio-play": "Revealed audio questions retain playback controls; the isolated online fixture shows a clue question.",
    "audio-restart": "Revealed audio questions retain repeat controls; the isolated online fixture shows a clue question.",
    "question-audio": "A revealed synthetic sound question retains playback; the isolated online fixture shows a clue question.",
    "options-list": "Revealed choice/order question variants render the options; the isolated online fixture shows a clue question."
  },
  "ersomha.draw.drawer": {
    "canvas-status": reasonCanvasStatus
  },
  "ersomha.draw.guesser": {
    "canvas-status": reasonCanvasStatus
  },
  "ersomha.result.drawer": {
    "canvas-status": reasonCanvasStatus,
    "cooperative-result": reasonCooperativeResult
  },
  "ersomha.result.guesser": {
    "canvas-status": reasonCanvasStatus,
    "cooperative-result": reasonCooperativeResult
  },
  "ersomha.over": {
    "cooperative-result": reasonCooperativeResult
  },
  "social.list": {
    "friend-invite": "An active room-invitation workflow adds invite buttons to friend and group rows.",
    "group-accept": reasonGroupAccept,
    "group-reject": reasonGroupAccept,
    "friend-cancel": reasonGroupAccept
  },
  "social.conversation": {
    "group-manage": reasonGroupManage,
    "members": reasonGroupManage,
    "older-messages": reasonOlderMessages,
    "new-messages": reasonOlderMessages,
    "message-edit": reasonOlderMessages,
    "message-delete": reasonOlderMessages,
    "message-retry": reasonOlderMessages,
    "report": reasonOlderMessages,
    "record-stop": reasonRecordStop,
    "record-preview": reasonRecordStop,
    "record-cancel": reasonRecordStop,
    "game-invite-card": reasonGameInviteCard,
    "game-invite-join": reasonGameInviteCard
  },
  "social.voice": {
    "older-messages": reasonOlderMessages,
    "new-messages": reasonOlderMessages,
    "message-edit": reasonOlderMessages,
    "message-delete": reasonOlderMessages,
    "message-retry": reasonOlderMessages,
    "report": reasonOlderMessages,
    "record-stop": reasonRecordStop,
    "record-preview": reasonRecordStop,
    "record-cancel": reasonRecordStop,
    "game-invite-card": reasonGameInviteCard,
    "game-invite-join": reasonGameInviteCard
  },
  "social.group-editor": {
    "member-select": "Only friends outside the group and pending invitations are selectable; the baseline group already contains its sample friends."
  },
  "social.invite": {
    "game-choice": reasonGameChoice,
    "options-list": reasonGameChoice,
    "entry-join": reasonGameChoice,
    "entry-create": reasonGameChoice
  },
  "social.preferences": {
    "members": reasonMembers,
    "member": reasonMembers,
    "unblock": reasonMembers
  },
  "social.search": {
    "friend-chat": "Search returns this action only for an existing friend; other results show the add-friend action."
  },
  "social.action": {
    "report-reason": reasonReportReason,
    "report-details": reasonReportReason
  },
  "social.call": {
    "call-open": reasonCallOpen,
    "audio-output": reasonCallOpen,
    "resume-audio": reasonCallOpen
  },
  "profile": {
    "mafia-progress-refresh": "The real Mafia progress panel renders this refresh action for a signed-in profile; guest profiles do not mount the account-scoped progress panel.",
    "add-friend": reasonAddFriend,
    "friend-accept": reasonAddFriend,
    "friend-cancel": reasonAddFriend
  },
  "profile.editor": {
    "avatar-remove": reasonAvatarRemove,
    "cover-remove": reasonAvatarRemove
  },
  "account.card": {
    "subscription": "The active subscription state shows manage-subscription instead of the purchase offer."
  },
  "account.paywall": {
    "legal-pricing": "Web checkout alone shows its pricing policy link; the baseline fixture is iPhone."
  },
  "system.dialog": {
    "member-host": "The Mafia host's handover dialog lists each other connected seat as a choice; the generic fixture is a confirmation.",
    "rules": reasonRules,
    "score-cards": reasonRules,
    "score-minus": reasonRules,
    "score-plus": reasonRules,
    "undo": reasonRules,
    "report": reasonRules,
    "field": reasonRules,
    "share-link": reasonRules
  }
};
const liveCouncil = /^online\.mafia\.(?:role|opening|night(?:\..+)?|dawn|discussion|nomination|defense|verdict|spectator)$/;
const legacyPrivateCouncilIds = ['audio-output','mafia-tools','mute','phase-title','player-rail','player-seat','players','role-card','role-toggle','tab.clues','tab.notes','tabs','timer','voice','voice-leave'];
export const DESIGN_CONDITIONAL_NODE_REASONS = Object.freeze(Object.fromEntries(Object.entries(conditionalNodeReasons).map(([screen, reasons]) => {
  const next = { ...reasons };
  if (liveCouncil.test(screen)) {
    next.ability = reasonAbility;
    next.narrative = 'The legacy standalone phase narrative is retained for saved-design compatibility; the dense live layout now renders authorized event cards inside the public timeline instead.';
    next['action-open'] = 'The real decision trigger appears only for a living assigned player with authoritative actions in this phase; opening it never submits the decision.';
    next['event-overlay'] = 'A noninteractive visual effect is mounted only for a fresh authorized public event, never for the initial snapshot or a private role event.';
    next['load-older'] = 'The current permitted channel shows this real pagination action only when its local visible window omits older authorized messages.';
    next['new-messages'] = 'The current permitted channel exposes this real return action only when new authorized messages arrive while the player reads earlier messages.';
    next.tabs = 'Retired inline tab bar retained for saved-design compatibility; evidence and notes now open real private dialogs while the council remains visible.';
    next['tab.notes'] = 'The existing notes action moved inside the explicitly opened online.mafia.tools dialog; no hidden placeholder is mounted in the public council.';
    next['tab.council'] = 'The existing return-to-council action is now inside the owner-only evidence or notes dialog; the public timeline no longer needs an inline return tab.';
  }
  if (screen === 'online.mafia.directory') {
    Object.assign(next, directoryConditional);
    for (const id of ['actions','header']) next[id] = 'Retired oversized directory heading/action wrapper retained for saved-design compatibility; the real compact toolbar now owns room creation, refresh and entry actions.';
  }
  if (['online.mafia.over','online.mafia.closed'].includes(screen)) {
    for (const id of ['chat','messages','event']) next[id] = 'The retained authorized timeline appears only after its finished-match disclosure is opened; this history is read-only and never mounts a composer.';
    next['chat-channel'] = 'An eliminated participant may select an already authorized retained channel inside the opened finished-match history; sending remains disabled.';
    next['load-older'] = 'Older retained authorized rows can be paged inside the opened finished-match history when they exceed its visible window; no chat is sent.';
    next['new-messages'] = 'The retained timeline offers this return control when its previously scrolled view has unread authorized rows, including the final public event.';
  }
  if (['online.mafia.clues','online.mafia.notes'].includes(screen)) {
    for (const id of legacyPrivateCouncilIds) next[id] = 'Legacy public-council control retained for saved-design compatibility; it remains in its owning public phase underneath the private dialog, not duplicated inside it.';
  }
  return [screen, Object.freeze(next)];
})));
