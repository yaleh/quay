// @test-group engine
// adr016-screen-use-check.test.mjs — ADR-016 Amendment 2026-08-04 whole-screen-hash gate
// (tasks/gap-adr-016-carve-out-permits-the-whole-screen-hash-it-was-meant-to-forbid).
//
// AC1 Amendment 2026-08-04 present with the three pinned boundaries (enumerated states / bottom
// region / no whole-screen hash) · AC2 enforcement: points at this checker · AC3 detection by CODE
// POSITION (capture-pane flows into md5sum/sha1sum/cksum in shell scripts + the fenced ```bash
// INSTRUCTION blocks of the shipped/live tick docs) — a .md naming the pattern in PROSE must never
// self-match, and a comment mentioning it must not satisfy the detector · AC4 band 0..1 (one active
// legacy observer tolerated; a second goes RED) · AC5 negative control both directions · AC7
// @test-group engine.
//
// path→content (gap-b5-input-shape-path-to-content): the JUDGMENT logic is tested as PURE functions
// over string content (detectFileViolations / detectTickDocViolations / stripShellComments /
// judgeBand) — ZERO spawn, ZERO bare mkdtemp. The fs reads are of COMMITTED files (the real ADR doc
// + the real repo scan for the band) plus ONE synthetic scan-surface tree built through the shared
// makeTmpDir helper, which registers its own per-file after() cleanup — never a subprocess. 负控制 (AC2):
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
  isGeneratedMirrorPath,
  stripShellComments,
  judgeBand,
  judgeScreenHashScan,
} from "../scripts/adr016-screen-use-check.ts";
import { driverResultToExit } from "../scripts/checker-io.ts";
import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

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

test("AC3: the gitignored npm-pack staging mirror packages/quay/plugin/ is NOT part of the scan surface (otherwise every plugin/ pattern is double-counted and its transient copy skews the walk)", () => {
  // The mirror is staged by package.sh / delivery-standalone-smoke.sh for the duration of `npm pack`
  // and rm -rf'd right after. While it exists it is a second copy of plugin/ — a scan that lists it
  // reports every real plugin/ file twice (and, in the walk→read test below, a phantom second
  // "vanished" file). It is untracked, so excluding it never changes a clean checkout's surface.
  assert.equal(isGeneratedMirrorPath("packages/quay/plugin/scripts/drivable-workspace-check.sh"), true);
  assert.equal(isGeneratedMirrorPath("packages/quay/plugin/loop/fast-mode-tick-core.md"), true);
  // The REAL tree is the source of truth and must never be filtered — path-segment aware, so a
  // basename collision (a sibling directory that merely starts with the same characters) is kept.
  assert.equal(isGeneratedMirrorPath("plugin/scripts/drivable-workspace-check.sh"), false);
  assert.equal(isGeneratedMirrorPath("packages/quay/plugin-snapshot/x.sh"), false);
  assert.equal(isGeneratedMirrorPath("packages/quay/plugin"), false);
});

test("scan surface: gitignored repo-root tmp/ runtime scratch is NOT scanned — the sibling selftests' fixture COPIES of real plugin/scripts/*.sh live there and race their own cleanup", () => {
  // Reproduces the shape that reddened fan-in twice: run-identity.ts / stage-receipt.ts /
  // workflow-journal.ts each mkdtemp a fixture under <cwd>/tmp/ and copy the real
  // plugin/scripts/gate-script-lib.sh into it. A whole-repo walk that descends into tmp/ lists
  // `tmp/<selftest-XXXX>/plugin/scripts/gate-script-lib.sh` — not repo source — and when that
  // fixture's rm lands between the walk and the read it becomes a SECOND `unreadable` ENOENT,
  // failing the "the vanished file must be RETURNED" test for a reason that is not the property
  // under test. Synthetic root: the real plugin/scripts entry must survive, the tmp/ copy must not.
  const root = makeTmpDir("adr016-surface-");
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "plugin", "scripts", "real.sh"), "echo real\n");
  fs.mkdirSync(path.join(root, "tmp", "workflow-journal-selftest-abc", "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "tmp", "workflow-journal-selftest-abc", "plugin", "scripts", "gate-script-lib.sh"), "echo fixture\n");
  const scan = scanForScreenHashViolations(root);
  assert.deepEqual(
    scan.files,
    ["plugin/scripts/real.sh"],
    "tmp/ is runtime residue, not the repo — scanning it double-counts a fixture copy of a real script",
  );
  assert.equal(scan.unreadable.length, 0);
});

/** The PER-FILE property this suite pins: a file the walk listed that vanished before its read must
 * be REPORTED (`unreadable`), never swallowed.
 *
 * ⛔ Property-scoped on purpose — it deliberately does NOT assert the whole `unreadable` ARRAY.
 * The scan runs over the LIVE shared checkout (repoRoot) while OTHER test processes stage and
 * rm -rf directories under it (npm-pack staging materializes a full plugin/ snapshot; the sibling
 * selftests mkdtemp + rm their `<cwd>/tmp/` fixtures). Any of those can land an EXTRA, unrelated
 * ENOENT row in `unreadable` — which says nothing about this property, but a strict
 * `assert.deepEqual(scan.unreadable, [victim])` reads it as a failure. That is exactly how
 * `quay goal merge` reddened twice on 2026-10-08 (same test, same cause, different run), blocking
 * every goal branch on a timing artifact rather than on the code (hard rule 4b: an exact whole-array
 * reading of a tree other processes are mutating is a proxy that drifts from the property).
 *
 * Extracted so the negative control below can drive it with a SYNTHETIC scan — the loosening is
 * proven non-vacuous without depending on the live tree's timing. */
