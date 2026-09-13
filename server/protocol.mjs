import { RoomError, fail } from './room-model.mjs';
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
export function errorResponse(error) {
  return json({ error: error instanceof RoomError ? error.code : 'INTERNAL' }, error instanceof RoomError ? error.status : 500);
}
export async function readJson(request, max = 2048) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail('INVALID', 415);
  const reader = request.body?.getReader();
  if (!reader) fail('INVALID');
  const chunks = []; let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) { await reader.cancel(); fail('INVALID', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || Array.isArray(value) || typeof value !== 'object') fail('INVALID');
    return value;
  } catch (error) { if (error instanceof RoomError) throw error; fail('INVALID'); }
}
export async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function credentials(input) {
  if (!/^[a-f0-9]{32}$/.test(input.id) || !/^[a-f0-9]{64}$/.test(input.token)) fail('AUTH', 401);
  return { ...input, tokenHash: await sha256(input.token), token: undefined };
}
export function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const [random] = crypto.getRandomValues(new Uint32Array(1));
    const j = Math.floor(random / 4294967296 * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
