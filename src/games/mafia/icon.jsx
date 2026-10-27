import React from 'react';
import { MAFIA_NOIR_ASSETS, mafiaRoleArtStyle, mafiaSceneArtStyle } from './noir-assets.js';

// Original Maydan artwork. Only the owner's role, or a server-revealed recap,
// chooses a portrait; the visual atlas contains no match assignments.
export function MafiaIcon({ className = '' }) {
  return <img className={`clay-art mafia-noir-icon ${className}`} src={MAFIA_NOIR_ASSETS.icon} width="180" height="180" alt="" aria-hidden="true" draggable="false" decoding="async"/>;
}
export function MafiaRoleArt({ roleId, className = '' }) {
  return <span className={`mafia-role-art ${className}`} style={mafiaRoleArtStyle(roleId)} aria-hidden="true"/>;
}
export function MafiaSceneArt({ sceneId, className = '' }) {
  return <span className={`mafia-scene-art ${className}`} aria-hidden="true"><span style={mafiaSceneArtStyle(sceneId)}/></span>;
}
