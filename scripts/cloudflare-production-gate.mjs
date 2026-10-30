// Deliberately no deploy, credentials, network or child-process imports.
// A successful build-only check is not authorization to deploy either Worker.
import { pathToFileURL } from 'node:url';

export const PRODUCTION_GATE_MESSAGE = 'Production deployment is blocked. Use the reviewed paired game+rooms preservation procedure in docs/releases/production-paired-release.md.';
export function productionGate(args = []) {
  if (args.length === 1 && args[0] === '--build-only') return {
    buildOnly: true, productionDeployment: false, applyAvailable: false,
    requiredProcedure: 'docs/releases/production-paired-release.md',
  };
  const error = new Error(PRODUCTION_GATE_MESSAGE);
  error.code = 'PRODUCTION_RELEASE_REVIEW_REQUIRED';
  throw error;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(productionGate(process.argv.slice(2)))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
