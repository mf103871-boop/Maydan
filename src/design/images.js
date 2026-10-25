// Only published bytes enter the offline cache. Private preview images remain
// short-lived object URLs owned by the current runtime/account generation.
export function referencedDesignImages(document) {
  const referenced=new Set(Object.values(document.screens||{}).flatMap(screen=>(screen.decorations||[]).filter(item=>item.visible!==false && item.type==='image').map(item=>item.assetId)));
  return document.assets.filter(id=>referenced.has(id));
}

export async function loadDesignImages(config,{origin,read,cache,current=()=>true,cacheOnly=false,createURL=URL.createObjectURL,revokeURL=URL.revokeObjectURL}) {
  const ids=referencedDesignImages(config.document),urls={},created=[];
  let cursor=0;
  async function worker() {
    while(cursor<ids.length && current()) {
      const id=ids[cursor++],path=`/api/design/assets/${encodeURIComponent(id)}`,key=`${origin}${path}`;
      let response;
      if(cacheOnly) response=await cache?.match(key);
      else {
        try {
          response=await read(path,true);
        } catch(error) {
          response=config.channel==='published'?await cache?.match(key):null;
          if(!response) throw error;
        }
        if(config.channel==='published' && current() && cache) {
          try{await cache.put(key,response.clone());}catch{/* A full cache never discards a successful network image. */}
        }
      }
      if(!response || !current()) continue;
      const blob=await response.blob();
      if(!current()) continue;
      const url=createURL(blob);created.push(url);urls[id]=url;
    }
  }
  const results=await Promise.allSettled(Array.from({length:Math.min(4,ids.length)},worker));
  const failed=results.find(item=>item.status==='rejected');
  if(failed || !current()) {
    created.forEach(revokeURL);
    if(failed)throw failed.reason;
    return null;
  }
  return {assetUrls:urls,objectURLs:created};
}
