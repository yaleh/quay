// @test-group governance
// adr016-screen-use-check.test.mjs — ADR-016 Amendment 2026-08-04 whole-screen-hash gate
// (tasks/gap-adr-016-carve-out-permits-the-whole-screen-hash-it-was-meant-to-forbid).
//
// AC1 Amendment 2026-08-04 present with the three pinned boundaries (enumerated states / bottom
// region / no whole-screen hash) · AC2 enforcement: points at this checker · AC3 detection by CODE
// POSITION (capture-pane flows into md5sum/sha1sum/cksum in shell scripts) — a .md naming the
// pattern must never self-match, and a comment mentioning it must not satisfy the detector ·
// AC4 band 0..1 (one active legacy observer tolerated; a second goes RED) · AC5 negative control
// both directions (present → reported; removed → not) · AC7 @test-group governance.
//
// Run: scripts/test.sh plugin/test/adr016-screen-use-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  detectFileViolations,
  scanForScreenHashViolations,
  stripShellComments,
  RETIRED_FILES,
} from "../scripts/adr016-screen-use-check.ts";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const CHECKER = path.join(repoRoot, "plugin/scripts/adr016-screen-use-check.ts");

function runChecker(root) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root], {
    encoding: "utf8",
  });
}

test("AC3: detection is by code position — a capture-pane result flowing into md5sum (same command) is a violation", () => {
  const vs = detectFileViolations("evil.sh", "hash=$(tmux capture-pane -p -t x | md5sum | cut -c1-16)\n");
  assert.equal(vs.length, 1);
  assert.equal(vs[0].reason, "same-command");
});

test("AC3: the session-liveness.sh shape (capture → mask → hash across commands) is caught by variable-taint flow", () => {
  const src = [
    'raw=$(tmux capture-pane -p -t "$target" 2>/dev/null)',
    'masked=$(printf \'%s\\n\' "$raw" | mask_pane)',
    "h=$(printf '%s' \"$masked\" | md5sum | cut -c1-16)",
  ].join("\n");
  const vs = detectFileViolations("live.sh", src);
  assert.equal(vs.length, 1);
  assert.equal(vs[0].reason, "taint-flow");
  assert.equal(vs[0].taintSource, "masked");
  assert.equal(vs[0].line, 3);
});

test("AC3: a comment merely mentioning the pattern is NOT a violation (comment-vs-code)", () => {
  const vs = detectFileViolations("c.sh", "# never do capture-pane | md5sum\necho hi\n");
  assert.equal(vs.length, 0);
});

test("AC3: hashing a non-pane source (md5sum on a file) is not a violation", () => {
  const vs = detectFileViolations("d.sh", "md5sum data.txt\n");
  assert.equal(vs.length, 0);
});

test("AC3: .md prose is never scanned — the ADR's own words cannot self-match", () => {
  const dir = makeTmpDir("adr016-md-");
  // The ADR amendment text names the exact anti-pattern.
  fs.mkdirSync(path.join(dir, "adr"), { recursive: true });
  fs.writeFileSync(path.join(dir, "adr/ADR-016-x.md"), "clause 1 … whole-screen `md5(capture-pane)` is forbidden\n");
  fs.writeFileSync(path.join(dir, "ok.sh"), "echo hello\n");
  const { violations, files } = scanForScreenHashViolations(dir);
  assert.equal(violations.length, 0);
  assert.deepEqual(files, ["ok.sh"]); // only the shell script was scanned
});

test("AC4: band 0..1 — one active violation is tolerated (reported, exit 0)", () => {
  const dir = makeTmpDir("adr016-band1-");
  fs.writeFileSync(path.join(dir, "legacy.sh"), "h=$(tmux capture-pane -p -t x | md5sum | cut -c1-16)\n");
  const { violations } = scanForScreenHashViolations(dir);
  assert.equal(violations.length, 1);
  const res = runChecker(dir);
  assert.equal(res.status, 0); // within band
  assert.match(res.stdout, /violations: 1/);
  assert.match(res.stdout, /legacy\.sh:1/);
});

