import { liveAccountSql } from '../moderation/access.mjs';
import { fail } from '../room-model.mjs';
import { actorPredicate, actorArgs, assertCurrentActor } from './access.mjs';
import { TIMEZONE, HEARTBEAT_MS, ONLINE_MS, SAMPLE_MS, MAX_PRESENCE_ROWS, MAX_DAILY_USER_ROWS,
  MODES, SCREENS, presenceOf, localPeriod, addDays, dayStart, creatorEnvironment } from './model.mjs';

const stmt = (env,sql,...args) => env.DB.prepare(sql).bind(...args);
const all = async (env,sql,...args) => (await stmt(env,sql,...args).all()).results || [];
const PULSE = 'EXISTS(SELECT 1 FROM creator_presence WHERE user_id=? AND pulse_id=?)';
const CLEANUP = '(SELECT cleanup_id FROM creator_state WHERE id=1)=?';
const SAMPLE = '(SELECT sample_id FROM creator_state WHERE id=1)=?';

// Maintenance is also exposed for an existing scheduled cleanup hook. Bounded
// opportunistic cleanup keeps expired rows out of request results immediately;
// physical deletion proceeds in 2,000-row chunks, at most once per minute.
export function creatorMaintenanceStatements(env,now=Date.now(),nonce=crypto.randomUUID()) {
  const {day} = localPeriod(now);
  return [
    stmt(env,'INSERT OR IGNORE INTO creator_state(id) VALUES(1)'),
    stmt(env,'UPDATE creator_state SET last_cleanup_at=?,cleanup_id=? WHERE id=1 AND last_cleanup_at<=?',now,nonce,now-SAMPLE_MS),
    stmt(env,`DELETE FROM creator_presence WHERE ${CLEANUP} AND rowid IN (SELECT rowid FROM creator_presence WHERE last_seen_at<? ORDER BY last_seen_at LIMIT 2000)`,nonce,now-86400_000),
    stmt(env,`DELETE FROM creator_daily_users WHERE ${CLEANUP} AND rowid IN (SELECT rowid FROM creator_daily_users WHERE day<? ORDER BY day LIMIT 2000)`,nonce,addDays(day,-7)),
    stmt(env,`DELETE FROM creator_hourly WHERE ${CLEANUP} AND day<?`,nonce,addDays(day,-6)),
    stmt(env,`DELETE FROM creator_daily WHERE ${CLEANUP} AND day<?`,nonce,addDays(day,-364)),
  ];
}
export async function pruneCreatorAnalytics(env,now=Date.now()) {
  if (!env.DB) return;
  await env.DB.batch(creatorMaintenanceStatements(env,now));
}
export function deleteCreatorAccountStatements(env,userId) {
  return ['creator_access','creator_presence','creator_daily_users'].map(table=>stmt(env,`DELETE FROM ${table} WHERE user_id=?`,userId));
}

