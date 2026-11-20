/**
 * Verify the app version is identical in package.json, src-tauri/Cargo.toml
 * and src-tauri/tauri.conf.json. Fails with a clear message otherwise.
 * Runs in CI (see .github/workflows/ci.yml).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const cargo = readFileSync(join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
const tauriConf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));

const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
const versions = {
  'package.json': pkg.version,
  'src-tauri/Cargo.toml': cargoVersion,
  'src-tauri/tauri.conf.json': tauriConf.version,
};

const unique = new Set(Object.values(versions));
if (unique.size !== 1 || [...unique][0] === undefined) {
  console.error('[check-versions] Version mismatch:');
  for (const [file, v] of Object.entries(versions)) console.error(`  ${file}: ${v}`);
  process.exit(1);
}
console.log(`[check-versions] All versions in sync: ${[...unique][0]}`);
