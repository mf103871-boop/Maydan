import React, { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DesignContext, DesignScreenContext } from './context.js';
import { nodeStyle } from './schema.js';
import { getNodeDefinition } from './registry.js';
import { designRect } from './geometry.js';

function assignRef(ref,value) { if (typeof ref === 'function') return ref(value); else if (ref) ref.current=value; return undefined; }
export function keyedDesignChildren(children,prefix='design') {
  if(!Array.isArray(children))return children;
  return children.map((child,index)=>Array.isArray(child)?keyedDesignChildren(child,`${prefix}-${index}`):React.isValidElement(child) && child.key==null?React.cloneElement(child,{key:`${prefix}-${index}`}):child);
}
function labelChildren(children,text) {
  if (typeof children === 'string' || typeof children === 'number') return text;
  if (!Array.isArray(children)) return React.isValidElement(children) && typeof children.props.children === 'string' ? React.cloneElement(children,{},text) : children;
  const copy=[...children];
  for(let i=copy.length-1;i>=0;i--) {
    if(typeof copy[i]==='string' || typeof copy[i]==='number') { copy[i]=text;return copy; }
    if(React.isValidElement(copy[i]) && typeof copy[i].props.children==='string') { copy[i]=React.cloneElement(copy[i],{},text);return copy; }
  }
  return children;
}
const icons={games:'🎮',friends:'👥',store:'🛍',settings:'⚙',star:'★',play:'▶',back:'‹',mic:'🎙'};
const plainRect = rect => ({x:rect.x,y:rect.y,left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height});
const viewportHeight = () => window.visualViewport?.height || innerHeight;
function isIcon(child) {
  if(!React.isValidElement(child))return false;
  const name=typeof child.type==='string'?child.type:child.type?.displayName||child.type?.name||child.type?.render?.name||'';
  return ['svg','img','picture'].includes(name) || /Icon|Artwork|Avatar/.test(name)
    || child.props['data-design-icon'] || child.props['aria-hidden']===true
    || /(?:^|\s)(?:icon|[\w-]*-icon)(?:\s|$)/.test(child.props.className||'');
}
function withoutIcons(children) {
  return React.Children.toArray(children).flatMap(child=>{
    if(isIcon(child))return [];
    if(React.isValidElement(child) && (child.type===React.Fragment || ['span','div','b','strong'].includes(child.type)) && child.props.children!=null) {
      const content=withoutIcons(child.props.children);
      return content.length?[React.cloneElement(child,{},content)]:[];
    }
    return [child];
  });
}
function naturalPosition(element,root) {
  const rect=element.getBoundingClientRect(),styles=getComputedStyle(element);
  const ownOffset=element.dataset.designLayoutMode==='offset' && styles.position==='relative';
  return {x:rect.left-root.left-(ownOffset?parseFloat(styles.left)||0:0),y:rect.top-root.top-(ownOffset?parseFloat(styles.top)||0:0),width:rect.width,height:rect.height};
}
const boundedDelta=(value,min,max)=>max<min?0:Math.max(min,Math.min(max,value));