function assertVanishedFileReported(scan, victim) {
  assert.ok(
    scan.unreadable.some((e) => e.rel === victim && e.reason === "ENOENT"),
    `the vanished file must be RETURNED, not swallowed (got ${JSON.stringify(scan.unreadable)})`,
  );
}

test("walk→read race: a listed .sh that vanishes before its read is SKIPPED and REPORTED, never a crash (npm-pack staging rm -rf's packages/quay/plugin/ mid-suite)", (t) => {
  const victim = "plugin/scripts/drivable-workspace-check.sh";
  const real = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (p, ...rest) => {
    if (String(p).endsWith(victim)) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: "ENOENT" });
    return real(p, ...rest);
  });
  const scan = scanForScreenHashViolations(repoRoot);
  // Per-file (not whole-array): concurrent staging under repoRoot may contribute OTHER transient
  // rows — see assertVanishedFileReported. What must hold is that the victim's own row is there.
  assertVanishedFileReported(scan, victim);
  assert.equal(scan.violations.length, 0);
  const verdict = judgeScreenHashScan(scan);
  assert.equal(verdict.state, "verified", "a vanished file is not a violation");
  // The verdict must NAME the skip — ⛔ the count is not pinned: "0 violations over a partly-read
  // input" must not read as a clean full scan, and how MANY files were skipped is the live tree's
  // business, not this property's.
  assert.match(
    verdict.verifiedBy ?? "",
    /\d+ 个文件在 walk→read 之间消失/,
    "the verdict must name the skip — 0 violations over a partly-read input is not a clean full scan",
  );
});

test("walk→read race negative control: the loosened 'victim must be reported' assertion is NOT vacuous — a scanner that swallowed the ENOENT still goes RED", () => {
  const victim = "plugin/scripts/drivable-workspace-check.sh";
  const shape = (unreadable) => ({ violations: [], retired: [], files: [], unreadable });
  // GOOD: the victim's own row is present ⇒ the (loosened) assertion passes…
  assertVanishedFileReported(shape([{ rel: victim, reason: "ENOENT" }]), victim);
  // …and it stays tolerant of an UNRELATED transient row beside it (the loosening, pinned).
  assertVanishedFileReported(
    shape([{ rel: "packages/quay/plugin-staging-1/scripts/x.sh", reason: "ENOENT" }, { rel: victim, reason: "ENOENT" }]),
    victim,
  );
  // BAD #1: the ENOENT was swallowed entirely (the crash-free-but-silent shape) ⇒ MUST be red.
  assert.throws(
    () => assertVanishedFileReported(shape([]), victim),
    /must be RETURNED/,
    "a scanner that swallowed the vanished file must not pass the loosened assertion",
  );
  // BAD #2: rows exist, but not the victim's ⇒ MUST be red (a row for *some* other file is not the property).
  assert.throws(
    () => assertVanishedFileReported(shape([{ rel: "other.sh", reason: "ENOENT" }]), victim),
    /must be RETURNED/,
    "an unrelated vanished file must not satisfy the victim's property",
  );
});

test("walk→read race: only ENOENT is tolerated — a genuinely unreadable file (EACCES) still surfaces", (t) => {
  const real = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (p, ...rest) => {
    if (String(p).endsWith("plugin/scripts/drivable-workspace-check.sh")) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    return real(p, ...rest);
  });
  assert.throws(() => scanForScreenHashViolations(repoRoot), { code: "EACCES" });
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

// ── B4 DriverResult（gap-b4-checker-reuse-driver-result：判定收敛到 DriverResult<T> 词表）────────────

test("B4 AC3: judgeScreenHashScan maps in-band⇒verified / out-of-band⇒failed (DriverResult, exit 0/1)", () => {
  const inBand = judgeScreenHashScan({ violations: [], retired: [], files: ["a.sh"], unreadable: [] });
  assert.equal(inBand.state, "verified");
  assert.equal(driverResultToExit(inBand), 0);

  const one = judgeScreenHashScan({
    violations: [{ rel: "a.sh", line: 1, snippet: "x", reason: "same-command" }],
    retired: [],
    files: ["a.sh"],
    unreadable: [],
  });
  assert.equal(one.state, "verified", "band 0..1 tolerates one legacy observer");
  assert.equal(driverResultToExit(one), 0);

  const two = judgeScreenHashScan({
    violations: [
      { rel: "a.sh", line: 1, snippet: "x", reason: "same-command" },
      { rel: "b.sh", line: 1, snippet: "y", reason: "same-command" },
    ],
    retired: [],
    files: ["a.sh", "b.sh"],
    unreadable: [],
  });
  assert.equal(two.state, "failed", "a second active violation exceeds the band");
  assert.equal(driverResultToExit(two), 1);
});
