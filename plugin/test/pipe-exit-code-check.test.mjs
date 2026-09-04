// @test-group engine
// pipe-exit-code-check.test.mjs — AC11 (gap-loop-mechanism-lives-outside-the-package-and-cannot-ship).
// The "pipe then read $?" rule was prose in a tick doc and recurred three times in two days (once
// TEN MINUTES after being written down). This pins the EXECUTABLE check that replaces the prose:
//   - the checker's own --self-check must pass (it catches the known-bad shapes, tolerates the
//     legitimate `echo $? | cat` and `${PIPESTATUS[0]}`);
//   - the shipped plugin/scripts/*.sh set must scan clean (no live anti-pattern in the shipped
//     mechanism).
//
// Run:
//   scripts/test.sh plugin/test/pipe-exit-code-check.test.mjs
//   node --test plugin/test/pipe-exit-code-check.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.resolve(__dirname, '..', 'scripts', 'pipe-exit-code-check.sh');

function run(args = [], env = {}) {
  return spawnSync('bash', [CHECK, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('AC11 — the checker self-validates: known-bad pattern caught, legitimate code clean', () => {
  const r = run(['--self-check']);
  assert.equal(r.status, 0, `self-check must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /self-check PASS/);
});

test('AC11 — the shipped plugin/scripts/*.sh set scans clean (no pipeline-then-$? anti-pattern)', () => {
  const r = run(); // no args → default scan of plugin/scripts/*.sh (self-excluding the checker)
  assert.equal(r.status, 0, `shipped .sh scan must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /clean/);
});

test('AC11 — a file with the anti-pattern is caught with a line number (exit 1)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pec-'));
  try {
    const bad = path.join(tmp, 'bad.sh');
    fs.writeFileSync(bad, '#!/usr/bin/env bash\nls | wc -l; echo $?\n', 'utf8');
    const r = run([bad]);
    assert.equal(r.status, 1, `anti-pattern file must exit 1:\n${r.stdout}`);
    assert.match(r.stdout, /same-line pipeline then \$/, 'must report the shape-1 message');
    assert.match(r.stdout, /:2:/, 'must report the offending line number');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
