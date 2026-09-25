export function profileAssetUrl(value, server) {
  if (!value || typeof value !== 'string' || !server) return null;
  try {
    const url = new URL(value, server);
    if (url.origin !== new URL(server).origin || !/^\/api\/profiles\/[A-Za-z0-9_-]+\/images\/(avatar|cover)\/[a-f0-9]{64}$/.test(url.pathname) || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}
