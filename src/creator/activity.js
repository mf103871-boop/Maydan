const GAMES = new Set(['badeeha','beep','mamnoo','jabeen','fabraka','meenfina','ersomha','mafia']);
const SCREENS = new Set(['home','friends','store','profile','settings','creator']);
export function creatorActivity(route, documentRef = typeof document === 'undefined' ? null : document) {
  const element = documentRef?.querySelector('[data-creator-game]');
  const visibleGame = element?.getAttribute('data-creator-game');
  const game = GAMES.has(visibleGame) ? visibleGame : GAMES.has(route.params?.id) ? route.params.id : route.name==='mafia-tutorial'?'mafia':null;
  if (['game','game-entry','play','online','room','mafia-tutorial'].includes(route.name)) {
    if (!game) return null;
    const online = ['online','room'].includes(route.name) || ['ersomha','mafia'].includes(game);
    const phase=element?.getAttribute('data-creator-phase');
    const screen=['ended','finished','results'].includes(phase) ? 'game-results' : phase==='setup' || ['game','game-entry','mafia-tutorial'].includes(route.name) ? 'game-setup' : ['lobby','waiting','loading'].includes(phase) || !element ? 'game-lobby' : 'game-playing';
    return {game,mode:online?'online':'local',screen};
  }
  return {game:null,mode:'none',screen:route.name==='friend-group'?'friends':SCREENS.has(route.name)?route.name:'settings'};
}
