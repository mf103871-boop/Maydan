import { fail } from '../room-model.mjs';

export const editorIds = env => String(env.DESIGN_EDITOR_USER_IDS || '').split(',').map(value => value.trim()).filter(value => /^[A-Za-z0-9_-]{1,80}$/.test(value));
export const isDesignEditor = (env, userId) => editorIds(env).includes(userId);
export const publishEnabled = env => env.DESIGN_PUBLISH_ENABLED === '1';
export function requireEditor(env, actor) {
  if (!actor?.userId || !actor.sessionId || !isDesignEditor(env, actor.userId)) fail('FORBIDDEN', 403);
}

// Recheck the live account and the exact verified session inside every write.
// A moderator or a group's owner/admin is deliberately not a Studio editor.
export function writeGuard(env, actor, now) {
  requireEditor(env, actor);
  return { sql: `? IN (SELECT value FROM json_each(?))
    AND EXISTS(SELECT 1 FROM users WHERE id=?)
    AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=?)
    AND NOT EXISTS(SELECT 1 FROM moderation_suspensions WHERE user_id=?)
    AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>?
      AND (revoked_at IS NULL OR revoked_at>?))`,
  args: [actor.userId, JSON.stringify(editorIds(env)), actor.userId, actor.userId, actor.userId, actor.sessionId, actor.userId, now, now] };
}
