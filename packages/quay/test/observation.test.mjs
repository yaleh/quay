// @test-group product
// gap-git-history-counts-stale-branches — readGitHistory must count only ACTIVE local branches as
// chart lanes. The old `git log --branches --source` counted every local branch, so a merged-but-
// never-deleted leftover branch (a fan-in source left dangling) kept polluting the lane count long
// after it was dead. The fix enumerates branch tips + their commit time and traverses only the
// branches with a commit inside GIT_HISTORY_ACTIVE_WINDOW_SEC; the stale branch's commits are
// already reachable from the mainline, so they are relabeled (not dropped).
//
// /git-history is a user-visible web contract ⇒ `product` group. New file ⇒ node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { readGitHistory, parseVerificationRound, readLive, taskWorktreeOpen, readJournal } from "../src/observation.ts";

/** Commit helper with a fixed clock (committer date = author date = `t`), per-branch file. */
function commitAt(ws, msg, t, file = "log.txt") {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: new Date(t * 1000).toISOString(),
    GIT_COMMITTER_DATE: new Date(t * 1000).toISOString(),
  };
  fs.appendFileSync(path.join(ws, file), `${msg}\n`);
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: ws, env });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg], { cwd: ws, env });
}

test("readGitHistory excludes a merged-but-stale branch from the lanes (negative control)", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "obs-gh-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: ws });
    fs.writeFileSync(path.join(ws, "README.md"), "fixture\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: ws });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: ws });

    const nowSec = Math.floor(Date.now() / 1000);
    // The exact pollution shape the finding names: a fan-in leftover whose work was merged into the
    // mainline but whose branch ref was never deleted — tip is 30 days old (stale).
    execFileSync("git", ["checkout", "-q", "-b", "verify/stale"], { cwd: ws });
    commitAt(ws, "stale work", nowSec - 30 * 86400, "stale.txt");
    execFileSync("git", ["checkout", "-q", "master"], { cwd: ws });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "merge", "-q", "--no-ff", "verify/stale", "-m", "merge verify/stale"], { cwd: ws });
    commitAt(ws, "main recent", nowSec - 60);

    const hist = readGitHistory(ws);
    assert.equal(hist.status, "ok");
    const refs = new Set(hist.commits.map((c) => c.ref));
    assert.ok(!refs.has("verify/stale"), `stale branch must not be a lane (lanes: ${[...refs].join(", ")})`);
    assert.ok(refs.has("master"), "the active mainline branch is still a lane");
    assert.ok(hist.commits.some((c) => c.subject === "stale work"), "the stale branch's merged commit is still shown (relabeled to the mainline, not dropped)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("readGitHistory degrades to 「无活跃分支」 when every branch is stale and there is no mainline", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "obs-gh-old-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: ws });
    fs.writeFileSync(path.join(ws, "README.md"), "fixture\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: ws });
    // The ONLY commit is 30 days old → no branch has a commit in the active window.
    const oldSec = Math.floor(Date.now() / 1000) - 30 * 86400;
    const env = {
      ...process.env,
      GIT_AUTHOR_DATE: new Date(oldSec * 1000).toISOString(),
      GIT_COMMITTER_DATE: new Date(oldSec * 1000).toISOString(),
    };
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "old"], { cwd: ws, env });
    // Rename away from the mainline: a stale non-mainline-only repo must still degrade (the
    // mainline refs develop/master are ALWAYS kept, so "every branch stale" only fires without one).
    execFileSync("git", ["branch", "-m", "verify/stale"], { cwd: ws });

    const hist = readGitHistory(ws);
    assert.equal(hist.status, "empty");
    assert.match(hist.reason || "", /无活跃分支/, "reason says no active branch, not 「无提交记录」");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("readGitHistory always keeps master (and develop) even when their tip is >24h stale", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "obs-gh-mainline-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: ws });
    fs.writeFileSync(path.join(ws, "README.md"), "fixture\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: ws });
    // master's ONLY commit is 30 days old — far outside the 7-day active window, but a mainline
    // lane must never drop out (gap-git-history-clickable-branches-window: the 24h window used to
    // exclude master entirely).
    const oldSec = Math.floor(Date.now() / 1000) - 30 * 86400;
    const env = {
      ...process.env,
      GIT_AUTHOR_DATE: new Date(oldSec * 1000).toISOString(),
      GIT_COMMITTER_DATE: new Date(oldSec * 1000).toISOString(),
    };
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "old"], { cwd: ws, env });

    const hist = readGitHistory(ws);
    assert.equal(hist.status, "ok");
    const refs = new Set(hist.commits.map((c) => c.ref));
    assert.ok(refs.has("master"), `stale master is still a lane (lanes: ${[...refs].join(", ")})`);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC127: parseVerificationRound extracts the bucket-execution fields (buckets/bucket_files/bucket_duration_ms) and tolerates their absence on legacy rows (never a fabricated \"full\")", () => {
  // gap-ac127-suite-bucket-web-tests-page-visible — AC126 landed these three fields on bucket-mode
  // rounds (full-suite-runner.ts:4027-4029); the /tests reader must surface `buckets` and tolerate
  // legacy rows that carry none of them (absence → undefined, NOT a fabricated "full").
  const bucketRow = parseVerificationRound(JSON.stringify({
    round: 240, startedAt: "2026-08-22T00:00:00.000Z", durationMs: 366000,
    state: "green", pass: 500, fail: 0, cancelled: 0, tests: 500, reason: null,
    commit: "37b8afcf9d09a5e5f5f5f5f5f5f5f5f5f5f5f5f", scope: "bucket", runner: "outer",
    buckets: "M", bucket_files: 12, bucket_duration_ms: 366000,
  }));
  assert.equal(bucketRow.buckets, "M", "buckets label renders");
  assert.equal(bucketRow.bucket_files, 12, "bucket_files renders the selected test-file count");
  assert.equal(bucketRow.bucket_duration_ms, 366000, "bucket_duration_ms renders the round's own durationMs");

  // Legacy row (no bucket fields — the default full suite / pre-fix shape) ⇒ undefined, never "full".
  const legacy = parseVerificationRound(JSON.stringify({
    round: 228, startedAt: "2026-08-17T04:30:00.000Z", durationMs: 936519,
    state: "green", runner: "outer", scope: "worktree",
    commit: "426b21ceaabbe7502334d92d79ce4a4a8d935fe9",
  }));
  assert.equal(legacy.buckets, undefined, "a legacy row has no buckets field (absent-field contract)");
  assert.equal(legacy.bucket_files, undefined, "a legacy row has no bucket_files field");
  assert.equal(legacy.bucket_duration_ms, undefined, "a legacy row has no bucket_duration_ms field");
});

