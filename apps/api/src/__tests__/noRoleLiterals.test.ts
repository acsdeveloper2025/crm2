import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ADR-0022 drift gate: business logic must read ROLE ATTRIBUTES (permissions, hierarchy mode,
 * dimension wiring), never compare role NAMES. A new role-name literal in src is configuration
 * leaking back into code — the regression this milestone removed.
 */
const ROLE_LITERAL = /['"`](SUPER_ADMIN|MANAGER|TEAM_LEADER|BACKEND_USER|FIELD_AGENT|KYC_VERIFIER)['"`]/;

/** Sample/template DATA (import templates show an example role value) — not logic. */
const ALLOWED = new Set(['modules/users/service.ts', 'modules/verificationUnits/service.ts']);

const SRC = fileURLToPath(new URL('..', import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') out.push(...tsFiles(p));
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

describe('no role-name literals in business logic (ADR-0022)', () => {
  it('src contains zero role-name string comparisons outside the sample-data allowlist', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (ROLE_LITERAL.test(line)) offenders.push(`${rel}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
