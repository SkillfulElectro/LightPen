/**
 * Download the MediaPipe HandLandmarker model into public/models/.
 * The model is NOT committed to git (see .gitignore) — run this before
 * building, or CI will fetch it (see .github/workflows).
 *
 * Model: hand_landmarker.task (Google MediaPipe HandLandmarker, Apache-2.0 weights,
 * trained by Google). The model is not vendored in this repository; this script
 * downloads it into public/models/ so it is bundled into the app (no CDN at runtime).
 *
 * Sources are tried in order. Override with LIGHTPEN_MODEL_URL=<url>.
 */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const MODEL_URLS = [
  process.env.LIGHTPEN_MODEL_URL,
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  'https://media.githubusercontent.com/media/torinmb/mediapipe-touchdesigner/main/src/mediapipe/models/hand_landmark_detection/hand_landmarker.task',
].filter((u) => typeof u === 'string' && u.length > 0);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public', 'models', 'hand_landmarker.task');

await mkdir(dirname(dest), { recursive: true });
let lastError = 'no source attempted';
for (const url of MODEL_URLS) {
  try {
    console.log(`[fetch-model] Downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      lastError = `${url}: HTTP ${res.status}`;
      console.warn(`[fetch-model] ${lastError}`);
      continue;
    }
    await pipeline(res.body, createWriteStream(dest));
    console.log(`[fetch-model] Saved to ${dest}`);
    process.exit(0);
  } catch (err) {
    lastError = `${url}: ${(err instanceof Error && err.message) || String(err)}`;
    console.warn(`[fetch-model] ${lastError}`);
  }
}
console.error('[fetch-model] Could not download the hand landmarker model.');
console.error('[fetch-model] Download hand_landmarker.task manually and place it at:');
console.error(`            ${dest}`);
console.error('            (see docs/RELEASING.md → "Model download")');
process.exit(1);
