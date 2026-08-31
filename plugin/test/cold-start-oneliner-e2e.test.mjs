// @test-group engine
// cold-start-oneliner-e2e.test.mjs — gap-cold-start-...-eight-steps, phase 3 (AC1 measure).
//
// Pins the Contract's `input_commands` measure: the cold start is ≤4 human-input commands, each
// recorded verbatim, with the inner start INSIDE the /quay:cold-start skill (AC1 correction — never
// a separate human step). The e2e's --count-inputs is the mechanical, falsifiable surface for AC1.
//
// Run:
//   scripts/test.sh plugin/test/cold-start-oneliner-e2e.test.mjs
//   node --test plugin/test/cold-start-oneliner-e2e.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const e2e = path.join(repoRoot, 'test', 'cold-start-oneliner-e2e.sh');

test('AC1 — the cold-start oneliner e2e reports input_commands <= 4 with each input recorded verbatim', () => {
  const r = spawnSync('bash', [e2e, '--count-inputs'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `--count-inputs must exit 0:\n${r.stderr}`);
  assert.match(r.stdout, /input_commands=3/, 'the cold start is 3 human inputs (install → init → cold-start skill)');
  assert.match(r.stdout, /AC1: input_commands=3 <= 4/, 'the e2e must assert the <=4 band');
  // Verbatim recording: each input is a distinct line, and the inner start is NOT a separate input.
  assert.match(r.stdout, /\[1\]/, 'input 1 (install) must be recorded verbatim');
  assert.match(r.stdout, /\[2\]/, 'input 2 (init) must be recorded verbatim');
  assert.match(r.stdout, /\[3\]/, 'input 3 (cold-start skill) must be recorded verbatim');
  assert.ok(!r.stdout.includes('[4]'), 'there must be no 4th human input (inner start is inside the skill)');
  assert.match(r.stdout, /\/quay:cold-start/, 'the cold-start skill command must be one of the recorded inputs');
});