export async function recordPresence(env,actor,input,now=Date.now(),attempt=0) {
  const value = presenceOf(input), {day,hour} = localPeriod(now), bit = 2 ** hour;
  const snapshot = await assertCurrentActor(env,actor,now);
  const previous = await stmt(env,'SELECT last_seen_at FROM creator_presence WHERE user_id=?',actor.userId).first();
  if (previous && now-previous.last_seen_at < HEARTBEAT_MS) {
    return {accepted:false,reason:'throttled',heartbeatSeconds:30,retryAfterMs:Math.max(1,previous.last_seen_at+HEARTBEAT_MS-now)};
  }
  const nonce = crypto.randomUUID(), pulseArgs = [actor.userId,nonce];
  const statements = creatorMaintenanceStatements(env,now,nonce);
  const presenceIndex = statements.length;
  // No client user ID, timestamp, room, role or chat enters this statement.
  // Membership is a limited server check; it is not evidence of a live socket
  // or of actually playing. Private rooms without a projection remain hints.
  statements.push(stmt(env,`INSERT INTO creator_presence(user_id,last_seen_at,pulse_id,game,mode,screen,membership_verified)
    SELECT ?,?,?,?,?,?,CASE WHEN ?='online' AND
      ((?='mafia' AND EXISTS(SELECT 1 FROM mafia_seats WHERE user_id=? AND expires_at>?)) OR
       (?!='mafia' AND EXISTS(SELECT 1 FROM online_public_rooms r,json_each(r.member_user_ids) member WHERE r.game=? AND r.expires_at>? AND member.value=?))) THEN 1 ELSE 0 END
    WHERE ${actorPredicate}
      AND EXISTS(SELECT 1 FROM sessions guarded WHERE guarded.id=? AND guarded.expires_at=? AND guarded.revoked_at IS ? AND guarded.secret_hash=?)
      AND CASE WHEN EXISTS(SELECT 1 FROM creator_presence WHERE user_id=?) THEN 1 ELSE (SELECT COUNT(*) FROM creator_presence)<? END
      AND CASE WHEN EXISTS(SELECT 1 FROM creator_daily_users WHERE day=? AND user_id=?) THEN 1 ELSE (SELECT COUNT(*) FROM creator_daily_users)<? END
    ON CONFLICT(user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,pulse_id=excluded.pulse_id,
      game=excluded.game,mode=excluded.mode,screen=excluded.screen,membership_verified=excluded.membership_verified
    WHERE creator_presence.last_seen_at<=?`,
  actor.userId,now,nonce,value.game,value.mode,value.screen,
  value.mode,value.game,actor.userId,now,value.game,value.game,now,actor.userId,
  ...actorArgs(actor,now),actor.sessionId,snapshot.expiresAt,snapshot.revokedAt,snapshot.secretHash,
  actor.userId,MAX_PRESENCE_ROWS,day,actor.userId,MAX_DAILY_USER_ROWS,now-HEARTBEAT_MS));
  statements.push(
    stmt(env,`UPDATE creator_state SET started_at=? WHERE id=1 AND started_at IS NULL AND ${PULSE}`,now,...pulseArgs),
    stmt(env,`INSERT INTO creator_daily(day,unique_players) SELECT ?,1 WHERE ${PULSE}
      AND NOT EXISTS(SELECT 1 FROM creator_daily_users WHERE day=? AND user_id=?)
      ON CONFLICT(day) DO UPDATE SET unique_players=unique_players+1`,day,...pulseArgs,day,actor.userId),
    stmt(env,`INSERT INTO creator_hourly(day,hour,unique_players) SELECT ?,?,1 WHERE ${PULSE}
      AND NOT EXISTS(SELECT 1 FROM creator_daily_users WHERE day=? AND user_id=? AND (hour_bits & ?) != 0)
      ON CONFLICT(day,hour) DO UPDATE SET unique_players=unique_players+1`,day,hour,...pulseArgs,day,actor.userId,bit),
    stmt(env,`INSERT INTO creator_daily_users(day,user_id,hour_bits) SELECT ?,?,? WHERE ${PULSE}
      ON CONFLICT(day,user_id) DO UPDATE SET hour_bits=hour_bits | excluded.hour_bits WHERE (hour_bits & excluded.hour_bits)=0`,day,actor.userId,bit,...pulseArgs),
    stmt(env,`UPDATE creator_state SET last_sample_at=?,last_sample_bucket=?,sample_id=?,
      sampled_online=(SELECT COUNT(*) FROM creator_presence p WHERE p.last_seen_at>? AND p.last_seen_at<=? AND ${liveAccountSql('p.user_id')})
      WHERE id=1 AND ${PULSE} AND (last_sample_at<=? OR last_sample_bucket IS NULL OR last_sample_bucket!=?)`,
    now,`${day}:${hour}`,nonce,now-ONLINE_MS,now,...pulseArgs,now-SAMPLE_MS,`${day}:${hour}`),
    stmt(env,`UPDATE creator_state SET peak_online=MAX(peak_online,sampled_online) WHERE id=1 AND sample_id=?`,nonce),
    stmt(env,`UPDATE creator_daily SET peak_online=MAX(peak_online,(SELECT sampled_online FROM creator_state WHERE id=1)) WHERE day=? AND ${SAMPLE}`,day,nonce),
    stmt(env,`UPDATE creator_hourly SET peak_online=MAX(peak_online,(SELECT sampled_online FROM creator_state WHERE id=1)) WHERE day=? AND hour=? AND ${SAMPLE}`,day,hour,nonce),
  );
  const results = await env.DB.batch(statements);
  if (!Number(results[presenceIndex]?.meta?.changes)) {
    const current = await assertCurrentActor(env,actor,Math.max(now,Date.now()));
    if(current.expiresAt!==snapshot.expiresAt || current.revokedAt!==snapshot.revokedAt || current.secretHash!==snapshot.secretHash) {
      // A concurrent rotation may put the old token into valid future grace.
      // Refresh once only; a revoked/expired token already failed above, and
      // no metric/heartbeat was written by the snapshot-mismatched batch.
      if(attempt>0)fail('AUTH_EXPIRED',401);
      return recordPresence(env,actor,input,Math.max(now,Date.now()),attempt+1);
    }
    const latest = await stmt(env,'SELECT last_seen_at FROM creator_presence WHERE user_id=?',actor.userId).first();
    if (latest && now-latest.last_seen_at < HEARTBEAT_MS) return {accepted:false,reason:'throttled',heartbeatSeconds:30,retryAfterMs:Math.max(1,latest.last_seen_at+HEARTBEAT_MS-now)};
    await stmt(env,'UPDATE creator_state SET capacity_limited_at=COALESCE(capacity_limited_at,?) WHERE id=1',now).run();
    return {accepted:false,reason:'capacity',heartbeatSeconds:30,retryAfterMs:60_000};
  }
  return {accepted:true,heartbeatSeconds:30,retryAfterMs:HEARTBEAT_MS};
}

