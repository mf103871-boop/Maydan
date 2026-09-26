// المسار القديم: البنك يُبنى الآن في scripts/audio/build.mjs (تركيب + إتقان + ترميز).
// يبقى هذا الغلاف كي تعمل الأوامر والوثائق القديمة بالوسائط نفسها (--check، --only).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./audio/build.mjs', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
