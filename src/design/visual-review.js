// Review evidence only. Deliberately not imported by the editor or app runtime.
export const VISUAL_REVIEW_VERSION = 1;
export const VISUAL_REVIEW_LOCALES = Object.freeze(['ar', 'en']);
export const VISUAL_REVIEW_VIEWPORTS = Object.freeze([
  { width:320, height:568 }, { width:360, height:800 }, { width:390, height:844 },
  { width:430, height:932 }, { width:844, height:390 }, { width:1024, height:768 },
]);

// A declared gap is a work item, not a completed or exempt screen. Adding an
// editor identity later requires a real fixture and its own runtime review.
export const VISUAL_REVIEW_GAPS = Object.freeze([
  ['startup', 'src/platform/screens/Splash.jsx', ['foreground','background','paused','retry','unsaved']],
  ['moderation', 'src/moderation/ModerationScreen.jsx', ['guest','forbidden','loading','empty','queue','review','error']],
  ['mafia-labs', 'src/games/mafia/tutorial/labs/MafiaLabs.jsx', ['hub','resume','exercise','result']],
  ['mafia-ranked', 'src/online/MafiaRanked.jsx', ['unavailable','eligible','queued','assigned','uncertain','error']],
  ['mafia-community', 'src/online/MafiaCommunity.jsx', ['loading','empty','club','season','error']],
  ['mafia-review', 'src/online/MafiaReviewDialog.jsx', ['loading','review','error']],
  ['mafia-report-inbox', 'src/online/MafiaReportInbox.jsx', ['loading','empty','report','error']],
  ['app-error', 'src/shared/ui/components.jsx', ['error','recovery']],
  ['native-update', 'ios/Maydan/AppUpdateCoordinator.swift', ['required','retry','store-open-error']],
].map(([id, path, plannedStates]) => Object.freeze({ id, path, plannedStates:Object.freeze(plannedStates), status:'unmapped' })));

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const identity = value => typeof value === 'string' && /^[a-z0-9/_][a-z0-9/_@.:-]*$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const revision = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const artifact = value => object(value) && text(value.path) && !/[:\\?#\0]/.test(value.path) &&
  !value.path.startsWith('/') && !value.path.split('/').some(part => !part || part === '..' || part === '.') && hash(value.sha256);
const source = value => object(value) && revision(value.revision) && hash(value.fingerprint);
const viewport = value => object(value) && Number.isInteger(value.width) && value.width > 0 && value.width <= 10000 &&
  Number.isInteger(value.height) && value.height > 0 && value.height <= 10000;
const context = value => object(value) && ['screen','state','role'].every(key => text(value[key])) &&
  VISUAL_REVIEW_LOCALES.includes(value.locale) && viewport(value.viewport);
export function sameVisualContext(a, b) {
  return context(a) && context(b) && ['screen','state','role','locale'].every(key => a[key] === b[key]) &&
    a.viewport.width === b.viewport.width && a.viewport.height === b.viewport.height;
}
const sameSource = (a, b) => source(a) && source(b) && a.revision === b.revision && a.fingerprint === b.fingerprint;
const approval = value => object(value) && value.status === 'approved' && value.kind === 'user' && text(value.actorId) && artifact(value.evidence);

/**
 * A schema gate, not an image grader or proof that an asserted identity is real.
 * The capture runner supplies actual byte hashes; two named independent humans
 * or agents must inspect the corresponding artifacts. No numerical average can
 * override a missing reference, stale capture, dissent or blocking finding.
 */
export function evaluateVisualReview(record) {
  const issues = [];
  const check = (ok, code) => { if (!ok) issues.push(code); };
  if (!object(record)) return { decision:'blocked', issues:['record.invalid'] };
  check(record.schemaVersion === VISUAL_REVIEW_VERSION, 'record.version');
  check(context(record), 'record.context');
  check(source(record.source), 'record.source');
  const authors = record.authorIds;
  check(Array.isArray(authors) && authors.length > 0 && authors.every(identity) && new Set(authors).size === authors.length, 'record.authors');
  const authorSet = new Set(Array.isArray(authors) ? authors : []);
  const ref = record.reference, capture = record.evidence;
  check(object(ref) && text(ref.id) && artifact(ref.artifact), 'reference.artifact');
  check(approval(ref?.approval), 'reference.approval');
  check(hash(ref?.approval?.approvedArtifactSHA256) && ref.approval.approvedArtifactSHA256 === ref?.artifact?.sha256, 'reference.approved-artifact');
  check(Array.isArray(ref?.approval?.approvedTargets) && ref.approval.approvedTargets.some(target => sameVisualContext(target, record)), 'reference.approved-target');
  check(Array.isArray(ref?.targets) && ref.targets.some(target => sameVisualContext(target, record)), 'reference.target');
  check(object(capture) && ['browser','native'].includes(capture.kind) && capture.actualComponent === true &&
    typeof capture.syntheticData === 'boolean' && artifact(capture.artifact) && text(capture.runner) &&
    text(capture.capturedAt) && Number.isFinite(Date.parse(capture.capturedAt)), 'capture.actual');
  check(sameVisualContext(capture?.context, record), 'capture.context');
  check(sameSource(capture?.source, record.source), 'capture.source');
  check(capture?.referenceSHA256 === ref?.artifact?.sha256 && hash(capture?.referenceSHA256), 'capture.reference');
  const matchesSubject = value => object(value) && sameVisualContext(value.context, record) &&
    sameSource(value.source, record.source) && hash(value.captureSHA256) && hash(value.referenceSHA256) &&
    value.captureSHA256 === capture?.artifact?.sha256 && value.referenceSHA256 === ref?.artifact?.sha256;
  const critics = Array.isArray(record.critics) ? record.critics : [];
  check(critics.length === 2, 'critics.count');
  check(critics.length === 2 && critics.every(row => object(row) && identity(row.reviewerId)) &&
    new Set(critics.map(row => row.reviewerId)).size === 2 && critics.every(row => !authorSet.has(row.reviewerId)), 'critics.independence');
  check(critics.length === 2 && critics.some(row => row?.discipline === 'art') && critics.some(row => row?.discipline === 'ux'), 'critics.disciplines');
  const deviations = Array.isArray(record.approvedDeviations) ? record.approvedDeviations : [];
  check(Array.isArray(record.approvedDeviations), 'deviations.list');
  check(new Set(deviations.map(row => `${row?.reviewerId}:${row?.findingId}`)).size === deviations.length, 'deviations.duplicate');
  for (const deviation of deviations) {
    check(object(deviation) && text(deviation.reviewerId) && text(deviation.findingId) && text(deviation.reason) &&
      approval(deviation.approval) && matchesSubject(deviation.subject), 'deviation.invalid');
    check(critics.some(row => row?.reviewerId === deviation?.reviewerId && Array.isArray(row?.findings) && row.findings.some(finding =>
      finding?.id === deviation?.findingId && finding?.status === 'open' && ['P2','P3'].includes(finding?.priority) && finding?.blocking === false)), 'deviation.not-eligible');
  }
  for (const critic of critics) {
    check(object(critic) && critic.decision === 'accept', 'critic.decision');
    check(matchesSubject(critic?.subject), 'critic.subject');
    check(artifact(critic?.report), 'critic.report');
    check(Array.isArray(critic?.findings), 'critic.findings');
    const findings = Array.isArray(critic?.findings) ? critic.findings : [];
    check(new Set(findings.map(row => row?.id)).size === findings.length, 'finding.duplicate');
    for (const finding of findings) {
      const valid = object(finding) && text(finding.id) && text(finding.summary) && ['P0','P1','P2','P3'].includes(finding.priority) &&
        ['open','resolved'].includes(finding.status) && typeof finding.blocking === 'boolean';
      check(valid, 'finding.invalid');
      if (!valid) continue;
      if (finding.status === 'resolved') {
        check(artifact(finding.resolution?.evidence) && finding.resolution?.captureSHA256 === capture?.artifact?.sha256, 'finding.resolution');
      } else if (finding.blocking || ['P0','P1'].includes(finding.priority)) check(false, 'finding.blocking');
      else check(deviations.some(row => row?.reviewerId === critic.reviewerId && row?.findingId === finding.id &&
        approval(row.approval) && matchesSubject(row.subject) && text(row.reason)), 'finding.unapproved-deviation');
    }
  }
  return { decision:issues.length ? 'blocked' : 'accepted', issues:[...new Set(issues)] };
}
