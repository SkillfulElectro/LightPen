/**
 * Guards the CI workflows against the class of bug that broke the Windows job:
 * a pinned `dtolnay/rust-toolchain` reference has no default for `toolchain`, so
 * every `uses:` of it must pass one explicitly, and that value must match
 * `rust-toolchain.toml`. Checked here (not in a YAML linter) because actionlint
 * does not know action inputs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Vitest runs with the repository root as cwd. */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const workflows = ['.github/workflows/ci.yml', '.github/workflows/release.yml'];

describe('CI workflow drift', () => {
  it('pins one Rust toolchain, matching rust-toolchain.toml', () => {
    const channel = /channel\s*=\s*"([^"]+)"/.exec(read('rust-toolchain.toml'))?.[1];
    expect(channel).toBeTruthy();
    for (const wf of workflows) {
      const env = /RUST_TOOLCHAIN:\s*'([^']+)'/.exec(read(wf))?.[1];
      expect(env, `${wf} must define RUST_TOOLCHAIN`).toBe(channel);
    }
  });

  it('passes `toolchain` to every rust-toolchain step', () => {
    for (const wf of workflows) {
      const text = read(wf);
      const steps = text.split('dtolnay/rust-toolchain@').slice(1);
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) {
        // The toolchain input must appear before the next step starts.
        const nextStep = step.indexOf('- uses:');
        const body = nextStep === -1 ? step : step.slice(0, nextStep);
        expect(body, `${wf}: a rust-toolchain step is missing \`toolchain:\``).toContain(
          'toolchain: ${{ env.RUST_TOOLCHAIN }}',
        );
      }
    }
  });

  it('does not read env: values as bare PowerShell variables', () => {
    // `env:` becomes $env:NAME in PowerShell; `$NAME` there is always empty.
    const text = read('.github/workflows/release.yml');
    for (const block of text.split('shell: pwsh').slice(1)) {
      // YAML comments are not executed; only the script body matters.
      const body = block
        .slice(0, block.indexOf('- name:'))
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');
      expect(body).not.toMatch(/\$TAG\b/);
    }
  });

  it('generates Cargo.lock before auditing it', () => {
    const text = read('.github/workflows/ci.yml');
    const audit = text.slice(text.indexOf('cargo audit --file'));
    expect(audit.length).toBeGreaterThan(0);
    expect(text.indexOf('cargo generate-lockfile')).toBeLessThan(
      text.indexOf('cargo audit --file'),
    );
  });
});
