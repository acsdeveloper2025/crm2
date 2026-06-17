#!/usr/bin/env node
/**
 * CRM2 — fail on forbidden suppression directives (Parts 2 & 3).
 * ESLint `noInlineConfig` makes inline disables INERT; this makes their mere
 * PRESENCE fail CI. TODO/FIXME/HACK/TEMP are enforced by ESLint no-warning-comments
 * (comment-aware, so it never false-positives on words like "Templates").
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['apps', 'packages'];
const EXTS = ['.ts', '.tsx'];
const FORBIDDEN = ['@ts-ignore', '@ts-nocheck', '@ts-expect-error', 'eslint-disable'];

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage' || name === '.turbo') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.some((e) => full.endsWith(e))) out.push(full);
  }
}

const files = [];
for (const r of ROOTS) {
  try {
    walk(r, files);
  } catch {
    // root may not exist in a partial checkout — skip
  }
}

const violations = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const token of FORBIDDEN) {
      if (line.includes(token)) violations.push(`${file}:${i + 1}  ${token}`);
    }
  });
}

if (violations.length > 0) {
  process.stderr.write(`Forbidden suppression directives found (Parts 2 & 3):\n${violations.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`no-suppressions: clean (${files.length} files scanned)\n`);
