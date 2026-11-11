// QA only: the real components below use isolated, labelled fixture contexts.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DesignProvider } from '../../src/design/DesignProvider.jsx';
import { PreviewProviders, PlatformDesignScene } from '../../src/design/preview-platform.jsx';
import { DesignScene } from '../../src/design/preview-scenes.jsx';
import { DESIGN_SCENES, getDesignScene } from '../../src/design/screen-catalog.js';
import { createDefaultDesign } from '../../src/design/schema.js';
import onlineCss from '../../src/online/online.css';
import profileCss from '../../src/profiles/profile.css';
const doc=createDefaultDesign();
const states = ['normal', 'empty', 'loading', 'error', 'offline'];
const params = new URLSearchParams(location.search);
const capture = params.get('capture') === '1';
class Boundary extends React.Component{state={error:null};static getDerivedStateFromError(error){return {error:error.message};}render(){return this.state.error?<p role="alert" data-fixture-error>{this.state.error}</p>:this.props.children;}}
function App(){
  const [still,setStill]=useState(true);
  useEffect(()=>{document.documentElement.dataset.reducedMotion=String(still);},[still]);
  const [id,setId]=useState(params.get('scene') || 'home');
  const [state,setState]=useState(states.includes(params.get('state')) ? params.get('state') : 'normal');
  const scene=getDesignScene(id);
  if (!scene) return <p role="alert" data-fixture-error>حالة الفحص غير مسجلة.</p>;
  const specialised=scene.id==='play-setup'||scene.id.startsWith('play-setup.')||scene.id.startsWith('setup.')||['account.signin','online.chrome'].includes(scene.id);
  const platform=id=><PlatformDesignScene sceneId={id} previewState={state}/>;
  return <><style>{onlineCss}{profileCss}</style>{!capture && <header data-fixture-controls style={{display:'flex',gap:6,flexWrap:'wrap',padding:8,background:'#eadcf5',color:'#30203f',font:'12px system-ui'}}>
    <strong>فحص حالات معزول · ليس مباراة فعلية</strong><select aria-label="حالة الفحص" value={scene.id} onChange={e=>setId(e.target.value)}>{DESIGN_SCENES.map(s=><option key={s.id} value={s.id}>{s.id}</option>)}</select>
    <select aria-label="حالة البيانات" value={state} onChange={e=>setState(e.target.value)}>{states.map(v=><option key={v}>{v}</option>)}</select><label><input type="checkbox" checked={still} onChange={e=>setStill(e.target.checked)}/> تثبيت الحركة للقياس</label><a href="/">العودة للعبة</a></header>}
    <main data-fixture-scene={scene.id} data-fixture-state={state} key={scene.id+state}><Boundary><DesignProvider document={doc} editing={false} preview><PreviewProviders sceneId={scene.id} previewState={state}>{scene.renderer==='platform'&&!specialised?platform(scene.id):<DesignScene sceneId={scene.id} renderPlatform={platform}/>}</PreviewProviders></DesignProvider></Boundary></main></>;
}
createRoot(document.getElementById('root')).render(<App/>);
