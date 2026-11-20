import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { LANGUAGES, initI18n, languageDirection } from './index';

const en = JSON.parse(readFileSync(join(process.cwd(), 'src/i18n/en.json'), 'utf8')) as Record<
  string,
  Record<string, string>
>;

describe('translation catalogue', () => {
  it('has no empty strings and no duplicate keys per namespace', () => {
    for (const [ns, entries] of Object.entries(en)) {
      for (const [key, value] of Object.entries(entries)) {
        expect(value.trim(), `${ns}.${key} is empty`).not.toBe('');
      }
    }
  });

  it('keeps interpolation placeholders well formed', () => {
    for (const [ns, entries] of Object.entries(en)) {
      for (const [key, value] of Object.entries(entries)) {
        const open = (value.match(/\{\{/g) ?? []).length;
        const close = (value.match(/\}\}/g) ?? []).length;
        expect(open, `${ns}.${key} has unbalanced placeholders`).toBe(close);
      }
    }
  });

  it('registers every shipped language', () => {
    expect(LANGUAGES.map((l) => l.code)).toContain('en');
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
  });
});

describe('language handling', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  it('marks right-to-left languages', () => {
    expect(languageDirection('en')).toBe('ltr');
    expect(languageDirection('ar')).toBe('rtl');
    expect(languageDirection('he-IL')).toBe('rtl');
    expect(languageDirection('ar-EG')).toBe('rtl');
  });

  it('sets lang and dir on the document', async () => {
    await initI18n('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('resolves nested keys used by the UI', () => {
    expect(i18next.t('toolbar.open')).toBe(en.toolbar?.open);
    expect(i18next.t('tutorial.stepOf', { current: 2, total: 10 })).toBe('Step 2 of 10');
  });
});
