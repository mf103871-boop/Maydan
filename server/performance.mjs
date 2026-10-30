// Request-scoped, opt-in diagnostics. Never accept client labels, identifiers,
// URL/query/header/body values or error messages into this record.
const STAGES = new Set(['auth', 'quota', 'dispatch', 'profile', 'enrich', 'fanout', 'r2_put', 'r2_get', 'provider_create', 'provider_remove', 'provider_delete', 'provider_other']);
const clock = () => performance.now();
const milliseconds = value => Math.round(Math.max(0, value) * 10) / 10;
export function performanceRoute(request) {
  if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return null;
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/social/')) return null;
  if (/^\/api\/social\/attachments(?:\/[A-Za-z0-9_-]+(?:\/content)?)?$/.test(path)) return 'social_audio';
  if (/^\/api\/social\/calls(?:\/[A-Za-z0-9_-]+(?:\/(?:accept|join|reject|leave|end))?)?$/.test(path)) return 'social_calls';
  if (/^\/api\/social\/groups(?:\/[A-Za-z0-9_-]+(?:\/messages(?:\/\d+)?)?)?$/.test(path)) return 'social_groups';
  if (/^\/api\/social\/(?:conversations(?:\/[A-Za-z0-9_-]+\/messages)?|messages\/\d+)$/.test(path)) return 'social_messages';
  return null;
}
export async function timed(env, stage, operation) {
  const metrics = env.REQUEST_METRICS;
  if (!metrics || !STAGES.has(stage)) return operation();
  const started = clock();
  try { return await operation(); }
  finally { metrics.add(stage, clock() - started); }
}
export async function withRequestMetrics(request, env, operation) {
  if (String(env.CONNECTION_METRICS_ENABLED) !== '1') return operation(env);
  const route = performanceRoute(request);
  if (!route || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return operation(env);
  const configured = Number(env.CONNECTION_METRICS_SAMPLE_RATE ?? 0.1);
  const rate = Number.isFinite(configured) ? Math.min(1, Math.max(0, configured)) : 0;
  if (!rate || crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 >= rate) return operation(env);
  const started = clock(), requestId = crypto.randomUUID(), stages = Object.create(null);
  let finished = false;
  const log = record => { try { console.info(JSON.stringify(record)); } catch { /* diagnostics are best effort */ } };
  const metrics = { add(stage, duration) {
    if (!STAGES.has(stage) || !Number.isFinite(duration)) return;
    const entry = stages[stage] ||= { count: 0, totalMs: 0 };
    entry.count++; entry.totalMs += Math.max(0, duration);
    // Durable notification work may finish after its HTTP ACK. Keep that time
    // separate instead of either delaying the ACK or silently omitting it.
    if (finished) log({ event: 'maydan.connection.background', schema: 1, requestId, route, stage, durationMs: milliseconds(duration) });
  } };
  let status = 500;
  try {
    const response = await operation({ ...env, REQUEST_METRICS: metrics });
    status = response.status;
    // Never rebuild an upgrade response or attach telemetry to its socket.
    if (status === 101) return response;
    const headers = new Headers(response.headers);
    headers.set('x-maydan-trace-id', requestId);
    // Only the total duration is exposed. Internal checks stay in safe logs.
    headers.set('server-timing', `app;dur=${milliseconds(clock() - started)}`);
    const expose = new Set((headers.get('access-control-expose-headers') || '').split(',').map(value => value.trim()).filter(Boolean));
    expose.add('x-maydan-trace-id'); expose.add('server-timing');
    headers.set('access-control-expose-headers', [...expose].join(', '));
    return new Response(response.body, { status, statusText: response.statusText, headers });
  } finally {
    // Logging can fail independently; diagnostics never turn a committed send
    // into a failed acknowledgement. No mutable state survives this request.
    finished = true;
    log({ event: 'maydan.connection', schema: 1, requestId, route, method: request.method, status,
      totalMs: milliseconds(clock() - started), stages: Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, { count: value.count, totalMs: milliseconds(value.totalMs) }])) });
  }
}
