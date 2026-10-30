// Best-effort counters, never a result ledger. Fixed cells only: no identities,
// arbitrary dimensions, payloads, error objects, URLs or precise sample times.
export const MAFIA_METRIC_BUCKETS=/* @__PURE__ */ Object.freeze([50,100,250,500,1000,5000,15000,60000,120000]);
export const MAFIA_METRIC_PHASES=/* @__PURE__ */ Object.freeze(['role','opening','night','dawn','discussion','nomination','defense','verdict']);
export const MAFIA_METRIC_LIMITS=/* @__PURE__ */ Object.freeze({intervalMs:60000,counter:4095,pendingResults:16,maxSampleMs:120000,maxBytes:1024});
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const time=value=>Number.isSafeInteger(value)&&value>0;
const histogram=()=>Array(MAFIA_METRIC_BUCKETS.length).fill(0);
const empty=side=>({schemaVersion:1,type:'mafia_metrics',side,connectionReady:{initial:histogram(),recovery:histogram()},commands:{ok:0,rejected:0,timeout:0,transport:0},
  commandMs:histogram(),queueMs:histogram(),phaseCommitted:Array(8).fill(0),phaseLagMs:histogram(),resultDrained:0,capped:false});

function collector({enabled=false,side='client',clock=()=>Date.now(),sink=()=>{}}={},extend) {
  const active=enabled===true&&(side==='client'||side==='server');
  const readClock=()=>{try{const value=clock();return finite(value)?value:null;}catch{return null;}};
  let cells=empty(side),dirty=false,windowAt=active?readClock():null;
  const increment=(object,key)=>{if(object[key]<4095)object[key]++;else cells.capped=true;dirty=true;};
  // Public methods validate samples first; values beyond the last bound stay
  // in that final cell, exactly as clipping to maxSampleMs would do.
  const observe=(array,value)=>{increment(array,MAFIA_METRIC_BUCKETS.findIndex(bound=>value<=bound||bound===120000));return true;};
  const extension=extend&&extend(active,side,()=>cells,increment,observe);
  const api={
    connectionReady(kind,elapsedMs){
      if(!active||(kind!=='initial'&&kind!=='recovery')||!finite(elapsedMs))return false;
      return observe(cells.connectionReady[kind],elapsedMs);
    },
    commandSettled(outcome,elapsedMs){
      if(!active||!['ok','rejected','timeout','transport'].includes(outcome)||!finite(elapsedMs))return false;
      increment(cells.commands,outcome);observe(cells.commandMs,elapsedMs);return true;
    },
    ...extension&&extension[0],
    flush(){
      if(!active)return null;const now=readClock();if(now===null)return null;
      if(extension)extension[1](now);
      if(windowAt===null){windowAt=now;return null;}
      if(!dirty||now-windowAt<60000)return null;
      const record=cells;
      // Reset before the sink. A failing or re-entrant sink cannot change game
      // behavior or replay these counters. No sink/network retry is attempted.
      cells=empty(side);dirty=false;windowAt=now;
      try{Promise.resolve(sink(record)).catch(()=>{});}catch{/* metrics cannot fail gameplay */}
      return record;
    },
  };
  return Object.freeze(api);
}

// This path has the same payload and counters, without installing server-only
// observers or their pending deadline queue. Unused full-factory code can drop
// from the shipped browser bundle; the compatibility export remains below.
export function createMafiaClientMetrics(options) {return collector(options);}

export function createMafiaMetrics(options) {
  return collector(options,(active,side,cells,increment,observe)=>{
    let pendingResults=[];
    return [{
        queueWait(elapsedMs){if(!active||side!=='server'||!finite(elapsedMs))return false;return observe(cells().queueMs,elapsedMs);},
        phaseCommitted(phase,lagMs){
          if(!active||side!=='server'||!MAFIA_METRIC_PHASES.includes(phase)||(lagMs!==undefined&&!finite(lagMs)))return false;
          increment(cells().phaseCommitted,MAFIA_METRIC_PHASES.indexOf(phase));if(lagMs!==undefined)observe(cells().phaseLagMs,lagMs);return true;
        },
        resultDrained(finishedAt,notBefore){
          if(!active||side!=='server'||!time(finishedAt)||(notBefore!==undefined&&!time(notBefore))||pendingResults.length>=16)return false;
          // Even a legacy result or a regressed clock cannot publish an end early.
          pendingResults.push(Math.max(finishedAt+30000,notBefore||0));return true;
        },
      },now=>{
        const due=pendingResults.filter(deadline=>deadline<=now);
        pendingResults=pendingResults.filter(deadline=>deadline>now);
        for(let index=0;index<due.length;index++)increment(cells(),'resultDrained');
      }];
  });
}