test("gap-test-detail-perfile-duration-failed: parseVerificationRound extracts perFile ({file,durationMs,passed}) and tolerates its absence on legacy rows", () => {
  // full-suite-runner lands `perFile` on the round record (reusing measure-suite-reporter's
  // __PERFILE__ stream); the /tests reader must surface it and tolerate legacy rows that carry none.
  const withPerFile = parseVerificationRound(JSON.stringify({
    round: 241, startedAt: "2026-08-23T00:00:00.000Z", durationMs: 500000,
    state: "red", pass: 1, fail: 1, cancelled: 0, tests: 2, reason: "failed",
    runner: "outer", scope: "worktree",
    perFile: [
      { file: "packages/quay/test/slow.test.mjs", durationMs: 210.5, passed: false },
      { file: "packages/quay/test/fast.test.mjs", durationMs: 12.25, passed: true },
    ],
  }));
  assert.ok(Array.isArray(withPerFile.perFile), "perFile is an array");
  assert.equal(withPerFile.perFile.length, 2, "both entries parsed");
  assert.deepEqual(withPerFile.perFile[0], { file: "packages/quay/test/slow.test.mjs", durationMs: 210.5, passed: false }, "failed entry (file/durationMs/passed) preserved");
  assert.deepEqual(withPerFile.perFile[1], { file: "packages/quay/test/fast.test.mjs", durationMs: 12.25, passed: true }, "passed entry preserved");

  // Legacy row (no perFile field) ⇒ undefined, never a fabricated [].
  const legacy = parseVerificationRound(JSON.stringify({
    round: 228, startedAt: "2026-08-17T04:30:00.000Z", durationMs: 936519,
    state: "green", runner: "outer", scope: "worktree",
    commit: "426b21ceaabbe7502334d92d79ce4a4a8d935fe9",
  }));
  assert.equal(legacy.perFile, undefined, "a legacy row has no perFile field (absent-field contract)");
});

