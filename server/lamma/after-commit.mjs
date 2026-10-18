// These tasks only fan out an already committed change. Push jobs are durable
// before this helper is called; the alarm/cron retries them if a wake fails.
// Cloudflare keeps the work alive without making the sender wait for every
// recipient. Local runtimes without an execution context retain awaited delivery.
export async function afterCommit(context, task) {
  const pending = Promise.resolve().then(task).catch(() => {});
  if (typeof context?.waitUntil === 'function') context.waitUntil(pending);
  else await pending;
}