test("AC4: a SECOND active violation exceeds the band → exit 1 (new active violation)", () => {
  const dir = makeTmpDir("adr016-band2-");
  fs.writeFileSync(path.join(dir, "a.sh"), "h=$(tmux capture-pane -p -t x | md5sum | cut -c1-16)\n");
  fs.writeFileSync(path.join(dir, "b.sh"), "h=$(tmux capture-pane -p -t y | sha1sum)\n");
  const { violations } = scanForScreenHashViolations(dir);
  assert.equal(violations.length, 2);
  const res = runChecker(dir);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /violations: 2/);
  assert.match(res.stdout, /b\.sh:1/);
});

test("AC4: send-keys-verified.sh is RETIRED (superseded under ruling F) — reported but not counted", () => {
  const dir = makeTmpDir("adr016-retired-");
  fs.mkdirSync(path.join(dir, "plugin/scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin/scripts/send-keys-verified.sh"),
    "hash_before=$(tmux capture-pane -p -t \"$TARGET\" 2>/dev/null | md5sum | cut -c1-16)\n",
  );
  const { violations, retired } = scanForScreenHashViolations(dir);
  assert.equal(violations.length, 0); // not counted against the band
  assert.equal(retired.length, 1);
  assert.equal(retired[0].rel, "plugin/scripts/send-keys-verified.sh");
  const res = runChecker(dir);
  assert.equal(res.status, 0); // retired observer does not redden the gate
});

test("AC5: negative control both directions — file present → reported; removed → not reported", () => {
  const dir = makeTmpDir("adr016-ac5-");
  const evil = path.join(dir, "zz-negcontrol.sh");
  fs.writeFileSync(evil, "hash=$(tmux capture-pane -p -t x | md5sum)\n");
  let { violations } = scanForScreenHashViolations(dir);
  assert.equal(violations.length, 1);
  assert.match(violations[0].rel, /zz-negcontrol\.sh/);
  fs.rmSync(evil);
  ({ violations } = scanForScreenHashViolations(dir));
  assert.equal(violations.length, 0);
});

test("AC1: the ADR-016 Amendment 2026-08-04 section exists with the three pinned boundaries", () => {
  const adr = fs.readFileSync(path.join(repoRoot, "adr/ADR-016-cross-workspace-autonomous-operation-via-tmux-remote-drive.md"), "utf8");
  assert.match(adr, /## Amendment 2026-08-04/);
  assert.match(adr, /enumerated/i);
  assert.match(adr, /waiting-input/);
  assert.match(adr, /permission-prompt/);
  assert.match(adr, /busy/);
  assert.match(adr, /error-banner/);
  assert.match(adr, /unknown/);
  assert.match(adr, /bottom region/i);
  assert.match(adr, /md5/);
});

test("AC2: the ADR enforcement: frontmatter points at the mechanical checker", () => {
  const adr = fs.readFileSync(path.join(repoRoot, "adr/ADR-016-cross-workspace-autonomous-operation-via-tmux-remote-drive.md"), "utf8");
  assert.match(adr, /enforcement:/);
  assert.match(adr, /adr016-screen-use-check\.ts/);
});

test("AC3/AC7: the checker itself is a shell-script scanner — the test file and ADR prose are .md/.mjs and never self-match", () => {
  // The real repo scan (the run_static_checks invocation) must stay within the band on the
  // current tree: exactly one ACTIVE observer (session-liveness.sh) and the retired one.
  const { violations, retired } = scanForScreenHashViolations(repoRoot);
  assert.equal(violations.length, 1, JSON.stringify(violations.map((v) => `${v.rel}:${v.line}`)));
  assert.equal(violations[0].rel, "plugin/scripts/session-liveness.sh");
  assert.ok(retired.length >= 1); // send-keys-verified.sh retired occurrences
});

test("stripShellComments: comments are stripped but string literals preserved", () => {
  assert.equal(stripShellComments("# full line\necho hi # trailing\necho 'a#b'\necho \"c#d\"\n"), "\necho hi \necho 'a#b'\necho \"c#d\"\n");
});
