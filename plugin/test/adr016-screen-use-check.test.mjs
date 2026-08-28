// @test-group governance
// adr016-screen-use-check.test.mjs — ADR-016 Amendment 2026-08-04 whole-screen-hash gate
// (tasks/gap-adr-016-carve-out-permits-the-whole-screen-hash-it-was-meant-to-forbid).
//
// AC1 Amendment 2026-08-04 present with the three pinned boundaries (enumerated states / bottom
// region / no whole-screen hash) · AC2 enforcement: points at this checker · AC3 detection by CODE
// POSITION (capture-pane flows into md5sum/sha1sum/cksum in shell scripts + the fenced ```bash
// INSTRUCTION blocks of the shipped/live tick docs) — a .md naming the pattern in PROSE must never
// self-match, and a comment mentioning it must not satisfy the detector · AC4 band 0..1 (one active
// legacy observer tolerated; a second goes RED) · AC5 negative control both directions · AC7
// @test-group governance.
//
// path→content (gap-b5-input-shape-path-to-content): the JUDGMENT logic is tested as PURE functions
// over string content (detectFileViolations / detectTickDocViolations / stripShellComments /
// judgeBand) — ZERO spawn, ZERO mkdtemp. The only fs reads are of COMMITTED files (the real ADR
// doc + the real repo scan for the band), never a temp dir and never a subprocess. 负控制 (AC2):
// commenting out any judgment branch below (e.g. the `if (CAPTURE_PANE_RE.test(line))` same-command
// branch, or the taint seeding loop) makes the corresponding RED test fail — the tests pin the
// judgment, not the shell.
//
// Run: scripts/test.sh plugin/test/adr016-screen-use-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  detectFileViolations,
  detectTickDocViolations,
  scanForScreenHashViolations,
  stripShellComments,
  judgeBand,
} from "../scripts/adr016-screen-use-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

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

test("AC4: judgeBand is PURE — 0 and 1 active violations are within band (PASS)", () => {
  assert.deepEqual(judgeBand(0), { inBand: true, verdict: "PASS" });
  assert.deepEqual(judgeBand(1), { inBand: true, verdict: "PASS" });
});

test("AC4: judgeBand is PURE — a SECOND active violation exceeds the band (FAIL)", () => {
  assert.deepEqual(judgeBand(2), { inBand: false, verdict: "FAIL" });
  assert.deepEqual(judgeBand(3), { inBand: false, verdict: "FAIL" });
});

test("AC5: negative control both directions — the flow present → reported; absent → not reported", () => {
  const vsPresent = detectFileViolations("zz-negcontrol.sh", "hash=$(tmux capture-pane -p -t x | md5sum)\n");
  assert.equal(vsPresent.length, 1);
  assert.equal(vsPresent[0].reason, "same-command");
  const vsAbsent = detectFileViolations("zz-negcontrol.sh", "hash=$(cat x | md5sum)\n");
  assert.equal(vsAbsent.length, 0);
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

test("AC3/AC7: the checker scans shell scripts + tick-doc bash blocks — .md prose and the test/ADR files never self-match", () => {
  // The real repo scan (the run_static_checks invocation) must stay within the band on the
  // current tree — ZERO active violations, ZERO retired observers.
  const { violations, retired } = scanForScreenHashViolations(repoRoot);
  assert.equal(violations.length, 0, JSON.stringify(violations.map((v) => `${v.rel}:${v.line}`)));
  assert.equal(retired.length, 0);
});

test("AC3: a fenced ```bash INSTRUCTION block in a tick doc is a violation (shipped bash blocks are not prose)", () => {
  const src = [
    "# prose heading — never scanned",
    "```bash",
    "tmux capture-pane -p -t \"$TMUX_SESSION\" | md5sum; sleep 25",
    "tmux capture-pane -p -t \"$TMUX_SESSION\" | md5sum      # 两次相同 = 空闲",
    "```",
  ].join("\n");
  const vs = detectTickDocViolations("plugin/loop/orchestrator-loop-tick.md", src);
  assert.equal(vs.length, 2);
  assert.equal(vs[0].reason, "same-command");
  assert.equal(vs[0].line, 3); // offset back to the .md line, not the block-relative line
  assert.equal(vs[1].line, 4);
});

test("AC3: prose in a tick doc naming the flow is NOT a violation (prose exempt — a correction note can never self-match)", () => {
  const src = "judge idle: a capture-pane result flowing into md5sum was the old shape — prose is exempt\n";
  const vs = detectTickDocViolations("plugin/loop/manager-loop-tick.md", src);
  assert.equal(vs.length, 0);
});

test("AC3: the compliant alternative (`tail -3 | grep 'esc to interrupt'`) in a tick-doc bash block is NOT a violation", () => {
  const src = ["```bash", "tmux capture-pane -p -t \"$TMUX_SESSION\" | tail -3 | grep -q 'esc to interrupt' && echo busy || echo idle", "```"].join("\n");
  const vs = detectTickDocViolations("plugin/loop/orchestrator-loop-tick.md", src);
  assert.equal(vs.length, 0);
});

test("stripShellComments: comments are stripped but string literals preserved", () => {
  assert.equal(stripShellComments("# full line\necho hi # trailing\necho 'a#b'\necho \"c#d\"\n"), "\necho hi \necho 'a#b'\necho \"c#d\"\n");
});
