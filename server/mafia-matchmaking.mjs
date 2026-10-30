// Pure server-owned matching policy. Candidate ratings and the block graph
// never leave the server; only aggregate policy metadata is public.
export const MAFIA_MATCHMAKING_POLICY = Object.freeze({
  version:'skill-window-1',groupSize:8,candidateLimit:64,
  initialRatingRange:150,widenEveryMs:30000,widenBy:300,maximumRatingRange:3000,
  maximumExpansionAfterMs:300000,searchNodesPerAnchor:512,maximumSearchNodes:16384,
});
const compare=(a,b)=>a<b?-1:a>b?1:0;
export function rankedRatingWindow(joinedAt,now) {
  const elapsed=Math.max(0,now-joinedAt);
  return Math.min(MAFIA_MATCHMAKING_POLICY.maximumRatingRange,
    MAFIA_MATCHMAKING_POLICY.initialRatingRange+Math.floor(elapsed/MAFIA_MATCHMAKING_POLICY.widenEveryMs)*MAFIA_MATCHMAKING_POLICY.widenBy);
}
export function rankedMatchingStatus(joinedAt,now) {
  return {version:MAFIA_MATCHMAKING_POLICY.version,skillBased:true,
    initialRatingRange:MAFIA_MATCHMAKING_POLICY.initialRatingRange,
    currentRatingRange:rankedRatingWindow(Number.isSafeInteger(joinedAt)?joinedAt:now,now),
    widenEverySeconds:MAFIA_MATCHMAKING_POLICY.widenEveryMs/1000,
    maximumExpansionAfterSeconds:MAFIA_MATCHMAKING_POLICY.maximumExpansionAfterMs/1000};
}
export function selectRankedGroup(input,blocks,now) {
  const policy=MAFIA_MATCHMAKING_POLICY,seen=new Set();
  const candidates=(Array.isArray(input)?input:[]).filter(row=>{
    if(!row||typeof row.user_id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(row.user_id)||seen.has(row.user_id)
      ||!Number.isSafeInteger(row.joined_at)||row.joined_at>now||!Number.isSafeInteger(row.rating)||row.rating<0||row.rating>3000)return false;
    seen.add(row.user_id);return true;
  }).sort((a,b)=>a.joined_at-b.joined_at||compare(a.user_id,b.user_id)).slice(0,policy.candidateLimit);
  const graph=new Map(candidates.map(row=>[row.user_id,new Set()]));
  for(const row of Array.isArray(blocks)?blocks:[]){
    if(graph.has(row.blocker_id)&&graph.has(row.blocked_id)){
      graph.get(row.blocker_id).add(row.blocked_id);graph.get(row.blocked_id).add(row.blocker_id);
    }
  }
  let remaining=policy.maximumSearchNodes;
  // The oldest anchor that can form a compatible group has priority. Newer
  // players cannot skip a viable older group merely because their spread is
  // tighter. An incompatible anchor does not block the entire queue.
  for(let anchorIndex=0;anchorIndex<candidates.length;anchorIndex++){
    const anchor=candidates[anchorIndex],range=rankedRatingWindow(anchor.joined_at,now);
    const pool=candidates.slice(anchorIndex+1).filter(row=>!graph.get(anchor.user_id).has(row.user_id)&&Math.abs(row.rating-anchor.rating)<=range)
      .sort((a,b)=>Math.abs(a.rating-anchor.rating)-Math.abs(b.rating-anchor.rating)||a.joined_at-b.joined_at||compare(a.user_id,b.user_id));
    if(pool.length<policy.groupSize-1)continue;
    let allowance=Math.min(policy.searchNodesPerAnchor,remaining);
    const chosen=[anchor];
    const search=(start,low,high)=>{
      if(chosen.length===policy.groupSize)return chosen.slice();
      for(let i=start;i<=pool.length-(policy.groupSize-chosen.length);i++){
        if(allowance<=0||remaining<=0)return null;
        allowance--;remaining--;
        const row=pool[i],nextLow=Math.min(low,row.rating),nextHigh=Math.max(high,row.rating);
        if(nextHigh-nextLow>range||chosen.some(peer=>graph.get(peer.user_id).has(row.user_id)))continue;
        chosen.push(row);const found=search(i+1,nextLow,nextHigh);if(found)return found;chosen.pop();
      }
      return null;
    };
    const members=search(0,anchor.rating,anchor.rating);
    if(members)return {members,policyVersion:policy.version,anchorJoinedAt:anchor.joined_at,
      ratingRange:range,ratingSpread:Math.max(...members.map(row=>row.rating))-Math.min(...members.map(row=>row.rating))};
    if(remaining<=0)break;
  }
  return null;
}
