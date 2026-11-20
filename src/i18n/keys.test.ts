/**
 * Every error kind and dynamic message key must resolve to a real string.
 * This is what caught `viewer.unknown` and `viewer.too-large` rendering as raw
 * keys in the UI before the explicit key maps were introduced.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDF_ERROR_MESSAGE_KEY, type PdfErrorKind } from '../hooks/usePdfDocument';
import { CAMERA_ERROR_MESSAGE_KEY, type CameraErrorKind } from '../platform/camera';

const en = JSON.parse(readFileSync(join(process.cwd(), 'src/i18n/en.json'), 'utf8')) as Record<
  string,
  Record<string, string>
>;

function resolve(key: string): string | undefined {
  const [ns, name] = key.split('.');
  if (!ns || !name) return undefined;
  return en[ns]?.[name];
}

describe('dynamic message keys', () => {
  it('resolves every PDF error kind', () => {
    const kinds: PdfErrorKind[] = ['encrypted', 'corrupt', 'too-large', 'unknown'];
    for (const kind of kinds) {
      const key = PDF_ERROR_MESSAGE_KEY[kind];
      expect(resolve(key), `${kind} → ${key}`).toBeTruthy();
    }
  });

  it('resolves every camera error kind', () => {
    const kinds: CameraErrorKind[] = ['denied', 'not-found', 'in-use', 'unsupported', 'unknown'];
    for (const kind of kinds) {
      const key = CAMERA_ERROR_MESSAGE_KEY[kind];
      expect(resolve(key), `${kind} → ${key}`).toBeTruthy();
    }
  });

  it('resolves every camera hint and tutorial exercise', () => {
    for (const hint of ['TooFar', 'TooClose', 'LowLight', 'OutOfFrame']) {
      expect(resolve(`camera.hint${hint}`), `camera.hint${hint}`).toBeTruthy();
    }
    for (const ex of ['Hover', 'Write', 'Erase', 'Swipe', 'Pause']) {
      expect(resolve(`tutorial.ex${ex}`), `tutorial.ex${ex}`).toBeTruthy();
    }
  });
});
