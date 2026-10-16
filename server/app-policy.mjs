import { json } from './protocol.mjs';

const APP_STORE_ID = '6808385717';
const BUNDLE_ID = 'Maydan';
const MESSAGE = 'يتوفر تحديث جديد لميدان. حدّث التطبيق من App Store للمتابعة.';
const CACHE_TTL_MS = 5 * 60_000;
const LOOKUP_TIMEOUT_MS = 1800;

// ISO 3166-1 alpha-3 -> alpha-2, from Unicode CLDR codeMappings (CLDR 48).
// Reserved/obsolete regions are excluded. Unknown StoreKit regions fail open.
// https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-core/supplemental/codeMappings.json
const COUNTRIES = new Map(`
AND:AD ARE:AE AFG:AF ATG:AG AIA:AI ALB:AL ARM:AM AGO:AO ATA:AQ ARG:AR ASM:AS AUT:AT AUS:AU ABW:AW ALA:AX AZE:AZ
BIH:BA BRB:BB BGD:BD BEL:BE BFA:BF BGR:BG BHR:BH BDI:BI BEN:BJ BLM:BL BMU:BM BRN:BN BOL:BO BES:BQ BRA:BR BHS:BS BTN:BT BVT:BV BWA:BW BLR:BY BLZ:BZ
CAN:CA CCK:CC COD:CD CAF:CF COG:CG CHE:CH CIV:CI COK:CK CHL:CL CMR:CM CHN:CN COL:CO CRI:CR CUB:CU CPV:CV CUW:CW CXR:CX CYP:CY CZE:CZ
DEU:DE DJI:DJ DNK:DK DMA:DM DOM:DO DZA:DZ ECU:EC EST:EE EGY:EG ESH:EH ERI:ER ESP:ES ETH:ET
FIN:FI FJI:FJ FLK:FK FSM:FM FRO:FO FRA:FR GAB:GA GBR:GB GRD:GD GEO:GE GUF:GF GGY:GG GHA:GH GIB:GI GRL:GL GMB:GM GIN:GN GLP:GP GNQ:GQ GRC:GR SGS:GS GTM:GT GUM:GU GNB:GW GUY:GY
HKG:HK HMD:HM HND:HN HRV:HR HTI:HT HUN:HU IDN:ID IRL:IE ISR:IL IMN:IM IND:IN IOT:IO IRQ:IQ IRN:IR ISL:IS ITA:IT JEY:JE JAM:JM JOR:JO JPN:JP
KEN:KE KGZ:KG KHM:KH KIR:KI COM:KM KNA:KN PRK:KP KOR:KR KWT:KW CYM:KY KAZ:KZ LAO:LA LBN:LB LCA:LC LIE:LI LKA:LK LBR:LR LSO:LS LTU:LT LUX:LU LVA:LV LBY:LY
MAR:MA MCO:MC MDA:MD MNE:ME MAF:MF MDG:MG MHL:MH MKD:MK MLI:ML MMR:MM MNG:MN MAC:MO MNP:MP MTQ:MQ MRT:MR MSR:MS MLT:MT MUS:MU MDV:MV MWI:MW MEX:MX MYS:MY MOZ:MZ
NAM:NA NCL:NC NER:NE NFK:NF NGA:NG NIC:NI NLD:NL NOR:NO NPL:NP NRU:NR NIU:NU NZL:NZ OMN:OM PAN:PA PER:PE PYF:PF PNG:PG PHL:PH PAK:PK POL:PL SPM:PM PCN:PN PRI:PR PSE:PS PRT:PT PLW:PW PRY:PY QAT:QA
REU:RE ROU:RO SRB:RS RUS:RU RWA:RW SAU:SA SLB:SB SYC:SC SDN:SD SWE:SE SGP:SG SHN:SH SVN:SI SJM:SJ SVK:SK SLE:SL SMR:SM SEN:SN SOM:SO SUR:SR SSD:SS STP:ST SLV:SV SXM:SX SYR:SY SWZ:SZ
TCA:TC TCD:TD ATF:TF TGO:TG THA:TH TJK:TJ TKL:TK TLS:TL TKM:TM TUN:TN TON:TO TUR:TR TTO:TT TUV:TV TWN:TW TZA:TZ UKR:UA UGA:UG UMI:UM USA:US URY:UY UZB:UZ VAT:VA VCT:VC VEN:VE VGB:VG VIR:VI VNM:VN VUT:VU WLF:WF WSM:WS YEM:YE MYT:YT ZAF:ZA ZMB:ZM ZWE:ZW
`.trim().split(/\s+/).map(pair => pair.split(':')));
const ALPHA2 = new Set(COUNTRIES.values());

function countryOf(value) {
  if (typeof value !== 'string' || !/^[a-z]{2,3}$/i.test(value)) return null;
  const upper = value.toUpperCase();
  return COUNTRIES.get(upper) || (ALPHA2.has(upper) ? upper : null);
}

function versionParts(value) {
  if (typeof value !== 'string' || !/^\d{1,6}(?:\.\d{1,6}){0,2}$/.test(value)) return null;
  return value.split('.').map(Number);
}