// No extra DOM, no reparenting, and stable React identity while a draft changes.
export function DesignElement({ as, elementProps }) {
  const runtime=useContext(DesignContext), ancestor=useContext(DesignScreenContext);
  const ownScreen=elementProps['data-design-screen'];
  const managedPosition=!!(ownScreen && String(elementProps.className||'').split(/\s+/).includes('call-dock'));
  const screenId=ownScreen || ancestor?.screenId;
  const nodeId=elementProps['data-design-id'];
  const definition=nodeId && screenId ? getNodeDefinition(screenId,nodeId) : null;
  const screen=runtime.document.screens[screenId];
  const node=nodeId ? screen?.nodes?.[nodeId] : null;
  const required=!!(definition?.required || elementProps['data-design-required']);
  const ref=useRef(null), baseline=useRef({profile:null,height:0}), [geometry,setGeometry]=useState(null),[scopeHeight,setScopeHeight]=useState(0);
  const parentRef=ownScreen ? ref : ancestor?.ref;
  const layout=node?.layouts?.[runtime.profile];
  const interactive=['button','a','input','select','textarea'].includes(as) || elementProps.role==='button';
  const repeated=!!(definition?.repeat || ancestor?.managedPosition);
  const hasPositioned=!!ownScreen && !managedPosition && (!!screen?.decorations?.length || Object.values(screen?.nodes||{}).some(value=>value.layouts?.[runtime.profile]));
  const setElement=useCallback(element=>{
    ref.current=element;
    const cleanup=assignRef(elementProps.ref,element);
    if(typeof cleanup==='function')return()=>{ref.current=null;cleanup();};
    return undefined;
  },[elementProps.ref]);
  useLayoutEffect(()=>{
    if(!hasPositioned || !ref.current){setScopeHeight(previous=>previous?0:previous);return undefined;}
    const root=ref.current;let frame;
    const measure=()=>{
      // Reserve normal flow before moving children, and allow that reservation
      // to shrink with the viewport after rotation or keyboard presentation.
      const bounds=root.getBoundingClientRect(),available=Math.max(1,viewportHeight()-Math.max(0,bounds.top));
      const height=Math.min(available,bounds.height || available);
      setScopeHeight(previous=>Math.abs(previous-height)<.5?previous:height);
    };
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
    measure();const observer=new ResizeObserver(schedule);observer.observe(root);window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);
    return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);};
  },[hasPositioned,runtime.profile]);
  useLayoutEffect(()=>{
    if(!layout || !parentRef?.current || !ref.current) {setGeometry(previous=>previous===null?previous:null);return undefined;}
    let frame;
    const measure=()=>{
      const el=ref.current,parent=parentRef.current;
      if(!el || !parent)return;
      const box=parent.getBoundingClientRect(),actual=el.getBoundingClientRect();
      const width=parent.clientWidth || box.width;
      if(!width)return;
      if(baseline.current.profile!==runtime.profile)baseline.current={profile:runtime.profile,height:0};
      const height=Math.min(Math.max(1,viewportHeight()-Math.max(0,box.top)),Math.max(parent.clientHeight,baseline.current.height,1));
      baseline.current.height=height;
      const original={x:actual.left-box.left,y:actual.top-box.top,width:actual.width,height:actual.height};
      if(repeated) {
        const peers=[...parent.querySelectorAll('[data-design-id]')].filter(element=>element.dataset.designId===nodeId && element.closest('[data-design-screen]')===parent);
        const positions=(peers.length?peers:[el]).map(element=>naturalPosition(element,box));
        const minX=Math.min(...positions.map(rect=>rect.x)),minY=Math.min(...positions.map(rect=>rect.y));
        const maxX=Math.max(...positions.map(rect=>rect.x+rect.width)),maxY=Math.max(...positions.map(rect=>rect.y+rect.height));
        const requestedWidth=layout.width==null?undefined:Math.min(el.parentElement?.clientWidth||width,Math.max(interactive?44:1,width*layout.width));
        const next={position:'relative',left:boundedDelta((layout.x||0)*width,-minX,width-maxX),top:boundedDelta((layout.y||0)*height,-minY,height-maxY),...(requestedWidth===undefined?{}:{width:requestedWidth}),...(layout.height==null || layout.height==='auto'?{}:{height:Math.min(height,Math.max(interactive?44:1,height*layout.height))}),zIndex:layout.z||0,minHeight:interactive?44:undefined,minWidth:interactive?44:undefined};
        setGeometry(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);return;
      }
      const rect=designRect(layout,{width,height},original,{required,interactive,square:definition?.aspectRatio===1 || definition?.kind==='canvas'});
      const offset=el.offsetParent;
      const offsetBox=offset?.getBoundingClientRect?.() || {left:0,top:0};
      const next={position:'absolute',left:box.left-offsetBox.left+(offset?.scrollLeft||0)-(offset?.clientLeft||0)+rect.x,top:box.top-offsetBox.top+(offset?.scrollTop||0)-(offset?.clientTop||0)+rect.y,width:rect.width,height:rect.height,zIndex:rect.z,margin:0,maxWidth:'none',minHeight:interactive?44:undefined,minWidth:interactive?44:undefined};
      setGeometry(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
    };
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
    measure();
    const observer=new ResizeObserver(schedule);observer.observe(parentRef.current);observer.observe(ref.current);
    window.visualViewport?.addEventListener('resize',schedule);window.addEventListener('resize',schedule);
    return()=>{observer.disconnect();cancelAnimationFrame(frame);window.visualViewport?.removeEventListener('resize',schedule);window.removeEventListener('resize',schedule);};
  },[layout,parentRef,required,interactive,definition?.aspectRatio,definition?.kind,runtime.profile,repeated,nodeId]);
  const context=useMemo(()=>ownScreen?{screenId:ownScreen,ref,managedPosition}:ancestor,[ownScreen,ancestor,managedPosition]);
  const props={...elementProps,ref:setElement};
  if(repeated)props['data-design-layout-mode']='offset';
  const editableStyle=Array.isArray(definition?.editableStyle)?Object.fromEntries(Object.entries(node?.style||{}).filter(([key])=>definition.editableStyle.includes(key))):node?.style;
  if(node || hasPositioned) props.style={...elementProps.style,...nodeStyle(editableStyle),...geometry,...(hasPositioned?{position:elementProps.style?.position||'relative',minHeight:elementProps.style?.minHeight?`max(${typeof elementProps.style.minHeight==='number'?`${elementProps.style.minHeight}px`:elementProps.style.minHeight}, ${scopeHeight}px)`:scopeHeight||undefined}:{})};
  if(node && interactive)props.style={...props.style,minHeight:props.style?.minHeight?`max(44px, ${typeof props.style.minHeight==='number'?`${props.style.minHeight}px`:props.style.minHeight})`:44,minWidth:props.style?.minWidth?`max(44px, ${typeof props.style.minWidth==='number'?`${props.style.minWidth}px`:props.style.minWidth})`:44,...(as==='a'?{display:'inline-flex',alignItems:'center'}:{})};
  if(node?.visible===false && !required) {props.hidden=true;props.style={...props.style,display:'none'};}
  if(runtime.editing && nodeId && definition) {
    props.onPointerDownCapture=event=>{elementProps.onPointerDownCapture?.(event);runtime.onSelect?.({screenId,nodeId,element:event.currentTarget,event,repeat:repeated,layoutMode:repeated?'offset':'absolute',screenRect:parentRef?.current?plainRect(parentRef.current.getBoundingClientRect()):null,elementRect:plainRect(event.currentTarget.getBoundingClientRect()),layout:layout||null});};
  }
  let children=elementProps.children;
  if(node?.text != null && definition?.editableText!==false && !['input','textarea','canvas','img','video','audio'].includes(as)) children=labelChildren(children,node.text);
  if(node?.icon && definition?.editableIcon!==false)children=[...(node.icon==='none'?[]:[React.createElement('span',{key:'design-icon','aria-hidden':true,'data-design-icon':true},icons[node.icon])]),...withoutIcons(children)];
  if(ownScreen && screen?.decorations?.length) children=[children,...screen.decorations.map(dec=>React.createElement(Decoration,{key:dec.id,dec,runtime}))];
  children=keyedDesignChildren(children);
  const output=React.createElement(as,props,children);
  return ownScreen ? React.createElement(DesignScreenContext.Provider,{value:context},output) : output;
}
function Decoration({dec,runtime}) {
  if(dec.visible===false)return null;
  const layout=dec.layouts?.[runtime.profile] || {x:.05,y:.05,width:.3,height:'auto'};
  const anchorX={left:0,center:50,right:100}[layout.anchorX||'left'];
  const anchorY={top:0,center:50,bottom:100}[layout.anchorY||'top'];
  const style={position:'absolute',left:`${layout.x*100}%`,top:`${layout.y*100}%`,width:`${layout.width*100}%`,height:layout.height==='auto'||layout.height==null?'auto':`${layout.height*100}%`,transform:`translate(${-anchorX}%,${-anchorY}%)`,zIndex:layout.z||0,pointerEvents:'none',overflowWrap:'anywhere',...nodeStyle(dec.style)};
  if(dec.shape==='circle')style.borderRadius='50%';
  const props={'data-design-decoration':dec.id,style};
  if(dec.type==='image')return React.createElement('img',{...props,src:runtime.assetUrls[dec.assetId],alt:'',draggable:false});
  return React.createElement('div',{...props,'aria-hidden':dec.type==='shape'?true:undefined},dec.type==='text'?dec.text:null);
}
