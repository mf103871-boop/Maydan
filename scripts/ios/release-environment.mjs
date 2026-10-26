// One explicit native release destination. Never accept a caller-supplied host.
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { DEFAULT_API_ORIGIN } from './native.mjs';

export const MAFIA_PREVIEW_API_ORIGIN = 'https://maydan-mafia-preview.mf103871.workers.dev';
const ORIGINS = Object.freeze({ production: DEFAULT_API_ORIGIN, 'mafia-preview': MAFIA_PREVIEW_API_ORIGIN });

export function resolveNativeBuildOrigin(env = {}) {
  const environment = env.IOS_RELEASE_ENVIRONMENT ?? 'production';
  if (!Object.hasOwn(ORIGINS, environment)) throw new Error('IOS_RELEASE_ENVIRONMENT must be production or mafia-preview.');
  const origin = ORIGINS[environment];
  const override = env.MAYDAN_ROOMS_URL;
  if (override && override !== origin && override !== `${origin}/`) throw new Error('MAYDAN_ROOMS_URL differs from the approved release environment.');
  return origin;
}

export function validateNativeReleaseConfig(config, env = {}) {
  const expected = resolveNativeBuildOrigin(env);
  if (config?.version !== 1 || config.apiOrigin !== expected || config.authCallback !== 'maydan://auth') throw new Error('The bundled native config does not match the approved release environment.');
  return expected;
}

async function main() {
  const origin = resolveNativeBuildOrigin(process.env);
  const environment = process.env.IOS_RELEASE_ENVIRONMENT ?? 'production';
  if (process.argv[2] === '--github-env') {
    if (!process.env.GITHUB_ENV) throw new Error('GITHUB_ENV is required.');
    // Production keeps the existing default. Only the named test environment
    // receives a rooms override; both account HTTP and room WebSocket use it.
    if (environment === 'mafia-preview') await appendFile(process.env.GITHUB_ENV, `MAYDAN_ROOMS_URL=${origin}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Native environment: **${environment}** — ${origin}\n`);
  } else if (process.argv[2] === '--verify-native' && process.argv[3]) {
    validateNativeReleaseConfig(JSON.parse(await readFile(process.argv[3], 'utf8')), process.env);
  } else throw new Error('Use --github-env or --verify-native <native-config.json>.');
  console.log(`Native environment verified: ${environment}; ${origin}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
