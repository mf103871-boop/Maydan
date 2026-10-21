import { json } from './protocol.mjs';

const APP_STORE_ID = '6808385717';
const BUNDLE_ID = 'Maydan';
const MESSAGE = 'يتوفر تحديث جديد لميدان. حدّث التطبيق من App Store للمتابعة.';
// Local candidate only: deployment of this alternative has not been approved.
// This records a completed public-release check, not continuing Apple availability.
// It intentionally has no expiry. Disable the existing flag to revoke enforcement;
// a different threshold requires a newly reviewed, independently verified record.
const VERIFIED_RELEASE = Object.freeze({
  schemaVersion: 1,
  appStoreId: APP_STORE_ID,
  bundleId: BUNDLE_ID,
  version: '1.8',
  build: 22,
  buildId: '093728e9-5d77-4d9f-8725-5e1c4de8c5f9',
  appStoreVersionId: 'd15b847b-310e-441a-a579-1533a75c0b25',
  sourceCommit: '2fe524e98f8a455b1b801ab4c0fdd9d82f9396ef',
  verifiedAt: '2026-10-21T04:56:30.151Z',
  evidenceSHA256: 'e01918ea6c1e87304f2c146b3c684b052b0bc842407700dffd13a1aac33a1206',
  officialPublic: true,
  downloadable: true,
  countries: Object.freeze({
    JO: Object.freeze({ minimumOS: '16.4' }),
    SA: Object.freeze({ minimumOS: '16.4' }),
    AE: Object.freeze({ minimumOS: '16.4' }),
    US: Object.freeze({ minimumOS: '16.4' }),
  }),
});

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

function verifiedRelease(record, instant) {
  if (!record || Array.isArray(record) || typeof record !== 'object' || !Number.isFinite(instant)) return null;
  // Pin the approved release identity and evidence. The factory override below is
  // only a dependency-injection seam for tests; requests and env cannot supply it.
  for (const field of ['schemaVersion', 'appStoreId', 'bundleId', 'version', 'build', 'buildId',
    'appStoreVersionId', 'sourceCommit', 'evidenceSHA256', 'officialPublic', 'downloadable']) {
    if (record[field] !== VERIFIED_RELEASE[field]) return null;
  }
  const verifiedAt = typeof record.verifiedAt === 'string' ? Date.parse(record.verifiedAt) : NaN;
  if (!Number.isFinite(verifiedAt) || new Date(verifiedAt).toISOString() !== record.verifiedAt || verifiedAt > instant) return null;
  if (!record.countries || typeof record.countries !== 'object' || Array.isArray(record.countries)) return null;
  const countries = new Map();
  for (const [country, evidence] of Object.entries(record.countries)) {
    if (!Object.hasOwn(VERIFIED_RELEASE.countries, country)
        || !evidence || evidence.minimumOS !== VERIFIED_RELEASE.countries[country].minimumOS) return null;
    countries.set(country, versionParts(evidence.minimumOS));
  }
  return { version: record.version, build: record.build, countries };
}

// Public availability and the exact ASC build were checked before this record was
// bundled. The three existing policy flags remain the only activation controls.
// No Apple transport, per-request availability check, or background refresh occurs.
export function createIOSAppPolicy({ releaseRecord = VERIFIED_RELEASE, now = Date.now } = {}) {

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
      const release = verifiedRelease(releaseRecord, now());
      if (!release || release.version !== policy.minimumVersion || release.build !== policy.minimumBuild) return send(response);
      const params = new URL(request.url).searchParams;
      if (params.getAll('storefront').length !== 1 || params.getAll('osVersion').length !== 1) return send(response);
      const country = countryOf(params.get('storefront')), osVersion = versionParts(params.get('osVersion'));
      if (!country || !osVersion) return send(response);
      const minimumOS = release.countries.get(country);
      if (minimumOS && atLeast(osVersion, minimumOS)) {
        Object.assign(response, { enabled: true, minimumBuild: policy.minimumBuild, minimumVersion: policy.minimumVersion });
      }
    } catch { /* Invalid configuration or unavailable policy data must never lock a player out. */ }
    return send(response);
  };
}

export const iosAppPolicy = createIOSAppPolicy();
