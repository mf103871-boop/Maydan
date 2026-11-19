import React from 'react';
import favorite from './assets/conversation-options/favorite-v1.webp';
import settings from './assets/conversation-options/settings-v1.webp';
import invite from './assets/conversation-options/invite-v1.webp';
import profile from './assets/conversation-options/profile-v1.webp';
import mute from './assets/conversation-options/mute-v1.webp';
import unmute from './assets/conversation-options/unmute-v1.webp';
import remove from './assets/conversation-options/remove-v1.webp';
import block from './assets/conversation-options/block-v1.webp';
import report from './assets/conversation-options/report-v1.webp';
import group from './assets/conversation-options/group-v1.webp';

const artwork = { favorite, settings, invite, profile, mute, unmute, remove, block, report, group };

export function ConversationOption({ icon, danger = false, children, ...props }) {
  return <button type="button" className={'lamma-conversation-option' + (danger ? ' is-danger' : '')} {...props}>
    <img src={artwork[icon]} alt="" width="40" height="40" />
    <span>{children}</span>
  </button>;
}
