// @test-group engine
// fan-in-push-lag-check.test.mjs — tasks/gap-fan-in-push-silently-fails-no-detection.
//
// The gap: worker-driver's mechanical fan-in advances LOCAL develop (ff-merge) and flips the task to
// done, but nothing on that path ever pushes develop → origin/develop. So "task done" and "the code
// reached the shared remote" are decoupled, and a stuck push is indistinguishable from "all normal"
// (measured twice: 2026-09-16 and 2026-09-17, both found by a human / by an unrelated Monitor).
//
// Coverage map (task ACs):
//   AC1 — 正例，真实构造：local develop leads origin by 2 commits whose OLDEST committer date is older
//         than the threshold ⇒ the detector reports `lagging` carrying the three fields (ahead count,
//         oldest sha, lag duration). Real git repos, real dates — no faked JSON anywhere.
//   AC2 — 负控制 1（假阳性方向）：leads, but the oldest ahead commit is INSIDE the threshold (a lead
//         the driver's next pass would push away) ⇒ NOT `lagging` (verdict `within-threshold`).
//   AC3 — 负控制 2（基线）：fully in sync (ahead = 0) ⇒ NOT `lagging` (verdict `in-sync`), and no event
//         is appended.
//   AC4 — 阈值依据：the default is DERIVED (12 × the driver's own round interval), not a bare
//         millisecond literal; the override chain (env → .quay/config.yml → derived) resolves and each
//         resolution reports its SOURCE; and the threshold is a real knob — the SAME reading flips
//         between `within-threshold` and `lagging` when only the threshold changes (falsifiability).
//   AC5 — 重试路径：a lag that a re-fetch makes fast-forward-able (the local remote-tracking ref is
//         stale — it still points at a peer commit origin has since moved off) ⇒ the mechanical retry
//         really pushes local develop to origin/develop (`origin/develop..develop` goes to 0), and the
//         escalation ledger is NOT written (the escalation is not unconditional).
//   AC6 — 升级路径：a TRUE non-fast-forward (the peer genuinely pushed a divergent commit) ⇒ retry
//         reports non-ff-escalate and the detector hands off to the EXISTING semantic-sync mechanism by
//         writing its ledger (`.quay/doc-develop-sync.jsonl`, event `push-lag-non-ff-escalate`) — the
//         merge strategy itself is NOT reimplemented here.
//   not-evaluated — a non-git root / absent branch is NOT reported as `in-sync` (硬规则 3b: "cannot
//         read" must not share a value with "satisfied"). Exit code 3 via the CLI.
//
// All fixtures are self-contained temp git repos (a bare origin + clones); nothing in the real checkout
// is mutated (R3 test-isolation). `// @test-group engine` — an operational git-sync mechanism, sibling
// to sync-lag-check.test.mjs / periodic-push-backup.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_ROUND_INTERVAL_MS,
  PUSH_LAG_EVENT_REL,
  PUSH_LAG_ROUNDS_BEFORE_ALARM,
  escalateToSemanticSync,
  measurePushLag,
  oldestAheadCommit,
  readPushLagThresholdFromConfig,
  resolvePushLagThresholdMs,
  retryPush,
  revCount,
  runPushLagCheck,
} from "../scripts/fan-in-push-lag-check.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const script = join(repoRoot, "plugin", "scripts", "fan-in-push-lag-check.ts");
const DOC_DEVELOP_SYNC_LEDGER = ".quay/doc-develop-sync.jsonl";

const HOUR_MS = 60 * 60 * 1000;
/** The threshold every fixture below uses: one hour. Chosen so the fixtures' commit ages (2h = stale,
 *  0h = fresh) sit unambiguously on either side — the point of AC1/AC2 is the GATE, not the number. */
const THRESHOLD = HOUR_MS;