function atLeast(actual, minimum) {
  for (let i = 0; i < 3; i++) {
    const difference = (actual[i] || 0) - (minimum[i] || 0);
    if (difference) return difference > 0;
  }
  return true;
}

function disabled() {
  return { schemaVersion: 1, enabled: false, minimumBuild: 0, minimumVersion: null, appStoreId: APP_STORE_ID, message: MESSAGE };
}

function configuredPolicy(env) {
  const version = versionParts(env?.IOS_MIN_SUPPORTED_VERSION);
  if (env?.IOS_UPDATE_POLICY_ENABLED !== '1' || !/^[1-9]\d{0,5}$/.test(env?.IOS_MIN_SUPPORTED_BUILD || '')
      || !version || !version.some(part => part > 0)) return null;
  return { minimumBuild: Number(env.IOS_MIN_SUPPORTED_BUILD), minimumVersion: env.IOS_MIN_SUPPORTED_VERSION, version };
}

function availableApp(data, country) {
  if (!data || !Number.isInteger(data.resultCount) || !Array.isArray(data.results) || data.resultCount !== data.results.length) throw new Error('Invalid lookup');
  if (data.resultCount === 0) return null;
  if (data.resultCount !== 1) throw new Error('Unexpected lookup');
  const app = data.results[0];
  if (app?.trackId !== Number(APP_STORE_ID) || app.bundleId !== BUNDLE_ID || app.kind !== 'software' || app.wrapperType !== 'software') throw new Error('Wrong app');
  const version = versionParts(app.version), minimumOS = versionParts(app.minimumOsVersion);
  const url = new URL(app.trackViewUrl);
  // Apple may fall back to another country. Never treat that as local availability.
  if (!version || !minimumOS || url.protocol !== 'https:' || url.hostname !== 'apps.apple.com' || url.port || url.username || url.password
      || url.pathname.split('/')[1]?.toUpperCase() !== country || !url.pathname.endsWith(`/id${APP_STORE_ID}`)) throw new Error('Unverified availability');
  return { version, minimumOS };
}

// Public lookup exposes the marketing version, not CFBundleVersion. Operators must
// first verify the configured build/version pair is the public ASC release, then
// explicitly enable this policy. A future date or an uploaded TestFlight build is
// never evidence of availability. The per-store lookup is a second, live guard.
export function createIOSAppPolicy({ fetchImpl = (...args) => fetch(...args), now = Date.now, timeoutMs = LOOKUP_TIMEOUT_MS } = {}) {
  const cache = new Map(), pending = new Map();
  async function lookup(country, policy) {
    const key = `${country}:${policy.minimumVersion}:${policy.minimumBuild}`;
    const saved = cache.get(key);
    if (saved && saved.expiresAt > now()) return saved.app;
    cache.delete(key);
    if (pending.has(key)) return pending.get(key);
    const operation = (async () => {
      const controller = new AbortController();
      let timer;
      try {
        const timedOut = new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('Lookup timeout')); }, timeoutMs);
        });
        const request = (async () => {
          const response = await fetchImpl(`https://itunes.apple.com/lookup?id=${APP_STORE_ID}&entity=software&country=${country.toLowerCase()}`, {
            method: 'GET', headers: { accept: 'application/json' }, redirect: 'error', signal: controller.signal,
          });
          if (!response.ok) throw new Error('Lookup unavailable');
          return availableApp(await response.json(), country);
        })();
        const app = await Promise.race([request, timedOut]);
        // Bound isolate memory even if the operator repeatedly changes policy.
        if (cache.size >= 256) cache.delete(cache.keys().next().value);
        cache.set(key, { app, expiresAt: now() + CACHE_TTL_MS });
        return app;
      } finally { clearTimeout(timer); }
    })();
    pending.set(key, operation);
    try { return await operation; } finally { pending.delete(key); }
  }

  return async function iosAppPolicy(request, env) {
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'METHOD' }, 405, { allow: 'GET, HEAD' });
    const send = value => {
      const result = json(value);
      return request.method === 'HEAD' ? new Response(null, { status: result.status, headers: result.headers }) : result;
    };
    const response = disabled();
    try {
      const policy = configuredPolicy(env);
      if (!policy) return send(response);
      const params = new URL(request.url).searchParams;
      if (params.getAll('storefront').length !== 1 || params.getAll('osVersion').length !== 1) return send(response);
      const country = countryOf(params.get('storefront')), osVersion = versionParts(params.get('osVersion'));
      if (!country || !osVersion) return send(response);
      const app = await lookup(country, policy);
      if (app && atLeast(app.version, policy.version) && atLeast(osVersion, app.minimumOS)) {
        Object.assign(response, { enabled: true, minimumBuild: policy.minimumBuild, minimumVersion: policy.minimumVersion });
      }
    } catch { /* A policy/configuration/store outage must never lock a player out. */ }
    return send(response);
  };
}

export const iosAppPolicy = createIOSAppPolicy();
