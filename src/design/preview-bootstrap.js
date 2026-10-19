// Runs BEFORE importing any game, store or provider module. A same-origin
// preview has its own memory-only storage and cannot contact an account API.
function memoryStorage(){const map=new Map();return {get length(){return map.size;},key:index=>[...map.keys()][index]??null,getItem:key=>map.get(String(key))??null,setItem:(key,value)=>map.set(String(key),String(value)),removeItem:key=>map.delete(String(key)),clear:()=>map.clear()};}
for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{value:memoryStorage(),configurable:false});
const originalFetch=window.fetch.bind(window);
window.fetch=(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.origin!==location.origin || !/^\/(media|audio|icons|vendor)\//.test(url.pathname))return Promise.reject(new Error('PREVIEW_NETWORK_DISABLED'));
  return originalFetch(input,{...options,credentials:'omit',headers:{}});
};
window.WebSocket=class{constructor(){throw new Error('PREVIEW_SOCKET_DISABLED');}};
if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>Promise.reject(new Error('PREVIEW_RECORDING_DISABLED')),configurable:false});
document.addEventListener('click',event=>{const anchor=event.target.closest?.('a[href]');if(anchor && !anchor.getAttribute('href')?.startsWith('#'))event.preventDefault();},true);
window.__MAYDAN_STUDIO_PREVIEW__=true;
import('./preview-main.jsx').catch(error=>{document.getElementById('root').textContent=`تعذر تحضير المعاينة: ${error.message}`;});