function git(cwd, ...args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function gitEnv(cwd, args, env) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

/** Commit on the CURRENT branch with a controlled committer/author date, `ageMs` before now.
 *  AC1/AC2 turn on the committer date of the ahead set, so the fixtures must set it, not inherit
 *  "just now" — a fixture whose dates are all "now" can never exercise the threshold in either
 *  direction (both controls would read the same verdict). */
function commitAged(cwd, msg, ageMs) {
  const when = new Date(Date.now() - ageMs).toISOString();
  writeFileSync(join(cwd, "file.txt"), `${msg}\n`, "utf8");
  assert.equal(git(cwd, "add", "-A").status, 0, "git add");
  const env = { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
  assert.equal(gitEnv(cwd, ["commit", "-q", "-m", msg], env).status, 0, `git commit ${msg}`);
  return git(cwd, "rev-parse", "HEAD").stdout.trim();
}

function commitNow(cwd, msg) {
  return commitAged(cwd, msg, 0);
}

/** World: bare `origin.git` + a `machine` clone whose `develop` is the branch under test, plus an
 *  optional `peer` clone used to move origin/develop behind the machine's back. */
function makeWorld(prefix) {
  const root = mkdtempSync(join(tmpdir(), `pushlag-${prefix}-`));
  const shared = join(root, "origin.git");
  const m = join(root, "machine");
  assert.equal(git(root, "init", "-q", "--bare", shared).status, 0, "init bare origin");
  assert.equal(git(root, "clone", "-q", shared, m).status, 0, "clone machine");
  git(m, "config", "user.name", "machine");
  git(m, "config", "user.email", "m@example.com");
  git(m, "checkout", "-q", "-b", "develop");
  commitNow(m, "develop base");
  assert.equal(git(m, "push", "-q", "-u", "origin", "develop").status, 0, "publish develop base");
  return { root, shared, m };
}

function clonePeer(w) {
  const peer = join(w.root, "peer");
  assert.equal(git(w.root, "clone", "-q", w.shared, peer).status, 0, "clone peer");
  git(peer, "config", "user.name", "peer");
  git(peer, "config", "user.email", "p@example.com");
  git(peer, "checkout", "-q", "-B", "develop", "origin/develop");
  return peer;
}

function thresholdFor(root, roundIntervalMs = DEFAULT_ROUND_INTERVAL_MS) {
  return resolvePushLagThresholdMs({ root, roundIntervalMs, env: {} });
}

function measure(m, opts = {}) {
  const th = thresholdFor(m);
  return measurePushLag({
    root: m, branch: "develop", remote: "origin",
    thresholdMs: opts.thresholdMs ?? th.ms, thresholdSource: opts.thresholdSource ?? th.source,
  });
}

function runCli(args, env = {}) {
  const res = spawnSync("node", ["--experimental-strip-types", script, ...args], {
    encoding: "utf8", env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ── AC1: 正例 —— 领先且最老一条已超过阈值 ⇒ 报出滞后（含三个字段）────────────────────────────────

test("AC1: a real lead whose OLDEST ahead commit is older than the threshold is reported as lagging with (ahead, oldest sha, lag duration)", () => {
  const w = makeWorld("ac1");
  try {
    const base = git(w.m, "rev-parse", "develop").stdout.trim();
    // Two real local commits, both 2h old (older than the 1h threshold).
    const c1 = commitAged(w.m, "local work 1", 2 * HOUR_MS);
    const c2 = commitAged(w.m, "local work 2", 2 * HOUR_MS);
    assert.notEqual(base, c1);

    const r = measure(w.m);
    assert.equal(r.verdict, "lagging", `expected lagging, got ${r.verdict} (${r.reason})`);
    assert.equal(r.ahead, 2, "field 1: the ahead commit count is enumerated");
    assert.equal(r.behind, 0, "origin has nothing the machine lacks");
    // field 2: the OLDEST ahead commit's sha. Both fixture commits share a committer date, so the
    // oldest-by-date tie must still resolve to ONE of the two real ahead shas (never null / never a
    // sha outside the set) — the field has to be a real member of the set it summarizes.
    assert.ok([c1, c2].includes(r.oldestAheadSha), `field 2: oldest sha ${r.oldestAheadSha} is in the ahead set`);
    // field 3: the lag duration, and it is really derived from that commit's committer date.
    assert.equal(typeof r.lagMs, "number");
    assert.ok(r.lagMs >= 2 * HOUR_MS - 60_000, `field 3: lagMs ${r.lagMs} reflects the 2h-old commit`);
    // Same-source check, with a tolerance: re-reading the clock here is a SECOND reading, so an exact
    // equality would be an observation race (a few ms of real elapsed time between the two reads).
    assert.ok(
      Math.abs(r.lagMs - (Date.now() - r.oldestAheadEpochMs)) < 2_000,
      "lagMs is the age of oldestAheadEpochMs (no second source)",
    );
    assert.equal(r.diverged, false, "pure lead, not a divergence");

    // The reported surface (what a human/manager actually reads) carries all three fields.
    const cli = runCli(["--root", w.m, "--branch", "develop", "--remote", "origin", "--measure-only", "--json"]);
    assert.equal(cli.status, 1, `lagging ⇒ exit 1 (got ${cli.status}): ${cli.stderr}`);
    const j = JSON.parse(cli.stdout);
    assert.equal(j.verdict, "lagging");
    assert.equal(j.ahead, 2);
    assert.ok([c1, c2].includes(j.oldestAheadSha));
    assert.ok(typeof j.lagMs === "number" && j.lagMs >= 2 * HOUR_MS - 60_000);

    // `--measure-only` must not have moved anything (the measure face is read-only).
    assert.equal(git(w.m, "rev-parse", "develop").stdout.trim(), c2, "measure-only did not move local develop");
    assert.equal(revCount(w.m, "origin/develop", "develop"), 2, "measure-only did not push");

    // The ALARM half: the lead is past the threshold AND the upsync cannot clear it (the remote is
    // genuinely unreachable — not a divergence) ⇒ the detector reports `lagging` and lands a durable
    // event carrying all three fields. Without this the AC1 reading would only prove the measurement;
    // this proves the事故-visible surface exists.
    assert.equal(git(w.m, "remote", "set-url", "origin", join(w.root, "no-such-remote.git")).status, 0);
    const full = runPushLagCheck({ root: w.m, branch: "develop", remote: "origin", thresholdMs: THRESHOLD, thresholdSource: "test:ac1" });
    assert.equal(full.verdict, "lagging", `a lead past the threshold that cannot be pushed ⇒ lagging (got ${full.verdict})`);
    assert.equal(full.retry, "error", "the retry failed (unreachable remote), it did not escalate");
    assert.equal(full.laggingAtMeasure, true);
    assert.ok(full.eventFile, "a lag event was appended");
    const ev = readJsonl(join(w.m, PUSH_LAG_EVENT_REL));
    assert.equal(ev.length, 1, "exactly one event — the young/quiet rounds never wrote one");
    assert.equal(ev[0].verdict, "lagging");
    assert.equal(ev[0].ahead, 2, "event field 1: the ahead count");
    assert.ok([c1, c2].includes(ev[0].oldestAheadSha), "event field 2: the oldest ahead sha");
    assert.ok(ev[0].lagMs >= 2 * HOUR_MS - 60_000, "event field 3: the lag duration");
    assert.equal(ev[0].thresholdMs, THRESHOLD);
    assert.equal(ev[0].thresholdSource, "test:ac1", "the event records WHERE the threshold came from");
    // The CLI on this same stuck state exits 1 (an alarm a wrapper can act on).
    const cliStuck = runCli(["--root", w.m, "--json", "--measure-only"]);
    assert.equal(cliStuck.status, 1, "lagging ⇒ exit 1");
  } finally {
    cleanup(w.root);
  }
});

// ── AC2: 负控制 1（假阳性方向）—— 领先但在阈值内 ⇒ 不报警 ──────────────────────────────────────

test("AC2: a lead whose oldest ahead commit is INSIDE the threshold is NOT reported (the false-positive direction)", () => {
  const w = makeWorld("ac2");
  try {
    // Same shape as AC1 (ahead = 2) but the commits are seconds old ⇒ a lead the driver's next pass
    // would push away. Alarming here would turn every normal lead window into noise.
    commitNow(w.m, "brand new local work 1");
    commitNow(w.m, "brand new local work 2");
    const r = measure(w.m);
    assert.equal(r.ahead, 2, "the lead count is real (so the difference from AC1 is ONLY the age)");
    assert.equal(r.verdict, "within-threshold", `expected within-threshold, got ${r.verdict}`);
    assert.notEqual(r.verdict, "lagging", "a fresh lead must not alarm");
    assert.ok(r.lagMs < THRESHOLD, `lagMs ${r.lagMs} is inside the threshold`);

    // The measure-only face agrees and writes nothing at all.
    const th = thresholdFor(w.m);
    const measured = runPushLagCheck({ root: w.m, branch: "develop", remote: "origin", thresholdMs: th.ms, thresholdSource: th.source, measureOnly: true });
    assert.equal(measured.verdict, "within-threshold");
    assert.equal(measured.eventFile, null, "measure-only never lands an event");
    assert.equal(existsSync(join(w.m, PUSH_LAG_EVENT_REL)), false, "the event carrier was not even created");

    // The REAL run does upsync the young lead (that is the gap's fix: the fan-in result reaches
    // origin within one pass, ⛔ not after the alarm threshold) — but it still does NOT alarm.
    const out = runPushLagCheck({ root: w.m, branch: "develop", remote: "origin", thresholdMs: th.ms, thresholdSource: th.source });
    assert.equal(out.verdict, "pushed", `a young lead is upsynced, not alarmed (got ${out.verdict})`);
    assert.notEqual(out.verdict, "lagging", "AC2: a fresh lead must not alarm");
    assert.equal(out.laggingAtMeasure, false, "…and it was NOT past the threshold when measured");
    assert.equal(revCount(w.m, "origin/develop", "develop"), 0, "the young lead really reached origin in this pass");
    assert.equal(existsSync(join(w.m, PUSH_LAG_EVENT_REL)), false, "no lag event for a lead that never exceeded the threshold");
  } finally {
    cleanup(w.root);
  }
});

// ── AC3: 负控制 2（基线）—— 完全同步 ⇒ 不报警 ─────────────────────────────────────────────────

test("AC3: fully in sync (ahead = 0) is NOT reported (baseline negative control)", () => {
  const w = makeWorld("ac3");
  try {
    const r = measure(w.m);
    assert.equal(r.ahead, 0, "fixture is in sync");
    assert.equal(r.verdict, "in-sync", `expected in-sync, got ${r.verdict}`);
    assert.equal(r.oldestAheadSha, null, "no ahead set ⇒ no oldest sha (⛔ not a fabricated one)");
    assert.equal(r.lagMs, null, "no ahead set ⇒ no lag duration (⛔ not 0, which would read as measured)");

    const th = thresholdFor(w.m);
    const out = runPushLagCheck({ root: w.m, branch: "develop", remote: "origin", thresholdMs: th.ms, thresholdSource: th.source });
    assert.equal(out.verdict, "in-sync");
    assert.equal(out.retry, null, "no retry happened");
    assert.equal(out.eventFile, null, "no event appended when in sync");
    const cli = runCli(["--root", w.m, "--json"]);
    assert.equal(cli.status, 0, "in-sync ⇒ exit 0");
  } finally {
    cleanup(w.root);
  }
});

// ── AC4: 阈值依据（派生 + 来源可读 + 真的有门作用）────────────────────────────────────────────

test("AC4: the threshold is DERIVED from the driver's round interval (not a bare literal), reports its source, and is overridable", () => {
  const root = mkdtempSync(join(tmpdir(), "pushlag-ac4-"));
  try {
    // ① derived default = PUSH_LAG_ROUNDS_BEFORE_ALARM × the round interval the caller passes in.
    const a = resolvePushLagThresholdMs({ root, roundIntervalMs: 600_000, env: {} });
    assert.equal(a.ms, PUSH_LAG_ROUNDS_BEFORE_ALARM * 600_000, "12 × round interval, host/config-derived");
    assert.match(a.source, /^default:12x600000ms/, `source names the derivation: ${a.source}`);
    const b = resolvePushLagThresholdMs({ root, env: {} });
    assert.equal(b.ms, PUSH_LAG_ROUNDS_BEFORE_ALARM * DEFAULT_ROUND_INTERVAL_MS, "falls back to the driver's default interval");
    // The threshold MOVES with the interval ⇒ it is not a hidden constant wearing a derived name.
    assert.notEqual(a.ms, b.ms, "a different round interval gives a different threshold");

    // ② env override, with the source naming it.
    const e = resolvePushLagThresholdMs({ root, env: { QUAY_PUSH_LAG_THRESHOLD_MS: "90000" } });
    assert.equal(e.ms, 90_000);
    assert.equal(e.source, "env:QUAY_PUSH_LAG_THRESHOLD_MS");

    // ③ .quay/config.yml override, with the source naming the file+key.
    mkdirSync(join(root, ".quay"), { recursive: true });
    writeFileSync(join(root, ".quay", "config.yml"), "loop:\n  push_lag_threshold_ms: 45000\nothers:\n  x: 1\n", "utf8");
    assert.deepEqual(readPushLagThresholdFromConfig(root), { ms: 45_000 });
    const c = resolvePushLagThresholdMs({ root, env: {} });
    assert.equal(c.ms, 45_000);
    assert.equal(c.source, "config:.quay/config.yml loop.push_lag_threshold_ms");

    // ④ env wins over config (the more local override is the stronger one).
    const ec = resolvePushLagThresholdMs({ root, env: { QUAY_PUSH_LAG_THRESHOLD_MS: "70000" } });
    assert.equal(ec.ms, 70_000);

    // ⑤ an ILLEGAL value must not silently look like "configured": the source string says so.
    const bad = resolvePushLagThresholdMs({ root, env: { QUAY_PUSH_LAG_THRESHOLD_MS: "-5" } });
    assert.match(bad.source, /IGNORED as invalid/, "an unparseable override is reported, never silently dropped");

    // ⑥ a missing config / missing key ⇒ neutral (the section is optional), never an error.
    const empty = mkdtempSync(join(tmpdir(), "pushlag-ac4-empty-"));
    try {
      assert.equal(readPushLagThresholdFromConfig(empty), null, "no config.yml ⇒ neutral");
      mkdirSync(join(empty, ".quay"), { recursive: true });
      writeFileSync(join(empty, ".quay", "config.yml"), "loop:\n  other: 1\n", { encoding: "utf8" });
      assert.equal(readPushLagThresholdFromConfig(empty), null, "config.yml without the key ⇒ neutral");
    } finally {
      cleanup(empty);
    }
  } finally {
    cleanup(root);
  }
});

test("AC4 (falsifiability): the SAME repository reading flips between within-threshold and lagging when ONLY the threshold changes", () => {
  const w = makeWorld("ac4f");
  try {
    commitAged(w.m, "local work", 30 * 60 * 1000); // 30 min old
    const tight = measure(w.m, { thresholdMs: 10 * 60 * 1000, thresholdSource: "test:tight" });
    const loose = measure(w.m, { thresholdMs: 6 * HOUR_MS, thresholdSource: "test:loose" });
    assert.equal(tight.verdict, "lagging", "30min lead vs a 10min threshold ⇒ lagging");
    assert.equal(loose.verdict, "within-threshold", "30min lead vs a 6h threshold ⇒ within-threshold");
    // Identical readings except the threshold ⇒ the verdict is produced BY the threshold, and the
    // detector is neither stuck-on nor stuck-off (a structurally-cannot-go-red measurement would give
    // the same verdict in both directions).
    assert.equal(tight.ahead, loose.ahead);
    assert.equal(tight.oldestAheadSha, loose.oldestAheadSha);
    // lagMs is clock-derived, so the two reads differ by the ms elapsed between them — a tolerance,
    // not an exact equality (an exact one would be an observation race).
    assert.ok(Math.abs(tight.lagMs - loose.lagMs) < 2_000, "the lag duration reading is the same quantity on both runs");
  } finally {
    cleanup(w.root);
  }
});

// ── AC5: 重试路径 —— 重新 fetch 后可 ff ⇒ 机械重试真的把 develop 推上去 ─────────────────────────

test("AC5: a lag made fast-forward-able by a re-fetch is really pushed to origin/develop by the mechanical retry", () => {
  const w = makeWorld("ac5");
  try {
    const peer = clonePeer(w);
    commitAged(w.m, "local work 1", 2 * HOUR_MS);
    commitAged(w.m, "local work 2", 2 * HOUR_MS);

    // The peer pushes a commit, the machine FETCHES it (so its remote-tracking ref advances) …
    commitNow(peer, "peer transient commit");
    assert.equal(git(peer, "push", "-q", "origin", "develop").status, 0, "peer pushes");
    assert.equal(git(w.m, "fetch", "-q", "origin", "develop").status, 0, "machine fetches the peer commit");
    // … and then origin/develop moves BACK to the base (the peer's transient commit is abandoned
    // upstream). The machine's refs/remotes/origin/develop is now STALE-AHEAD: it points at a commit
    // origin no longer serves. Measured naively this reads as a true non-fast-forward — pushing would
    // look impossible. This is the "短暂 non-fast-forward，重新 fetch 后可 ff" shape.
    const base = git(w.m, "rev-parse", "origin/develop~1").stdout.trim();
    assert.equal(git(peer, "push", "-q", "--force", "origin", `${base}:refs/heads/develop`).status, 0, "origin moves back to base");
    assert.equal(git(w.m, "rev-parse", "origin/develop").stdout.trim() !== base, true, "machine's ref is stale (still at the peer commit)");

    const stale = measure(w.m);
    assert.equal(stale.behind, 1, "against the STALE ref the machine looks 1 behind (the abandoned peer commit)");
    assert.equal(stale.diverged, true, "…i.e. it naively reads as a divergence");
    assert.equal(stale.verdict, "lagging", "and the lead is old enough to be reported");

    // The real run: measure → fetch → push. The push must land.
    const th = thresholdFor(w.m);
    const out = runPushLagCheck({ root: w.m, branch: "develop", remote: "origin", thresholdMs: th.ms, thresholdSource: th.source });
    assert.equal(out.retry, "pushed", `retry verdict (got ${out.retry}, reason=${out.reason})`);
    assert.equal(out.verdict, "pushed");
    assert.equal(revCount(w.m, "origin/develop", "develop"), 0, "origin/develop..develop is 0 — the retry really pushed");
    assert.equal(git(w.m, "rev-parse", "origin/develop").stdout.trim(), git(w.m, "rev-parse", "develop").stdout.trim());
    // The push is real on the REMOTE side too, not just a ref bookkeeping change locally.
    const remoteTip = git(w.m, "ls-remote", "origin", "refs/heads/develop").stdout.trim().split(/\s+/)[0];
    assert.equal(remoteTip, git(w.m, "rev-parse", "develop").stdout.trim(), "the bare origin really holds the new tip");

    // The event carrier records the resolution, with both the before and after readings.
    const events = readJsonl(join(w.m, PUSH_LAG_EVENT_REL));
    assert.equal(events.length, 1, "one lag event recorded");
    assert.equal(events[0].verdict, "pushed");
    assert.equal(events[0].retry, "pushed");
    assert.equal(events[0].ahead, 2);
    assert.equal(events[0].afterRetry.ahead, 0);

    // …and the escalation was NOT touched: a mechanically-resolvable lag must not be handed off.
    assert.equal(existsSync(join(w.m, DOC_DEVELOP_SYNC_LEDGER)), false, "no escalation ledger written for a resolved lag");
  } finally {
    cleanup(w.root);
  }
});

// ── AC6: 升级路径 —— 真 non-fast-forward ⇒ 移交既有语义同步兜底 ────────────────────────────────

test("AC6: a TRUE non-fast-forward is recognised as retry-unsolvable and hands off to the existing semantic-sync mechanism", () => {
  const w = makeWorld("ac6");
  try {
    const peer = clonePeer(w);
    commitAged(w.m, "local work 1", 2 * HOUR_MS);
    commitAged(w.m, "local work 2", 2 * HOUR_MS);

    // The peer pushes a GENUINELY divergent commit and origin stays there — no amount of re-fetching
    // can make this a fast-forward (both sides hold commits the other lacks).
    commitNow(peer, "peer divergent commit");
    assert.equal(git(peer, "push", "-q", "origin", "develop").status, 0, "peer pushes a divergent commit");

    const th = thresholdFor(w.m);
    const before = measurePushLag({ root: w.m, branch: "develop", remote: "origin", thresholdMs: th.ms, thresholdSource: th.source });
    assert.equal(before.verdict, "lagging");

    const out = runPushLagCheck({ root: w.m, branch: "develop", remote: "origin", thresholdMs: th.ms, thresholdSource: th.source });
    assert.equal(out.retry, "non-ff-escalate", `retry must classify this as unsolvable (got ${out.retry}, reason=${out.reason})`);
    assert.equal(out.verdict, "escalated", "the outcome is `escalated`, distinct from `pushed` and from `lagging`");

    // The hand-off is REAL: the existing mechanism's own ledger got the entry (its writer is
    // driver-filters.writeDocDevelopSyncEvent — the same one the author↔develop sync uses). That
    // ledger is the "同步待办" entry of gap-doc-develop-sync-semantic-conflict-resolution; the merge
    // strategy itself is NOT reimplemented here.
    const ledger = readJsonl(join(w.m, DOC_DEVELOP_SYNC_LEDGER));
    assert.ok(ledger.length >= 1, "the escalation ledger exists and has a record");
    const esc = ledger.filter((e) => e.event === "push-lag-non-ff-escalate");
    assert.equal(esc.length, 1, "exactly one escalate record");
    assert.equal(esc[0].branch, "develop");
    assert.equal(esc[0].remote, "origin");
    assert.equal(esc[0].ahead, 2);
    assert.equal(esc[0].behind, 1, "the divergence is carried into the hand-off (the reader needs both counts)");
    assert.equal(typeof esc[0].oldestAheadSha, "string");

    // Nothing was force-pushed or overwritten: local develop and origin/develop are both untouched.
    assert.equal(revCount(w.m, "origin/develop", "develop"), 2, "local develop still leads by 2 (no mutation)");
    assert.equal(revCount(w.m, "develop", "origin/develop"), 1, "origin still holds the peer's commit");

    // The lag carrier records the escalation too (both carriers serve different readers).
    const events = readJsonl(join(w.m, PUSH_LAG_EVENT_REL));
    assert.equal(events.length, 1);
    assert.equal(events[0].verdict, "escalated");
    assert.equal(events[0].escalated.ok, true);
  } finally {
    cleanup(w.root);
  }
});

test("AC6 (negative control): escalateToSemanticSync is not called for an in-sync tree (the hand-off is conditional)", () => {
  const w = makeWorld("ac6neg");
  try {
    const th = thresholdFor(w.m);
    const out = runPushLagCheck({ root: w.m, branch: "develop", remote: "origin", thresholdMs: th.ms, thresholdSource: th.source });
    assert.equal(out.verdict, "in-sync");
    assert.equal(existsSync(join(w.m, DOC_DEVELOP_SYNC_LEDGER)), false, "no escalation written when there is nothing to escalate");
    // And the escalate writer itself is exercised directly, so "it can write" is not merely assumed.
    const direct = escalateToSemanticSync(w.m, {
      branch: "develop", remote: "origin",
      reading: { ...measure(w.m), verdict: "lagging" }, detail: "unit-level control",
    });
    assert.equal(direct.ok, true, `escalate writer failed: ${direct.detail}`);
    assert.equal(readJsonl(join(w.m, DOC_DEVELOP_SYNC_LEDGER)).filter((e) => e.event === "push-lag-non-ff-escalate").length, 1);
  } finally {
    cleanup(w.root);
  }
});

// ── AC7: 挂载点与告警形态（生产载体 = round 记录的 push_lag 字段）────────────────────────────────

test("AC7: the reading reaches the worker-driver's PRODUCTION carrier (the round record), and absence is distinguishable from in-sync", async () => {
  const { computeWorkerRoundRecord, projectPushLag, runPushLagPass } = await import("../scripts/worker-driver.ts");
  const w = makeWorld("ac7");
  try {
    commitAged(w.m, "local work", 2 * HOUR_MS);
    // The pass the resident loop calls every round (step = "push-lag" in runResidentLoop).
    const reading = runPushLagPass(w.m, "develop", "origin", DEFAULT_ROUND_INTERVAL_MS);
    assert.equal(reading.verdict, "pushed", "the pass upsynced the old lead");
    assert.equal(reading.laggingAtMeasure, true, "…and it records that the lead had already exceeded the threshold");
    assert.equal(reading.ahead, 1);
    // The lead had already exceeded the threshold before this pass cleared it ⇒ that IS an incident
    // signal and IS recorded (a young lead would not be — see AC2).
    assert.ok(reading.eventFile, "a lead that exceeded the threshold is recorded even when this pass clears it");

    const base = {
      round: 1, runId: "r", pid: process.pid, at: new Date().toISOString(),
      action: "idle", inFlight: 0, pool: 0, stopReason: null, coldStartInflight: [],
    };
    const withLag = computeWorkerRoundRecord({ ...base, pushLag: reading });
    assert.ok(withLag.push_lag, "the round record carries push_lag under --json=false production argv");
    assert.equal(withLag.push_lag.verdict, "pushed");
    assert.equal(withLag.push_lag.ahead, 1);
    assert.equal(withLag.push_lag.oldestAheadSha, reading.oldestAheadSha);
    assert.equal(withLag.push_lag.lagMs, reading.lagMs);
    assert.equal(withLag.push_lag.thresholdMs, reading.thresholdMs);
    assert.equal(withLag.push_lag.laggingAtMeasure, true);

    // 硬规则 3b/4 推论三: a round that did NOT run the step must be distinguishable from one that ran
    // and found nothing — `null`, never a fabricated `in-sync`.
    const withoutLag = computeWorkerRoundRecord({ ...base, pushLag: null });
    assert.equal(withoutLag.push_lag, null, "“没跑该步” and “跑了且 in-sync” are different values");
    const empty = runPushLagPass(w.m, "develop", "origin", DEFAULT_ROUND_INTERVAL_MS);
    assert.equal(empty.verdict, "in-sync", "after the upsync the next pass reads in-sync");
    const inSyncRound = computeWorkerRoundRecord({ ...base, pushLag: empty });
    assert.equal(inSyncRound.push_lag.verdict, "in-sync");
    assert.notEqual(inSyncRound.push_lag, null, "a real in-sync reading is recorded, not omitted");

    // projectPushLag is the single projection (the loop and this test read the same shape).
    assert.deepEqual(projectPushLag({
      verdict: "x", reading: { ...measure(w.m), verdict: "x" }, laggingAtMeasure: false,
      afterRetry: null, retry: null, eventFile: null, reason: null,
    }).verdict, "x");
  } finally {
    cleanup(w.root);
  }
});

test("AC7: a non-git / branch-less root yields a not-evaluated reading, never a silent null (the pass never throws)", async () => {
  const { runPushLagPass } = await import("../scripts/worker-driver.ts");
  const dir = mkdtempSync(join(tmpdir(), "pushlag-ac7-noeval-"));
  try {
    const reading = runPushLagPass(dir, "develop", "origin", DEFAULT_ROUND_INTERVAL_MS);
    assert.equal(reading.verdict, "not-evaluated", "a root with no git/develop is not “pushed”/“in-sync”");
    assert.equal(reading.ahead, null, "⛔ null, not 0 — “could not read” must not look like “nothing to push”");
    assert.equal(typeof reading.thresholdSource, "string");
  } finally {
    cleanup(dir);
  }
});

// ── not-evaluated: 读不出来 ≠ 同步（硬规则 3b）────────────────────────────────────────────────

test("a root that cannot be evaluated reports not-evaluated (exit 3), never in-sync", () => {
  const dir = mkdtempSync(join(tmpdir(), "pushlag-noeval-"));
  try {
    const th = thresholdFor(dir);
    const r = measurePushLag({ root: dir, branch: "develop", remote: "origin", thresholdMs: th.ms, thresholdSource: th.source });
    assert.equal(r.verdict, "not-evaluated", "a non-git root is not `in-sync`");
    assert.match(r.reason, /not a git repo/);
    const out = runPushLagCheck({ root: dir, branch: "develop", remote: "origin", thresholdMs: th.ms, thresholdSource: th.source });
    assert.equal(out.verdict, "not-evaluated");
    assert.equal(out.retry, null, "no retry attempted on an unreadable root");
    const cli = runCli(["--root", dir, "--json"]);
    assert.equal(cli.status, 3, `not-evaluated ⇒ exit 3 (got ${cli.status})`);
    assert.equal(JSON.parse(cli.stdout).verdict, "not-evaluated");

    // A git repo whose branch does not exist is ALSO not-evaluated (⛔ a missing object must not read
    // as "nothing to do" — 硬规则 3: a boolean existence check hides "the object is gone").
    const w = makeWorld("noeval-branch");
    try {
      const nb = runCli(["--root", w.m, "--branch", "does-not-exist", "--json"]);
      assert.equal(nb.status, 3);
      assert.equal(JSON.parse(nb.stdout).verdict, "not-evaluated");
      const nag = runCli(["--root", w.m, "--remote", "nope", "--json"]);
      assert.equal(nag.status, 3, "an unknown remote is not-evaluated, not in-sync");
    } finally {
      cleanup(w.root);
    }
  } finally {
    cleanup(dir);
  }
});

// ── CLI 用法面 ─────────────────────────────────────────────────────────────────────────────────

test("CLI: --help exits 0 without touching git, and an unknown argument exits 2", () => {
  const h = runCli(["--help"]);
  assert.equal(h.status, 0, "--help ⇒ 0");
  assert.match(h.stdout, /用法/);
  const bad = runCli(["--nope"]);
  assert.equal(bad.status, 2, "unknown argument ⇒ 2");
  assert.match(bad.stderr, /unknown argument/);
  const badVal = runCli(["--round-interval-ms", "0"]);
  assert.equal(badVal.status, 2, "a non-positive round interval ⇒ 2");
});

test("the push is delegated to the existing never-force primitive, and an unresolvable one is `unavailable` (⛔ not `ok`)", async () => {
  const { pushOnce } = await import("../scripts/fan-in-push-lag-check.ts");
  const w = makeWorld("pushonce");
  try {
    commitNow(w.m, "local work");
    // A real push through the resolved primitive: it must name the sibling script (⛔ not an inline
    // `git push` — that would be a second implementation of the never-force discipline).
    const r = pushOnce(w.m, { branch: "develop", remote: "origin" });
    assert.equal(r.verdict, "ok", `delegated push failed: ${r.detail}`);
    assert.match(String(r.script), /periodic-push-backup\.sh$/, "the push primitive is the existing script");
    assert.equal(revCount(w.m, "origin/develop", "develop"), 0, "the push really landed");

    // A missing primitive must NOT read as success (硬规则 3b) — it is a distinct `unavailable`.
    const missing = pushOnce(w.m, { branch: "develop", remote: "origin", pushScript: join(w.root, "no-such-push.sh") });
    assert.equal(missing.verdict, "unavailable", "an unresolvable push primitive is not `ok`");
    assert.match(missing.detail, /not resolvable|exit/, "…and it says why");
  } finally {
    cleanup(w.root);
  }
});

test("oldestAheadCommit picks the OLDEST by committer date, not the first or last listed", () => {
  const commits = [
    { sha: "bbb", epochMs: 2000 },
    { sha: "aaa", epochMs: 1000 },
    { sha: "ccc", epochMs: 3000 },
  ];
  assert.equal(oldestAheadCommit(commits).sha, "aaa");
  assert.equal(oldestAheadCommit([]), null, "an empty set has no oldest (⛔ not a fabricated entry)");
});
