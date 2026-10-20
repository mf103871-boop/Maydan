import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDesign, validateDesignDocument, designProfile, tokenStyle, nodeStyle } from '../src/design/schema.js';
import { DESIGN_SCREENS, getNodeDefinition } from '../src/design/registry.js';

const nodeDocument = (node, screenId = 'players', nodeId = 'back') => ({ ...createDefaultDesign(), screens: { [screenId]: { nodes: { [nodeId]: node }, decorations: [] } } });
const valid = document => validateDesignDocument(document).ok;

test('default document is valid, deterministic and does not share mutable nested objects', () => {
  const first = createDefaultDesign(), second = createDefaultDesign();
  assert.equal(valid(first), true); assert.deepEqual(first, second);
  first.tokens['--text'] = '#000000'; assert.deepEqual(second.tokens, {});
  assert.equal(DESIGN_SCREENS.length > 60, true);
});
test('all malformed top-level values return a validation result without throwing',()=>{
  for(const value of [null,undefined,[],0,'design',false]){let result;assert.doesNotThrow(()=>{result=validateDesignDocument(value);});assert.equal(result.ok,false);}
});
test('only registered screens and semantic nodes are editable; unknown schema versions fail closed', () => {
  assert.equal(valid(nodeDocument({ text: 'العودة' })), true);
  for (const document of [{ ...createDefaultDesign(), schemaVersion: 2 }, { ...createDefaultDesign(), registryVersion: 2 }, nodeDocument({}, 'missing-screen'), nodeDocument({}, 'home', 'missing-node')]) assert.equal(valid(document), false);
});
test('required actions retain visibility, minimum opacity and opaque legible colours', () => {
  assert.equal(getNodeDefinition('players','back').required, true);
  assert.equal(valid(nodeDocument({ visible: false })), false);
  assert.equal(valid(nodeDocument({ text: '  ', icon: 'none' })), false,'required action cannot lose its accessible visible label');
  assert.equal(valid(nodeDocument({ style: { opacity: .74 } })), false);
  assert.equal(valid(nodeDocument({ style: { opacity: 1, color: '#352547', backgroundColor: '#fff8eb' } })), true);
  for (const color of ['#35254700','#ffffff00','#00000080']) assert.equal(valid(nodeDocument({ style: { color } })), false, `required text alpha: ${color}`);
  assert.equal(valid(nodeDocument({ style: { color: '#ffffff', backgroundColor: '#ffffff' } })), false, 'a required button cannot become white text on white');
});
test('protected structural parents cannot hide their required controls', () => {
  for (const [screenId,nodeId] of [['ersomha.draw.drawer','canvas-panel'],['ersomha.draw.guesser','guess-form'],['settings','settings-account'],['settings','settings-privacy']]) {
    assert.ok(getNodeDefinition(screenId,nodeId));
    assert.equal(valid(nodeDocument({ visible: false }, screenId, nodeId)), false, `${screenId}:${nodeId}`);
    assert.equal(valid(nodeDocument({ style: { opacity: 0 } }, screenId, nodeId)), false, `${screenId}:${nodeId}:opacity`);
  }
});
test('theme text tokens cannot hide all controls with transparent or unreadable text', () => {
  for (const key of ['--text','--accent-ink']) assert.equal(valid({ ...createDefaultDesign(), tokens: { [key]: '#35254700' } }), false, key);
  assert.equal(valid({ ...createDefaultDesign(), tokens: { '--text': '#ffffff', '--bg': '#ffffff' } }), false);
});
test('strict CSS colour types and syntax reject malformed hex, arrays, URLs and executable values', () => {
  for (const color of ['#abc12','#12345','red','url(https://evil.test/x)','var(--private)', 'expression(alert(1))',['#ffffff'], { value:'#ffffff' }]) assert.equal(valid(nodeDocument({ style: { color } })), false, JSON.stringify(color));
  for (const style of [{ transform: 'translate(0)' }, { position: 'fixed' }, { zIndex: 100000 }, { backgroundImage: 'url(https://evil.test)' }, { fontSize: Infinity }, { opacity: NaN }]) assert.equal(valid(nodeDocument({ style })), false);
  assert.equal(valid(nodeDocument({ style: { borderRadius: 16, fontSize: 20, boxShadow: 'soft' } })), true);
});
test('unsafe prototype keys at every editable level are rejected without prototype pollution', () => {
  const cases = [
    JSON.parse('{"schemaVersion":1,"registryVersion":1,"tokens":{},"screens":{},"assets":[],"__proto__":{"polluted":true}}'),
    { ...createDefaultDesign(), tokens: JSON.parse('{"__proto__":{"polluted":true}}') },
    { ...createDefaultDesign(), screens: JSON.parse('{"constructor":{"prototype":{"polluted":true}}}') },
    nodeDocument(JSON.parse('{"style":{"__proto__":{"polluted":true}}}')),
    nodeDocument({ layouts: JSON.parse('{"portrait":{"constructor":"x"}}') }),
  ];
  for (const document of cases) assert.equal(valid(document), false);
  assert.equal({}.polluted, undefined);
});
test('normalized geometry and anchors are bounded and finite', () => {
  assert.equal(valid(nodeDocument({ layouts: { portrait: { x: 0, y: 1, width: .02, height: 'auto', anchorX: 'right', anchorY: 'bottom', z: 40 } } })), true);
  for (const layout of [{x:-.01},{x:1.01},{y:Infinity},{width:0},{width:1.01},{height:0},{height:'100vh'},{anchorX:'start'},{anchorY:'middle'},{z:41},{z:1.5}]) assert.equal(valid(nodeDocument({ layouts: { portrait: layout } })), false, JSON.stringify(layout));
  assert.equal(valid(nodeDocument({ layouts: { mobile: {} } })), false);
});
test('assets must be attached before a decoration can reference them, malformed containers never throw', () => {
  const document = { ...createDefaultDesign(), assets: ['asset-1'], screens: { home: { nodes: {}, decorations: [{ id:'image-1',type:'image',assetId:'asset-1' }] } } };
  assert.equal(valid(document), true);
  assert.equal(valid({ ...document, assets: [] }), false);
  assert.equal(valid({ ...document, assets: ['asset-1','asset-1'] }), false);
  for (const assets of [{},'asset-1',42,null]) {
    let checked; assert.doesNotThrow(() => { checked = validateDesignDocument({ ...document, assets }); }); assert.equal(checked.ok, false);
  }
  assert.equal(valid({ ...document, screens: { home: { decorations: [{id:'a',type:'text',text:'a'},{id:'a',type:'text',text:'b'}] } } }), false);
});
test('HTML-looking labels remain plain strings and rendering styles use a finite preset vocabulary', () => {
  const label = '<img src=x onerror=alert(1)>';
  const result = validateDesignDocument(nodeDocument({ text: label })); assert.equal(result.ok, true); assert.equal(result.document.screens.players.nodes.back.text, label);
  assert.deepEqual(nodeStyle({ fontFamily:'system',boxShadow:'none' }), { fontFamily:'system-ui, sans-serif',boxShadow:'none' });
  assert.deepEqual(tokenStyle({ '--radius':12,'--font':'system' }), { '--radius':'12px','--font':'system-ui, sans-serif' });
});
test('orientation profiles use the short side for large layouts and phone orientation for the others', () => {
  assert.equal(designProfile(390,844),'portrait'); assert.equal(designProfile(844,390),'landscape'); assert.equal(designProfile(1280,800),'large'); assert.equal(designProfile(800,1280),'large');
});