export async function creatorAnalytics(env,actor,now=Date.now()) {
  await assertCurrentActor(env,actor,now,true);
  const {day,hour} = localPeriod(now), firstDay = addDays(day,-6);
  const [state,active,dailyRows,hourlyRows,registered] = await Promise.all([
    stmt(env,'SELECT started_at,last_sample_at,peak_online,capacity_limited_at FROM creator_state WHERE id=1').first(),
    all(env,`SELECT p.game,p.mode,p.screen,COUNT(*) AS count,SUM(p.membership_verified) AS membership_verified
      FROM creator_presence p WHERE p.last_seen_at>? AND p.last_seen_at<=? AND ${liveAccountSql('p.user_id')} GROUP BY p.game,p.mode,p.screen`,now-ONLINE_MS,now),
    all(env,'SELECT day,unique_players,peak_online FROM creator_daily WHERE day>=? AND day<=? ORDER BY day',firstDay,day),
    all(env,'SELECT day,hour,unique_players,peak_online FROM creator_hourly WHERE day>=? AND day<=? ORDER BY day,hour',firstDay,day),
    stmt(env,`SELECT (SELECT COUNT(*) FROM users) AS total,(SELECT COUNT(*) FROM users WHERE created_at>=? AND created_at<?) AS today`,dayStart(day),dayStart(addDays(day,1))).first(),
  ]);
  const byGame = new Map(), byMode = new Map(MODES.map(mode=>[mode,0])), byScreen = new Map(SCREENS.map(screen=>[screen,0]));
  let onlinePlayers = 0;
  for (const row of active) {
    const count = Number(row.count);
    onlinePlayers += count; byMode.set(row.mode,(byMode.get(row.mode)||0)+count); byScreen.set(row.screen,(byScreen.get(row.screen)||0)+count);
    if (row.game) {
      const key = `${row.game}:${row.mode}`, entry = byGame.get(key)||{game:row.game,mode:row.mode,count:0,membershipVerified:0};
      entry.count += count; entry.membershipVerified += Number(row.membership_verified); byGame.set(key,entry);
    }
  }
  const first = state?.started_at ? localPeriod(state.started_at) : null;
  const days = new Map(dailyRows.map(row=>[row.day,row])), hours = new Map(hourlyRows.map(row=>[`${row.day}:${row.hour}`,row]));
  const daily = [], hourly = [];
  for (let n=0;n<7;n++) {
    const date = addDays(firstDay,n), found = days.get(date);
    daily.push({day:date,uniquePlayers:Number(found?.unique_players||0),peakOnline:Number(found?.peak_online||0),tracked:!!first&&date>=first.day});
    for (let h=0;h<24 && (date<day || h<=hour);h++) {
      const item = hours.get(`${date}:${h}`);
      hourly.push({day:date,hour:h,uniquePlayers:Number(item?.unique_players||0),peakOnline:Number(item?.peak_online||0),tracked:!!first&&(date>first.day||date===first.day&&h>=first.hour)});
    }
  }
  const today = days.get(day);
  // Fresh authorization after the parallel reads: revoking the creator role or
  // session while a report is being assembled must not return the report.
  await assertCurrentActor(env,actor,Math.max(now,Date.now()),true);
  return {
    schemaVersion:1,environment:creatorEnvironment(env),timezone:TIMEZONE,
    metricsStartedAt:state?.started_at?new Date(state.started_at).toISOString():null,updatedAt:new Date(now).toISOString(),
    collection:{status:state?.capacity_limited_at?'limited':state?.started_at?'collecting':'not-started',heartbeatSeconds:30,onlineWindowSeconds:90,peakSampleSeconds:60,
      guestCoverage:'not-collected',activitySource:'client-reported-with-membership-check',lastPeakSampleAt:state?.last_sample_at?new Date(state.last_sample_at).toISOString():null,
      retention:{presenceHours:24,deduplicationDays:8,hourlyDays:7,dailyDays:365,cleanup:'bounded-opportunistic-or-scheduled'},
      limits:{presenceRows:MAX_PRESENCE_ROWS,dailyUserRows:MAX_DAILY_USER_ROWS}},
    summary:{onlinePlayers,todayPlayers:Number(today?.unique_players||0),todayPeakOnline:Number(today?.peak_online||0),activeGames:new Set([...byGame.values()].map(row=>row.game)).size,
      registeredAccountsTotal:Number(registered.total),registeredAccountsToday:Number(registered.today),observedPeakOnline:Number(state?.peak_online||0),lifetimeUniquePlayers:null},
    byGame:[...byGame.values()].sort((a,b)=>b.count-a.count||a.game.localeCompare(b.game)||a.mode.localeCompare(b.mode)),
    byMode:[...byMode].map(([mode,count])=>({mode,count})),byScreen:[...byScreen].map(([screen,count])=>({screen,count})),hourly,daily,
  };
}
