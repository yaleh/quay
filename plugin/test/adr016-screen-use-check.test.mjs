// @test-group governance
// adr016-screen-use-check.test.mjs — ADR-016 Amendment 2026-08-04 whole-screen-hash gate
// (tasks/gap-adr-016-carve-out-permits-the-whole-screen-hash-it-was-meant-to-forbid).
//
// AC1 Amendment 2026-08-04 present with the three pinned boundaries (enumerated states / bottom
// region / no whole-screen hash) · AC2 enforcement: points at this checker · AC3 detection by CODE
// POSITION (capture-pane flows into md5sum/sha1sum/cksum in shell scripts + the fenced ```bash
// INSTRUCTION blocks of the shipped/live tick docs — gap-adr016-md5-ban-violated-in-shipped-md-
// and-checker-scope-gap AC3) — a .md naming the pattern in PROSE must never self-match, and a
// comment mentioning it must not satisfy the detector · AC4 band 0..1 (one active legacy observer
// tolerated; a second goes RED) · AC5 negative control both directions (present → reported; removed
// → not) · AC7 @test-group governance.
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
  detectTickDocViolations,
  scanForScreenHashViolations,
  stripShellComments,
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

test("AC3/AC7: the checker scans shell scripts + tick-doc bash blocks — .md prose and the test/ADR files never self-match", () => {
  // The real repo scan (the run_static_checks invocation) must stay within the band on the
  // current tree. The ONE tolerated legacy whole-screen-hash observer — session-liveness.sh —
  // was fixed by gap-session-liveness-hashes-the-token-counter-as-if-it-were-work (its busy
  // judgment now consumes classifyPaneState; the capture-pane→md5sum flow is gone). The shipped
  // tick docs' md5(capture-pane) blocks were fixed by gap-adr016-md5-ban-violated-in-shipped-md-
  // and-checker-scope-gap (AC1), so the repo is now at ZERO active violations. The retired observer
  // (send-keys-verified.sh) was DELETED by gap-retired-script-still-callable, so the retired set is
  // empty too — no whole-screen-hash occurrences remain anywhere.
  const { violations, retired } = scanForScreenHashViolations(repoRoot);
  assert.equal(violations.length, 0, JSON.stringify(violations.map((v) => `${v.rel}:${v.line}`)));
  assert.equal(retired.length, 0); // the retired send-keys-verified.sh observer was deleted
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
