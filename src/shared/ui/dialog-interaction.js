// Shared by dialogs and the in-game friends drawer. A single top layer owns
// focus, Escape and the scroll lock, including when lower layers unmount first.
const layers=[];
const originals=new Map();
let originalOverflow='',originalOverflowPriority='',frame=null,observing=null;
const selectors='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[contenteditable="true"],[tabindex]:not([tabindex="-1"])';
const visible=element=>element.getClientRects().length && !element.closest('[hidden],[inert]') && getComputedStyle(element).visibility!=='hidden' && element.tabIndex>=0;
const focusables=node=>[...node.querySelectorAll(selectors)].filter(visible);
const top=()=>layers.reduce((best,item)=>!best || item.priority>=best.priority?item:best,null);
const focus=element=>{try{element?.focus({preventScroll:true});}catch{/* detached/native focus */}};
function focusFirst(layer){
  const node=layer.node;
  if(node.contains(document.activeElement))return;
  const marked=[...node.querySelectorAll('[autofocus],[data-autofocus]')].find(visible);
  focus(marked||focusables(node.querySelector('.modal-body')||node)[0]||focusables(node)[0]||node);
}
function sync(){
  const active=top();
  for(const child of document.body.children){
    if(!originals.has(child))originals.set(child,child.inert);
    child.inert=active?!(child===active.host||child.contains(active.host)):originals.get(child);
  }
  if(active)document.body.style.setProperty('overflow','hidden');
}
function revealFocus(){
  frame=null;
  const layer=top(),active=document.activeElement;
  if(!layer || !layer.node.contains(active))return;
  // Scroll only within the overlay. scrollIntoView() can move the game page on
  // iOS, even when its background is inert and the visual viewport has panned.
  for(let parent=active.parentElement;parent && layer.node.contains(parent);parent=parent.parentElement){
    const style=getComputedStyle(parent);
    if(['auto','scroll'].includes(style.overflowY) && parent.scrollHeight>parent.clientHeight){
      const bounds=parent.getBoundingClientRect(),rect=active.getBoundingClientRect();
      const bottom=Math.min(bounds.bottom,window.visualViewport?.scale===1?visualViewport.offsetTop+visualViewport.height:innerHeight);
      const upper=Math.max(bounds.top,window.visualViewport?.scale===1?visualViewport.offsetTop:0);
      if(rect.bottom>bottom-8)parent.scrollTop+=rect.bottom-bottom+8;
      else if(rect.top<upper+8)parent.scrollTop-=upper-rect.top+8;
    }
    if(parent===layer.node)break;
  }
}
const schedule=()=>{if(layers.length && frame===null)frame=requestAnimationFrame(revealFocus);};
function onFocus(){const layer=top();if(layer){if(!layer.node.contains(document.activeElement))focusFirst(layer);if(layer.node.contains(document.activeElement) && document.activeElement!==layer.node)layer.lastFocused=document.activeElement;}schedule();}
function onKey(event){
  const layer=top();if(!layer || event.defaultPrevented)return;
  if(event.key==='Escape'){
    if(event.isComposing || event.keyCode===229)return;
    event.preventDefault();event.stopPropagation();layer.close();return;
  }
  if(event.key!=='Tab')return;
  const list=focusables(layer.node),active=document.activeElement;
  if(!list.length){event.preventDefault();focus(layer.node);return;}
  if(!layer.node.contains(active) || active===layer.node){event.preventDefault();focus(event.shiftKey?list.at(-1):list[0]);}
  else if(event.shiftKey && active===list[0]){event.preventDefault();focus(list.at(-1));}
  else if(!event.shiftKey && active===list.at(-1)){event.preventDefault();focus(list[0]);}
}
export function activateDialog({node,host,close,priority=20}){
  if(!node || !host)return()=>{};
  const previousLayer=top(),activeElement=document.activeElement;
  const previous=previousLayer && (!previousLayer.node.contains(activeElement)||activeElement===previousLayer.node)?previousLayer.lastFocused||activeElement:activeElement;
  const layer={node,host,close,priority,previous};
  if(!layers.length){
    originalOverflow=document.body.style.getPropertyValue('overflow');originalOverflowPriority=document.body.style.getPropertyPriority('overflow');
    document.addEventListener('keydown',onKey,true);document.addEventListener('focusin',onFocus,true);
    window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
    observing=new MutationObserver(sync);observing.observe(document.body,{childList:true});
  }
  layers.push(layer);sync();if(top()===layer)focusFirst(layer);schedule();
  // visualViewport style writes can share a frame with focus handling. Observe
  // the resulting box as well, so a queued old-size frame cannot miss it.
  const resize=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null;
  resize?.observe(node);
  let active=true;
  return()=>{
    if(!active)return;active=false;resize?.disconnect();
    const wasTop=top()===layer;layers.splice(layers.indexOf(layer),1);
    if(layers.length)sync();
    else{
      observing?.disconnect();observing=null;
      for(const[element,inert]of originals)if(element.isConnected)element.inert=inert;
      originals.clear();
      if(originalOverflow)document.body.style.setProperty('overflow',originalOverflow,originalOverflowPriority);else document.body.style.removeProperty('overflow');
      document.removeEventListener('keydown',onKey,true);document.removeEventListener('focusin',onFocus,true);
      window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);
      if(frame!==null){cancelAnimationFrame(frame);frame=null;}
    }
    if(wasTop){const next=top();if(layer.previous?.isConnected && !layer.previous.closest('[inert]') && (!next || next.node.contains(layer.previous)))focus(layer.previous);else if(next)focusFirst(next);schedule();}
  };
}
