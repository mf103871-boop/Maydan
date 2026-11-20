export function validateServerUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return '';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return '';
    return url.origin;
  } catch { return ''; }
}
