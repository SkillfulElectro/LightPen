/**
 * Copy MediaPipe WASM files into public/wasm/ so they are bundled locally
 * (no CDN at runtime) and served next to the app on every platform.
 * Runs automatically via `postinstall`.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dest = join(root, 'public', 'wasm');

if (!existsSync(src)) {
  console.warn('[copy-wasm] tasks-vision wasm not found, skipping.');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('[copy-wasm] MediaPipe WASM copied to public/wasm/');
