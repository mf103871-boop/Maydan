import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DESIGN_SCREENS } from '../src/design/registry.js';
import { evaluateVisualReview, VISUAL_REVIEW_GAPS } from '../src/design/visual-review.js';
import { discoverVisualRoots, assembleVisualInventory } from '../scripts/visual-review-inventory.mjs';

const digest = letter => letter.repeat(64);
const artifact = (name, letter = 'a') => ({ path:`evidence/${name}`,sha256:digest(letter) });
function approvedReview() {
  const context = { screen:'ersomha.draw.guesser',state:'draw-connected',role:'guesser',locale:'en',viewport:{ width:390,height:844 } };
  const source = { revision:'a'.repeat(40),fingerprint:digest('b') };
  const reference = { id:'approved-drawing',artifact:artifact('reference.png','c'),targets:[context],
    approval:{ status:'approved',kind:'user',actorId:'owner',evidence:artifact('reference-approval.json','d'),approvedArtifactSHA256:digest('c'),approvedTargets:[context] } };
  const evidence = { kind:'browser',actualComponent:true,syntheticData:true,runner:'actual-component-fixture',capturedAt:'2026-11-13T00:00:00Z',
    artifact:artifact('capture.png','e'),context,source,referenceSHA256:reference.artifact.sha256 };
  const subject = { context,source,captureSHA256:evidence.artifact.sha256,referenceSHA256:reference.artifact.sha256 };
  // Stored reports are independent JSON values, not shared in-memory aliases.
  return JSON.parse(JSON.stringify({ schemaVersion:1,...context,source,authorIds:['designer'],reference,evidence,
    critics:['critic-a','critic-b'].map((reviewerId,index) => ({ reviewerId,discipline:index === 0 ? 'art' : 'ux',decision:'accept',subject,report:artifact(reviewerId+'.json','f'),findings:[] })),approvedDeviations:[] }));
}
function reject(record, code) { const result = evaluateVisualReview(record); assert.equal(result.decision,'blocked'); if (code) assert.ok(result.issues.includes(code),JSON.stringify(result)); }