test("gap-test-detail-timeline: parseVerificationRound extracts perFile timestamps ({endedAtMs,startedAtMs}) and tolerates their absence (legacy perFile entries)", () => {
  // full-suite-runner now lands perFile entries carrying endedAtMs (reporter test:complete time) and
  // startedAtMs (back-computed end − duration). The /tests reader must surface them AND keep the
  // absent-field contract: a legacy perFile entry without timestamps omits both (never a fabricated 0).
  const withTimes = parseVerificationRound(JSON.stringify({
    round: 242, startedAt: "2026-08-23T01:00:00.000Z", durationMs: 500000,
    state: "green", pass: 2, fail: 0, cancelled: 0, tests: 2,
    runner: "outer", scope: "worktree",
    perFile: [
      { file: "packages/quay/test/slow.test.mjs", durationMs: 210.5, passed: true, endedAtMs: 1724374800000, startedAtMs: 1724374800000 - 210.5 },
      { file: "packages/quay/test/fast.test.mjs", durationMs: 12.25, passed: true },
    ],
  }));
  assert.ok(Array.isArray(withTimes.perFile), "perFile is an array");
  assert.equal(withTimes.perFile[0].endedAtMs, 1724374800000, "endedAtMs extracted");
  assert.equal(withTimes.perFile[0].startedAtMs, 1724374800000 - 210.5, "startedAtMs extracted");
  // Legacy perFile entry (no timestamps) ⇒ both fields absent, never a fabricated 0.
  assert.equal(withTimes.perFile[1].endedAtMs, undefined, "legacy entry omits endedAtMs");
  assert.equal(withTimes.perFile[1].startedAtMs, undefined, "legacy entry omits startedAtMs");
});

// ── gap-live-ghost-inflight-paused-event ─────────────────────────────────────────────────────────
// readLive cross-validates the event-stream in-flight pairing (start without end) against worktree
// existence. The fast-mode worktree namespace is `<parent-of-main>/quay-worktrees` — so each fixture
// nests the workspace under a private `parent/` so `dirname(root)/quay-worktrees` is test-private and
// never touches the shared /tmp/quay-worktrees (which other suites must be able to assume is absent).
// A start-no-end run whose worktree was RELEASED (complete / crash / operational-pause, no end event)
// is a ghost and must be removed; the removal must be fail-closed (an unobservable namespace keeps the
// run — never a positive "released" from a source that could not be observed).

/** Build a nested workspace whose `dirname(root)/quay-worktrees` is test-private. */
function ghostWorkspace(prefix) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const root = path.join(parent, "main");
  fs.mkdirSync(root, { recursive: true });
  const namespace = path.join(parent, "quay-worktrees");
  return { parent, root, namespace };
}

/** Write a single Fast start event (no end) for `taskId` into root's .workflow-events/. */
function writeStartEvent(root, taskId, startedAtMs) {
  const eventsDir = path.join(root, ".workflow-events");
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(
    path.join(eventsDir, `fm-${taskId}.jsonl`),
    JSON.stringify({ stage: "Fast", runId: `fm-${taskId}-1`, taskId, eventKind: "start", timing: { queuedAtMs: null, startedAtMs, endedAtMs: null } }) + "\n"
  );
}

