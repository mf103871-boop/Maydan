// إنشاء الفرق ونسخها: الوسائل الثلاث لكل فريق، والنسخ عميق للوسائل كي لا يشارك التراجع حالتها.
import { TEAM_STYLE } from "./constants.js";

export function betaFreshTools() {
  return { double: !0, two: !0, time: !0 };
}
export function betaTeam(index, name) {
  return {
    id: `team-${index + 1}`,
    name: name || TEAM_STYLE[index].name,
    score: 0,
    correct: 0,
    steals: 0,
    tools: betaFreshTools(),
  };
}
export function betaCloneTeams(teams) {
  return teams.map((team) => ({ ...team, tools: { ...team.tools } }));
}