test('only exact approved reference, real capture and two current independent acceptances pass', () => {
  assert.deepEqual(evaluateVisualReview(approvedReview()),{ decision:'accepted',issues:[] });
});
test('a different game phase, role, language or viewport cannot borrow another capture', () => {
  for (const [key,value] of [['screen','ersomha.draw.drawer'],['state','over'],['role','drawer'],['locale','ar'],['viewport',{width:844,height:390}]]) {
    const record = approvedReview(); record.evidence.context[key] = value; reject(record,'capture.context');
  }
});
test('same Git HEAD does not admit a capture of older uncommitted source', () => {
  const record = approvedReview();record.evidence.source.fingerprint = digest('c');reject(record,'capture.source');
  const other = approvedReview();other.evidence.source.revision = 'b'.repeat(40);reject(other,'capture.source');
});
test('missing or unapproved reference and unapproved target are blocked', () => {
  for (const mutate of [r=>{r.reference=null;},r=>{r.reference.approval.status='pending';},r=>{r.reference.approval.kind='author';},r=>{r.reference.targets[0].state='another-state';},r=>{r.reference.approval.evidence=null;}]) {
    const record=approvedReview();mutate(record);reject(record);
  }
});
test('replacing reference bytes or expanding its scope cannot reuse the earlier approval', () => {
  const changed=approvedReview();changed.reference.artifact.sha256=digest('a');changed.evidence.referenceSHA256=digest('a');
  for(const critic of changed.critics)critic.subject.referenceSHA256=digest('a');
  reject(changed,'reference.approved-artifact');
  const expanded=approvedReview();expanded.reference.approval.approvedTargets[0].state='earlier-approved-state';
  reject(expanded,'reference.approved-target');
});
test('concept mockup, uncertain component or absent byte evidence is not an actual capture', () => {
  for (const mutate of [r=>{r.evidence.kind='concept';},r=>{r.evidence.actualComponent=false;},r=>{delete r.evidence.syntheticData;},r=>{r.evidence.artifact.sha256='unknown';},r=>{r.evidence.artifact.path='../private.png';}]) {
    const record=approvedReview();mutate(record);reject(record,'capture.actual');
  }
});
test('a duplicate critic, an author reviewing their work, or a missing second critic cannot approve', () => {
  for (const mutate of [r=>{r.critics[1].reviewerId='critic-a';},r=>{r.critics[1].reviewerId='designer';},r=>{r.critics.pop();},r=>{r.critics[1].reviewerId=' Critic-A ';}]) {
    const record=approvedReview();mutate(record);reject(record,'critics.independence');
  }
});
test('independent identities still require one art critic and one UX critic', () => {
  for(const disciplines of [['art','art'],['ux','ux'],['art',null],['quality','ux']]) {
    const record=approvedReview();record.critics.forEach((critic,index)=>{critic.discipline=disciplines[index];});
    reject(record,'critics.disciplines');
  }
});
test('old critic evidence and dissent are not rescued by high numerical scores', () => {
  const old=approvedReview();old.critics[1].subject.captureSHA256=digest('a');reject(old,'critic.subject');
  const dissent=approvedReview();dissent.critics[1].decision='changes-requested';dissent.averageScore=99;dissent.critics[0].score=100;reject(dissent,'critic.decision');
});
test('open P0/P1 or explicitly blocking findings cannot be waived by approved deviations', () => {
  for (const [priority,blocking] of [['P0',false],['P1',false],['P2',true]]) {
    const record=approvedReview();const finding={ id:'action-covered',priority,blocking,status:'open',summary:'Primary action cannot be clicked' };
    record.critics[0].findings.push(finding);
    record.approvedDeviations.push({ reviewerId:'critic-a',findingId:finding.id,reason:'Accepted visual difference',subject:record.critics[0].subject,approval:record.reference.approval });
    record.averageScore=100;reject(record,'finding.blocking');
  }
});
test('a nonblocking deviation must be explicitly approved for this finding and exact evidence', () => {
  const record=approvedReview();record.critics[0].findings.push({ id:'art-spacing',priority:'P2',blocking:false,status:'open',summary:'Intentional spacing differs from the reference' });
  reject(record,'finding.unapproved-deviation');
  record.approvedDeviations.push(structuredClone({ reviewerId:'critic-a',findingId:'art-spacing',reason:'Owner prefers this spacing',subject:record.critics[0].subject,approval:record.reference.approval }));
  assert.equal(evaluateVisualReview(record).decision,'accepted');
  record.approvedDeviations[0].subject.captureSHA256=digest('a');reject(record,'deviation.invalid');
});
test('resolved findings require repair evidence bound to the reviewed capture', () => {
  const record=approvedReview();record.critics[0].findings.push({ id:'repair',priority:'P1',blocking:true,status:'resolved',summary:'Button obstruction repaired' });
  reject(record,'finding.resolution');
  record.critics[0].findings[0].resolution={ evidence:artifact('pointer-check.json'),captureSHA256:record.evidence.artifact.sha256 };
  assert.equal(evaluateVisualReview(record).decision,'accepted');
});
test('malformed JSON-shaped evidence fails closed without throwing', () => {
  const malformedFinding=approvedReview();malformedFinding.critics[0].findings=[null];
  malformedFinding.approvedDeviations=[{reviewerId:'critic-a',findingId:'missing'}];
  for (const value of [null,[],{},malformedFinding, {schemaVersion:1,authorIds:{includes:true},critics:[null,{findings:{some:'not a function'}}],approvedDeviations:[null]}]) {
    assert.doesNotThrow(()=>reject(value));
  }
});
test('AST discovery ignores selectors/comments and reports dynamic or invalid source as unmapped', () => {
  const scan=discoverVisualRoots('src/example.jsx', `const selector='[data-design-screen="not-rendered"]';
    // data-design-screen="also-not-rendered"
    const node=<section data-design-screen="actual.root"/>;
    const expr=<section data-design-screen={"literal.expression"}/>;
    const absent=<section data-design-screen/>;
    const changing=<section data-design-screen={state}/>;
    const props={"data-design-screen":\`game.\${phase}\`};
    const computed={['data-design-screen']:'computed.root'};
    const computedDynamic={['data-design-screen']:phase};`);
  assert.deepEqual(scan.roots.map(row=>row.id),['actual.root','literal.expression','computed.root']);
  assert.equal(scan.dynamic.length,4);assert.ok(scan.dynamic.every(row=>row.status==='unmapped'));
  assert.ok(scan.dynamic.some(row=>row.expressionType==='MissingValue'));
  assert.equal(discoverVisualRoots('src/broken.jsx','const node=<').parseErrors.length,1);
});
test('inventory uses set differences: new roots increase unreviewed scope, never silently pass', () => {
  const source=approvedReview().source;
  const discovery=discoverVisualRoots('src/view.jsx','const view=<main data-design-screen="new.surface"/>;');
  const value=assembleVisualInventory({ registered:[{id:'registered.screen'}],discoveries:[discovery],gaps:[{id:'missing',path:'src/missing.jsx',pathExists:false}],source });
  assert.deepEqual(value.records.map(row=>row.screen),['new.surface','registered.screen']);
  assert.deepEqual(value.differences.unregistered,['new.surface']);
  assert.equal(value.counts.accepted,0);assert.equal(value.complete,false);
  assert.equal(value.unknownPaths[0].file,'src/missing.jsx');assert.equal(value.unsurfacedGaps[0].status,'unmapped');
  for(const row of value.records)reject(row);
});
test('actual registered set and all five currently separate roots remain in the review scope', async () => {
  const files=['src/platform/screens/GameEntry.jsx','src/creator/CreatorDashboard.jsx','src/shared/legal/TermsConsent.jsx','src/shared/account/RedeemSheet.jsx','src/social/SocialHost.jsx'];
  const discoveries=await Promise.all(files.map(async file=>discoverVisualRoots(file,await readFile(file,'utf8'))));
  const inventory=assembleVisualInventory({ registered:DESIGN_SCREENS,discoveries,gaps:VISUAL_REVIEW_GAPS,source:approvedReview().source });
  const ids=new Set(inventory.records.map(row=>row.screen));
  for(const screen of DESIGN_SCREENS)assert.ok(ids.has(screen.id));
  for(const id of ['game.entry','platform.creator','legal.consent','account.redeem','social.conversation-options'])assert.ok(ids.has(id));
  const expected=new Set([...DESIGN_SCREENS.map(row=>row.id),...discoveries.flatMap(scan=>scan.roots.map(row=>row.id))]);
  assert.deepEqual(ids,expected);assert.equal(inventory.counts.accepted,0);assert.equal(inventory.complete,false);
  assert.ok(inventory.unsurfacedGaps.length>0);assert.ok(inventory.unsurfacedGaps.every(row=>row.status==='unmapped'));
});
