// @test-group engine
// land-capacity-monitor.test.mjs — AC149-2 land 速率产能监测的单元 + 端到端测试
// (plugin/scripts/land-capacity-monitor.ts, gap-ac149-session-retirement-no-dual-source-no-throughput-collapse).
//
// Criterion (manager-phase-goal.md ### AC149):
//   AC149-2（产能不塌，⛔ 真判据不是仪式）: 停会话后连续 ≥24h，任务持续 land（develop 上有新的
//   fan-in 合并提交），且速率不低于停机前同长度窗口的 X%。取假：停机后 land 速率归零或断崖 ⇒ 假。
//
// Covered here (the only hard signal is 归零 — a numeric X% is deliberately NOT hardcoded, 硬规则④推论一):
//   - ratePerHour: commits / hours.
//   - compareWindows: pre>0 & post=0 ⇒ collapse=true (归零 ⇒ 回滚).
//   - compareWindows: pre>0 & post>0 ⇒ collapse=false, ratio = post/pre (a cliff is reported, not hardcoded).
//   - compareWindows: pre=0 ⇒ ratio=null, collapse=false (nothing to compare against).
//   - listCommits: a real fixture repo returns the commits in the requested window.
//
// Run:
//   scripts/test.sh plugin/test/land-capacity-monitor.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ratePerHour, buildReport, compareWindows, listCommits, runMonitor } from "../scripts/land-capacity-monitor.ts";

// ── ratePerHour ─────────────────────────────────────────────────────────────────────────────────────
test("ratePerHour divides commits by hours", () => {
  assert.equal(ratePerHour(5, 24), 5 / 24);
  assert.equal(ratePerHour(0, 24), 0);
  assert.equal(ratePerHour(3, 0), 0, "zero hours must not divide by zero");
});

test("buildReport aggregates a commit list into a WindowReport", () => {
  const commits = [{ hash: "a", subject: "x", date: "t" }, { hash: "b", subject: "y", date: "t" }];
  const r = buildReport(commits, 24);
  assert.equal(r.commits, 2);
  assert.equal(r.hours, 24);
  assert.equal(r.ratePerHour, 2 / 24);
});

// ── compareWindows: the only hard signal is 归零 (collapse) ────────────────────────────────────────
test("compareWindows: post=0 while pre>0 ⇒ collapse (归零 ⇒ 回滚)", () => {
  const r = compareWindows({ commits: 5, hours: 24, ratePerHour: 5 / 24 }, { commits: 0, hours: 24, ratePerHour: 0 });
  assert.equal(r.collapse, true);
  assert.equal(r.ratio, 0);
});

test("compareWindows: a non-zero drop is a ratio, NOT a hardcoded collapse", () => {
  const r = compareWindows({ commits: 5, hours: 24, ratePerHour: 5 / 24 }, { commits: 2, hours: 24, ratePerHour: 2 / 24 });
  assert.equal(r.collapse, false);
  assert.ok(Math.abs(r.ratio - 2 / 5) < 1e-12, `ratio should be 2/5, got ${r.ratio}`);
});

test("compareWindows: pre=0 ⇒ ratio null, no collapse (nothing to compare against)", () => {
  const r = compareWindows({ commits: 0, hours: 24, ratePerHour: 0 }, { commits: 3, hours: 24, ratePerHour: 3 / 24 });
  assert.equal(r.collapse, false);
  assert.equal(r.ratio, null);
});

// ── listCommits: a real fixture repo returns the in-window commits ─────────────────────────────────
test("listCommits: reads git log on develop for the requested window", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lcm-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "develop", tmp]);
    execFileSync("git", ["-C", tmp, "config", "user.email", "t@example.com"]);
    execFileSync("git", ["-C", tmp, "config", "user.name", "t"]);
    // two commits, each at a distinct author time (no-op edits via --allow-empty).
    execFileSync("git", ["-C", tmp, "commit", "-q", "--allow-empty", "-m", "one"]);
    execFileSync("git", ["-C", tmp, "commit", "-q", "--allow-empty", "-m", "two"]);

    const since = new Date(Date.now() - 3600_000).toISOString();
    const until = new Date(Date.now() + 3600_000).toISOString();
    const commits = listCommits(tmp, since, until, "develop");
    assert.equal(commits.length, 2, `expected both fixture commits in the window, got ${commits.length}`);
    assert.ok(commits.every((c) => c.hash && c.subject && c.date), "each commit must carry hash+subject+date");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("runMonitor: collapse=true when the post window has zero land and pre is non-zero", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lcm2-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "develop", tmp]);
    execFileSync("git", ["-C", tmp, "config", "user.email", "t@example.com"]);
    execFileSync("git", ["-C", tmp, "config", "user.name", "t"]);
    // Commit dated clearly in the PAST (6h ago — dynamically computed, not a hardcoded calendar date
    // that rots) so it is unambiguously inside the 24h pre window [now-24h, now]; a commit dated
    // "now" (second precision) would land exactly on the before-boundary and leak into the post window.
    const past = new Date(Date.now() - 6 * 3600_000).toISOString();
    execFileSync("git", ["-C", tmp, "commit", "-q", "--allow-empty", "-m", "pre-stop land"], {
      env: { ...process.env, GIT_AUTHOR_DATE: past, GIT_COMMITTER_DATE: past },
    });

    // stop boundary = now; the single commit is in the pre window ⇒ pre>0, post=0 ⇒ collapse.
    const result = runMonitor(tmp, new Date(Date.now()).toISOString(), 24);
    assert.equal(result.collapse, true, "post-stop zero land with pre-stop land must collapse");
    assert.ok(result.pre.commits >= 1, "the pre window must contain the fixture commit");
    assert.equal(result.post.commits, 0, "the post window must be empty (commit is pre-boundary)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
