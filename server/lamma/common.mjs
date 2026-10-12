import { fail } from '../room-model.mjs';
import { userId, textOf } from '../social/model.mjs';
import { liveAccountSql } from '../moderation/access.mjs';
import { objectionableText } from '../moderation/filter.mjs';
export const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
export const first = (env, sql, ...args) => stmt(env, sql, ...args).first();
export const all = async (env, sql, ...args) => (await stmt(env, sql, ...args).all()).results || [];
export const run = (env, sql, ...args) => stmt(env, sql, ...args).run();
export const changed = result => Number(result?.meta?.changes || 0) > 0;
// Only validated identifiers may be embedded; all content remains bound parameters.
export const ident = value => `'${userId(value)}'`;
export const live = liveAccountSql;
export const unblocked = (a,b) => `NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.blocker_id=${a} AND b.blocked_id=${b}) OR (b.blocker_id=${b} AND b.blocked_id=${a}))`;
export const friends = (a,b) => `EXISTS(SELECT 1 FROM social_friendships f WHERE f.status='accepted' AND ((f.user_low=${a} AND f.user_high=${b}) OR (f.user_high=${a} AND f.user_low=${b}))) AND ${unblocked(a,b)} AND ${live(a)} AND ${live(b)}`;
export const member = (g,u) => `EXISTS(SELECT 1 FROM social_group_members gm JOIN social_groups gg ON gg.id=gm.group_id WHERE gm.group_id=${g} AND gm.user_id=${u} AND gm.left_at IS NULL AND gg.closed_at IS NULL AND ${live('gm.user_id')})`;
export const admin = (g,u,owner=false) => `EXISTS(SELECT 1 FROM social_group_members gm WHERE gm.group_id=${g} AND gm.user_id=${u} AND gm.left_at IS NULL AND gm.role ${owner?"='owner'":"IN ('owner','admin')"}) AND ${member(g,u)}`;
export const scopeOf = value => { if(!['direct','group'].includes(value)) fail('INVALID',400); return value; };
export const cleanText = (value,max) => { const text=textOf(value,max); if(objectionableText(text)) fail('CONTENT_REJECTED',422); return text; };
export const scopeAllowed = (scope,c,u) => scope==='group'?member(c,u):`EXISTS(SELECT 1 FROM social_conversations c WHERE c.id=${c} AND (c.user_low=${u} OR c.user_high=${u}) AND ${friends('c.user_low','c.user_high')})`;
export async function requireScope(env,id,scope,conversationId) {
  scopeOf(scope); ident(id); ident(conversationId);
  if(!await first(env,`SELECT 1 WHERE ${scopeAllowed(scope,ident(conversationId),ident(id))}`)) fail('NOT_FOUND',404);
}
export async function recipients(env,scope,conversationId,actorId) {
  const a=ident(actorId), c=ident(conversationId);
  if(scope==='group') return (await all(env,`SELECT m.user_id FROM social_group_members m WHERE m.group_id=${c} AND m.left_at IS NULL AND ${member(c,'m.user_id')} AND ${unblocked(a,'m.user_id')}`)).map(r=>r.user_id);
  const row=await first(env,`SELECT user_low,user_high FROM social_conversations c WHERE c.id=${c} AND ${scopeAllowed(scope,c,a)}`);
  return row?[row.user_low,row.user_high]:[];
}