test("AC1: readLive removes a released-worktree ghost (start-no-end + worktree absent in an observable namespace)", () => {
  const { parent, root, namespace } = ghostWorkspace("ghost-released");
  try {
    fs.mkdirSync(namespace, { recursive: true }); // worktree isolation IS in play…
    writeStartEvent(root, "GHOST-1", Date.now() - 3600_000); // …but GHOST-1's slot was released.
    assert.equal(taskWorktreeOpen(root, "GHOST-1"), false,
      "AC1: an observable namespace without the task's worktree is a positive 'released' reading");
    const live = readLive(root, { nowMs: Date.now() });
    assert.ok(!live.inFlight.some((t) => t.taskId === "GHOST-1"),
      "AC1: the released-worktree ghost is removed from readLive inFlight (not shown as 实现中)");
    assert.equal(live.concurrency, 0, "AC1: the ghost does not inflate the in-flight concurrency count");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("AC1 negative control: a start-no-end run WITH its worktree present stays in-flight (the filter is real, not vacuous)", () => {
  const { parent, root, namespace } = ghostWorkspace("ghost-kept");
  try {
    fs.mkdirSync(namespace, { recursive: true });
    fs.mkdirSync(path.join(namespace, "KEEP-1"), { recursive: true }); // the slot is occupied
    writeStartEvent(root, "KEEP-1", Date.now() - 60_000);
    assert.equal(taskWorktreeOpen(root, "KEEP-1"), true, "AC1: a present worktree is not released");
    const live = readLive(root, { nowMs: Date.now() });
    assert.ok(live.inFlight.some((t) => t.taskId === "KEEP-1"),
      "AC1: an in-flight run whose worktree is present stays in-flight");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("AC1 fail-closed: no worktree namespace ⇒ the run stays in-flight (never a positive 'released' from an unobservable source)", () => {
  const { parent, root } = ghostWorkspace("ghost-nons");
  try {
    writeStartEvent(root, "X-1", Date.now() - 60_000);
    assert.equal(taskWorktreeOpen(root, "X-1"), null,
      "AC1: an absent namespace is 'unknown', distinct from 'released' (hard rule ③b)");
    const live = readLive(root, { nowMs: Date.now() });
    assert.ok(live.inFlight.some((t) => t.taskId === "X-1"),
      "AC1: fail-closed — an unobservable worktree state keeps the run in-flight");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// ── gap-webui-journal-stale-and-ticklog-bug ─────────────────────────────────────────────────────
// readJournal had two defects: (1) escalations.md — superseded by tick-log but still rendered first
// as a fresh 「最近记录」 9 days after its last write; (2) tick-log.md — read by the SAME `## `-
// boundary function as escalations, which found zero `## ` boundaries (the real file is
// `` - `HH:MMZ` `action` `` bullets) and fell through to a raw-tail fallback that mixed days-old
// stale entries with today's, with no date. AC1 = stale annotation; AC2 = dedicated bullet-prefix
// reader (no raw-tail fallback); AC3 = date-stamped entries.

const JOURNAL_NOW = Date.UTC(2026, 7, 23, 12, 0, 0); // 2026-08-23T12:00:00Z

/** Build a temp workspace with an orchestration/ dir; return its root. */
function journalWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  fs.mkdirSync(path.join(ws, "orchestration"), { recursive: true });
  return ws;
}

/** Set a file's atime+mtime to a fixed instant (controls both the stale banner and date anchor). */
function setMtime(abs, ms) {
  const d = new Date(ms);
  fs.utimesSync(abs, d, d);
}

test("AC1: readJournal marks a superseded escalations.md stale, and does NOT mark a fresh one (negative control)", () => {
  const ws = journalWorkspace("journal-stale");
  try {
    const esc = path.join(ws, "orchestration", "escalations.md");
    fs.writeFileSync(esc, "# 升级项\n\n## 3. 测试升级项\n\n这是一条测试升级项。\n");
    setMtime(esc, JOURNAL_NOW - 9 * 86_400_000); // 9 days stale

    const journal = readJournal(ws, JOURNAL_NOW);
    assert.equal(journal.escalations.status, "ok", "AC1: a stale-but-readable escalations.md is still ok");
    assert.match(journal.escalations.markdown || "", /陈旧记录/, "AC1: the stale banner appears");
    assert.match(journal.escalations.markdown || "", /约 9 天前/, "AC1: the banner names the age in days");
    assert.match(journal.escalations.markdown || "", /2026-08-14/, "AC1: the banner names the last-write date");

    // Negative control — a fresh escalations.md carries no banner.
    setMtime(esc, JOURNAL_NOW - 3600_000); // 1 hour ago
    const fresh = readJournal(ws, JOURNAL_NOW);
    assert.equal(fresh.escalations.status, "ok");
    assert.doesNotMatch(fresh.escalations.markdown || "", /陈旧记录/,
      "AC1 negative control: a fresh escalations.md is not marked stale (the banner is real, not vacuous)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC2: readTickLog segments by `- `HH:MMZ`` bullets and drops a days-old entry the raw-tail fallback would have kept", () => {
  const ws = journalWorkspace("journal-bullets");
  try {
    const tlog = path.join(ws, "orchestration", "tick-log.md");
    // 20 entries; entry 1 is the sentinel the old `lines.slice(-60)` fallback would have shown.
    const entries = ["- `00:00Z` `no-action` — STALE-SENTINEL-ENTRY"];
    for (let i = 1; i < 20; i++) {
      const hh = String(Math.floor(i / 4)).padStart(2, "0");
      const mm = String((i * 7) % 60).padStart(2, "0");
      entries.push(`- \`${hh}:${mm}Z\` \`no-action\` — recent entry ${i}`);
    }
    fs.writeFileSync(tlog, entries.join("\n") + "\n");
    setMtime(tlog, JOURNAL_NOW);

    const journal = readJournal(ws, JOURNAL_NOW);
    assert.equal(journal.tickLog.status, "ok", "AC2: a bulleted tick-log is ok");
    assert.doesNotMatch(journal.tickLog.markdown || "", /STALE-SENTINEL-ENTRY/,
      "AC2: the days-old entry is NOT mixed into the recent view (entry-count cap, not a raw line tail)");
    assert.match(journal.tickLog.markdown || "", /recent entry 19/,
      "AC2: the true most-recent entry is present");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC2 negative control: a tick-log with NEITHER bullets nor `## ` sections reports 「无数据」, never a raw tail", () => {
  const ws = journalWorkspace("journal-nofmt");
  try {
    const tlog = path.join(ws, "orchestration", "tick-log.md");
    fs.writeFileSync(tlog, "# tick\n\njust some prose\nno tick entries here\n");
    setMtime(tlog, JOURNAL_NOW);

    const journal = readJournal(ws, JOURNAL_NOW);
    assert.equal(journal.tickLog.status, "empty",
      "AC2: an unrecognized tick-log is 「无数据」 (the dedicated reader has no raw-tail fallback)");
    assert.equal(journal.tickLog.markdown, null, "AC2: no markdown is fabricated from the tail");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC3: readTickLog stamps each entry with its inferred date across a midnight rollover", () => {
  const ws = journalWorkspace("journal-dates");
  try {
    const tlog = path.join(ws, "orchestration", "tick-log.md");
    // Newest last: 23:59Z is the previous day; 00:01Z / 00:15Z are the mtime date.
    fs.writeFileSync(
      tlog,
      "- `23:59Z` `no-action` — 前一天\n" +
      "- `00:01Z` `unblock` — 今天凌晨\n" +
      "- `00:15Z` `no-action` — 今天最新\n"
    );
    setMtime(tlog, Date.UTC(2026, 7, 23, 4, 0, 0)); // 2026-08-23T04:00:00Z

    const journal = readJournal(ws, JOURNAL_NOW);
    const md = journal.tickLog.markdown || "";
    assert.match(md, /`2026-08-23 00:15Z`/, "AC3: newest entry carries its mtime date");
    assert.match(md, /`2026-08-23 00:01Z`/, "AC3: same-day entry carries the same date");
    assert.match(md, /`2026-08-22 23:59Z`/, "AC3: the pre-midnight entry rolls back one day");
    assert.doesNotMatch(md, /- `\d{2}:\d{2}Z` /, "AC3: no entry is left with a bare HH:MMZ (all stamped)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("back-compat: a legacy `## `-sectioned tick-log still reads ok (serve.test.mjs pins this shape)", () => {
  const ws = journalWorkspace("journal-legacy");
  try {
    const tlog = path.join(ws, "orchestration", "tick-log.md");
    fs.writeFileSync(tlog, "# 外层 tick 记录\n\n## 2026-08-03 05:45Z\n\n`correct` — 测试条目。\n");
    setMtime(tlog, JOURNAL_NOW);

    const journal = readJournal(ws, JOURNAL_NOW);
    assert.equal(journal.tickLog.status, "ok", "a `## `-sectioned tick-log is still ok");
    assert.match(journal.tickLog.markdown || "", /2026-08-03 05:45Z/,
      "the `## ` timestamp heading still renders (dual-format back-compat)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
