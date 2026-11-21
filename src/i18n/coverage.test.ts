/**
 * Guards against missing translations: every `t('namespace.key')` used in the
 * source must exist in en.json, and every catalogue entry should be used
 * (except the small allow-list of strings resolved dynamically).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const en = JSON.parse(readFileSync(join(root, 'src/i18n/en.json'), 'utf8')) as Record<
  string,
  Record<string, string>
>;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

const used = new Set<string>();
for (const file of sourceFiles(join(root, 'src'))) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\bt\(\s*'([\w.]+)'/g)) used.add(match[1]!);
  for (const match of text.matchAll(/t\(`([\w.]+)\$\{/g)) used.add(`${match[1]}*`);
  for (const match of text.matchAll(
    /'((?:toolbar|tutorial|camera|settings|gestures|viewer|shortcuts)\.[\w.]+)'/g,
  )) {
    used.add(match[1]!);
  }
}

const catalogue = new Set(
  Object.entries(en).flatMap(([ns, entries]) => Object.keys(entries).map((key) => `${ns}.${key}`)),
);

/** Keys composed at runtime (e.g. `camera.hint${suffix}`), checked by prefix below. */
const DYNAMIC_PREFIXES = ['camera.', 'tutorial.ex', 'tutorial.pace', 'viewer.'];

describe('translation usage', () => {
  it('every key used in the source exists in en.json', () => {
    const missing: string[] = [];
    for (const key of used) {
      if (key.endsWith('.*') || key.endsWith('*')) {
        const prefix = key.slice(0, -1);
        if (![...catalogue].some((k) => k.startsWith(prefix))) missing.push(key);
        continue;
      }
      if (!catalogue.has(key)) missing.push(key);
    }
    expect(missing).toEqual([]);
  });

  it('every catalogue key is used somewhere (or is dynamic)', () => {
    const unused = [...catalogue].filter((key) => {
      if (used.has(key)) return false;
      const prefix = DYNAMIC_PREFIXES.find((p) => key.startsWith(p));
      return !prefix;
    });
    expect(unused).toEqual([]);
  });
});
