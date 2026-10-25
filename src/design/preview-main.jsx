import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { DesignProvider } from './DesignProvider.jsx';
import { DesignScene } from './preview-scenes.jsx';
import { PreviewProviders,PlatformDesignScene } from './preview-platform.jsx';
import { getDesignScene } from './screen-catalog.js';
import { getNodeDefinition,getScreenDefinition } from './registry.js';
import { createDefaultDesign,validateDesignDocument } from './schema.js';
import { contrastRatio } from './geometry.js';

const nonce=new URL(location.href).searchParams.get('nonce');
const origin=location.origin;
const send=(type,fields={})=>{if(parent!==window && /^[A-Za-z0-9_-]{16,100}$/.test(nonce||''))parent.postMessage({type,nonce,...fields},origin);};
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const blank={document:createDefaultDesign(),sceneId:'home',profile:'portrait',mode:'edit',previewState:'normal',assetUrls:{}};
const validationMeta=config=>({sceneId:config.sceneId,profile:config.profile,documentSerial:config.documentSerial});
function measuredNodes(screenId) {
  const nodes={},elements=[];
  for(const element of document.querySelectorAll('[data-design-id]')){
    if(element.closest('[data-design-screen]')?.dataset.designScreen!==screenId)continue;
    const id=element.dataset.designId,box=element.getBoundingClientRect();
    nodes[id] ||= {width:box.width,height:box.height,x:box.left,y:box.top,count:0,visible:box.width>0 && box.height>0};nodes[id].count++;
    elements.push(element);
  }
  return {nodes,elements};
}
function inspect(screenId,documentConfig) {
  const {nodes,elements}=measuredNodes(screenId),errors=[],warnings=[];
  const interactive=elements.filter(el=>el.matches('button,a,input,select,textarea,[role=button]') && el.getClientRects().length);
  for(const el of elements){
    const id=el.dataset.designId,def=getNodeDefinition(screenId,id),box=el.getBoundingClientRect(),custom=documentConfig.screens[screenId]?.nodes?.[id];
    if(!def)continue;
    if(def.required && custom && (!box.width || !box.height || getComputedStyle(el).visibility==='hidden'))errors.push({path:id,message:'عنصر مطلوب غير ظاهر'});
    if(custom?.layouts && interactive.includes(el) && (box.width<43.5 || box.height<43.5))errors.push({path:id,message:'مساحة اللمس يجب ألا تقل عن 44 بكسل'});
    if(custom?.layouts && box.width && (box.left<-.5 || box.right>innerWidth+.5))errors.push({path:id,message:'العنصر يخرج خارج عرض الشاشة'});
    if(custom?.style?.color && custom.style.backgroundColor && contrastRatio(custom.style.color,custom.style.backgroundColor)<4.5)warnings.push({path:id,message:'تباين النص والخلفية ضعيف'});
    if(el.matches('input:not([type=range]):not([type=checkbox]):not([type=radio]),textarea') && parseFloat(getComputedStyle(el).fontSize)<16)warnings.push({path:id,message:'خط الكتابة أصغر من 16 بكسل وقد يسبب التكبير'});
  }
  for(let i=0;i<interactive.length;i++)for(let j=i+1;j<interactive.length;j++){
    const a=interactive[i],b=interactive[j];if(a.contains(b)||b.contains(a))continue;
    if(!documentConfig.screens[screenId]?.nodes?.[a.dataset.designId]?.layouts && !documentConfig.screens[screenId]?.nodes?.[b.dataset.designId]?.layouts)continue;
    const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();
    if(Math.min(x.right,y.right)-Math.max(x.left,y.left)>4 && Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>4)warnings.push({path:a.dataset.designId,message:`يتداخل مع ${getNodeDefinition(screenId,b.dataset.designId)?.label||b.dataset.designId}`});
  }
  for(const el of interactive){
    const id=el.dataset.designId,def=getNodeDefinition(screenId,id),box=el.getBoundingClientRect();
    if(!def?.required)continue;
    const x=box.left+box.width/2,y=box.top+box.height/2;
    if(x<0 || x>innerWidth || y<0 || y>innerHeight)continue;
    const hit=document.elementsFromPoint(x,y).find(item=>!item.closest('[data-studio-resize]'));
    if(!hit || hit===el || el.contains(hit) || hit.contains(el))continue;
    const covering=hit.closest('[data-design-id]'),coveringScope=covering?.closest('[data-design-screen]')?.dataset.designScreen;
    const changed=documentConfig.screens[screenId]?.nodes?.[id]?.layouts || (coveringScope===screenId && documentConfig.screens[screenId]?.nodes?.[covering?.dataset.designId]?.layouts);
    if(changed && coveringScope===screenId)errors.push({path:id,message:'إجراء مطلوب تغطيه طبقة أخرى؛ عدّل الموضع أو ترتيب الطبقات'});
  }
  return {nodes,errors,warnings};
}
class PreviewBoundary extends React.Component {
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(error){return {error};}
  componentDidCatch(error){send('studio:validation',{...this.props.validationMeta,errors:[{message:`تعذر عرض هذه الحالة: ${error.message}`} ]});}
  componentDidUpdate(previous){if(previous.resetKey!==this.props.resetKey && this.state.error)this.setState({error:null});}
  render(){return this.state.error?<p role="alert" style={{padding:24}}>تعذّر عرض هذه الحالة: {this.state.error.message}</p>:this.props.children;}
}
function Preview(){
  const [config,setConfig]=useState(blank),[selection,setSelection]=useState(null),[outline,setOutline]=useState(null),[ready,setReady]=useState(false);
  const latest=useRef(config),drag=useRef(null),selectedElement=useRef(null);latest.current=config;
  useEffect(()=>{
    function receive(event){
      if(event.source!==parent || event.origin!==origin || event.data?.nonce!==nonce)return;
      if(event.data.type==='studio:hello'){send('studio:ready');return;}
      if(event.data.type!=='studio:render' || !getDesignScene(event.data.sceneId))return;
      const result=validateDesignDocument(event.data.document);if(!result.ok){send('studio:validation',{...validationMeta(event.data),errors:result.errors});return;}
      const assetUrls=Object.fromEntries(Object.entries(event.data.assetUrls||{}).filter(([id,url])=>result.document.assets.includes(id) && typeof url==='string' && url.startsWith(`blob:${origin}/`)));
      const next={...event.data,document:result.document,assetUrls};
      if(!drag.current)setConfig(next);
      if(event.data.selectedNodeId)setSelection({nodeId:event.data.selectedNodeId,decoration:!!event.data.selectedDecoration,screenId:event.data.sceneId});else setSelection(null);
      setReady(true);
    }
    window.addEventListener('message',receive);send('studio:ready');
    return()=>window.removeEventListener('message',receive);
  },[]);
  useEffect(()=>{
    if(!ready)return undefined;
    let frame;
    const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const result=inspect(config.sceneId,config.document);send('studio:measure',{nodes:result.nodes});send('studio:validation',{...validationMeta(config),errors:result.errors,warnings:result.warnings});});};
    const observer=new ResizeObserver(measure),observed=new WeakSet();observer.observe(document.body);
    const observeElements=()=>{for(const el of document.querySelectorAll('[data-design-id],[data-design-decoration]'))if(!observed.has(el)){observed.add(el);observer.observe(el);}};
    observeElements();measure();
    // Absolute layout changes do not necessarily resize body. Reinspect after
    // actual element geometry/visibility commits, including deferred React RAFs.
    const mutations=new MutationObserver(()=>{observeElements();measure();});mutations.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','hidden','class']});
    return()=>{cancelAnimationFrame(frame);observer.disconnect();mutations.disconnect();};
  },[config.sceneId,config.document,config.profile,config.documentSerial,ready]);
  useLayoutEffect(()=>{
    if(!selection || config.mode!=='edit'){setOutline(null);return undefined;}
    const candidates=[...document.querySelectorAll(selection.decoration?'[data-design-decoration]':'[data-design-id]')];
    const el=selectedElement.current?.isConnected && (selection.decoration?selectedElement.current.dataset.designDecoration:selectedElement.current.dataset.designId)===selection.nodeId ? selectedElement.current : candidates.find(node=>(selection.decoration?node.dataset.designDecoration:node.dataset.designId)===selection.nodeId && node.closest('[data-design-screen]')?.dataset.designScreen===selection.screenId);
    if(!el){setOutline(null);return undefined;}
    selectedElement.current=el;
    const update=()=>{const box=el.getBoundingClientRect();setOutline(old=>{const value={x:box.left,y:box.top,width:box.width,height:box.height};return JSON.stringify(old)===JSON.stringify(value)?old:value;});};
    update();const observer=new ResizeObserver(update);observer.observe(el);window.addEventListener('scroll',update,true);window.addEventListener('resize',update);
    const timer=setTimeout(update,80);
    return()=>{observer.disconnect();clearTimeout(timer);window.removeEventListener('scroll',update,true);window.removeEventListener('resize',update);};
  },[selection,config.mode,config.document,config.profile]);
  useEffect(()=>{
    const pick=event=>{
      if(latest.current.mode!=='edit' || event.button!==0)return;
      const handle=event.target.closest?.('[data-studio-resize]');
      const element=handle?selectedElement.current:event.target.closest?.('[data-design-decoration],[data-design-id]');
      if(!element)return;
      const scope=element.closest('[data-design-screen]'),screenId=scope?.dataset.designScreen;
      const decoration=!!element.dataset.designDecoration,nodeId=element.dataset.designDecoration||element.dataset.designId;
      const def=decoration?null:getNodeDefinition(screenId,nodeId);if(!scope || (!def&&!decoration))return;
      event.preventDefault();event.stopPropagation();
      if(screenId!==latest.current.sceneId){send('studio:scene',{sceneId:screenId,nodeId,decoration});return;}
      selectedElement.current=element;setSelection({screenId,nodeId,decoration});send('studio:select',{screenId,nodeId,decoration});
      const box=element.getBoundingClientRect(),container=scope.getBoundingClientRect();
      const screen=latest.current.document.screens[screenId]||{},node=decoration?screen.decorations?.find(item=>item.id===nodeId):screen.nodes?.[nodeId];
      const profile=latest.current.profile;
      const layout={x:def?.repeat?0:(box.left-container.left)/container.width,y:def?.repeat?0:(box.top-container.top)/container.height,width:box.width/container.width,height:box.height/Math.max(container.height,innerHeight),anchorX:'left',anchorY:'top',...node?.layouts?.[profile]};
      drag.current={screenId,nodeId,decoration,repeat:!!def?.repeat,element,startX:event.clientX,startY:event.clientY,box,container:{width:container.width,height:Math.max(container.height,innerHeight)},base:latest.current.document,layout,profile,resize:!!handle,moved:false,patches:[]};
    };
    const move=event=>{
      const current=drag.current;if(!current)return;
      const dx=event.clientX-current.startX,dy=event.clientY-current.startY;
      if(Math.abs(dx)+Math.abs(dy)<3 && !current.moved)return;
      event.preventDefault();current.moved=true;
      const round=value=>latest.current.snap?Math.round(value*100)/100:Math.round(value*10000)/10000;
      const layout={...current.layout};
      if(current.resize){layout.width=clamp(round(layout.width+dx/current.container.width),.04,1);layout.height=clamp(round((layout.height==='auto'?.1:layout.height)+dy/current.container.height),.04,1);}
      else{layout.x=clamp(round(layout.x+dx/current.container.width),current.repeat?-1:0,1);layout.y=clamp(round(layout.y+dy/current.container.height),current.repeat?-1:0,1);}
      const patches=[{screenId:current.screenId,nodeId:current.nodeId,decoration:current.decoration,patch:{layouts:{[current.profile]:layout}}}];
      const screen=current.base.screens[current.screenId];
      if(layout.group && !current.resize)for(const[id,node]of Object.entries(screen?.nodes||{})){
        const other=node.layouts?.[current.profile];if(id===current.nodeId || other?.group!==layout.group)continue;
        const repeat=getNodeDefinition(current.screenId,id)?.repeat;
        patches.push({screenId:current.screenId,nodeId:id,decoration:false,patch:{layouts:{[current.profile]:{...other,x:clamp(round((other.x||0)+dx/current.container.width),repeat?-1:0,1),y:clamp(round((other.y||0)+dy/current.container.height),repeat?-1:0,1)}}}});
      }
      if(layout.group && !current.resize)for(const dec of screen?.decorations||[]){
        const other=dec.layouts?.[current.profile];if((current.decoration && dec.id===current.nodeId)||other?.group!==layout.group)continue;
        patches.push({screenId:current.screenId,nodeId:dec.id,decoration:true,patch:{layouts:{[current.profile]:{...other,x:clamp(round((other.x||0)+dx/current.container.width),0,1),y:clamp(round((other.y||0)+dy/current.container.height),0,1)}}}});
      }
      const document=structuredClone(current.base),target=document.screens[current.screenId]||={nodes:{},decorations:[]};
      for(const item of patches){if(item.decoration){const dec=target.decorations.find(value=>value.id===item.nodeId);if(dec)dec.layouts={...dec.layouts,...item.patch.layouts};}else{const node=target.nodes[item.nodeId]||={};node.layouts={...node.layouts,...item.patch.layouts};}}
      if(!validateDesignDocument(document).ok)return;
      current.patches=patches;setConfig(previous=>({...previous,document}));
    };
    const end=()=>{const current=drag.current;drag.current=null;if(current?.moved && current.patches.length)send('studio:patches',{patches:current.patches});};
    const suppress=event=>{if(latest.current.mode==='edit' && event.target.closest?.('[data-design-id],[data-design-decoration],[data-studio-resize]')){event.preventDefault();event.stopPropagation();}};
    document.addEventListener('pointerdown',pick,true);document.addEventListener('pointermove',move,{capture:true,passive:false});document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',end,true);document.addEventListener('click',suppress,true);
    return()=>{document.removeEventListener('pointerdown',pick,true);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',end,true);document.removeEventListener('pointercancel',end,true);document.removeEventListener('click',suppress,true);};
  },[]);
  const scene=getDesignScene(config.sceneId);
  if(!ready)return <p style={{padding:24,color:'#77677c'}}>جارٍ ربط المعاينة…</p>;
  const specialised=scene.id==='play-setup' || scene.id.startsWith('play-setup.') || scene.id.startsWith('setup.') || ['account.signin','online.chrome'].includes(scene.id);
  const content=scene.renderer==='platform' && !specialised?<PlatformDesignScene sceneId={scene.id} previewState={config.previewState}/>:<DesignScene sceneId={scene.id} renderPlatform={id=><PlatformDesignScene sceneId={id} previewState={config.previewState}/>}/>;
  return <>
    <style>{`html,body{margin:0;min-height:100%;}body{overflow-x:clip;}[data-design-screen]{scroll-margin-top:10px;}[data-preview-mode=edit] *{cursor:default !important;}[data-preview-mode=edit] [data-design-decoration]{pointer-events:auto!important;}`}</style>
    <div data-preview-mode={config.mode}>
      <PreviewBoundary resetKey={`${scene.id}:${config.previewState}`} validationMeta={validationMeta(config)}>
        <DesignProvider document={config.document} profile={config.profile} editing={false} assetUrls={config.assetUrls}>
          <PreviewProviders sceneId={scene.id} previewState={config.previewState}>{content}</PreviewProviders>
        </DesignProvider>
      </PreviewBoundary>
    </div>
    {outline && config.mode==='edit' && createPortal(<div style={{position:'fixed',left:outline.x,top:outline.y,width:outline.width,height:outline.height,border:'2px solid #087d89',borderRadius:5,pointerEvents:'none',zIndex:1000,boxSizing:'border-box'}}><button data-studio-resize="true" aria-label="تغيير حجم العنصر" style={{position:'absolute',right:-12,bottom:-12,width:44,height:44,minHeight:44,background:'#087d89',color:'white',borderRadius:12,pointerEvents:'auto',border:'3px solid white'}}>↔</button></div>,document.body)}
  </>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
