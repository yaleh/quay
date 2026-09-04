// @test-group engine
// state-worded-clause-check.test.mjs — tasks/gap-ac41-actionize-state-worded-clauses
// (AC4 — the result-state-clause checker's mechanical realization of the ## Contract
// `measure`/`band`).
//
// Coverage map (task ACs):
//   AC3 — the checker's positive control: a 自测绿 result-state clause (the 2026-08-10 incident
//         shape that made two suite-fix subagents behave oppositely) MUST be reported; the
//         actionized form ("run scripts/test.sh in the worktree until verification-round.jsonl
//         carries scope=worktree + state=green") MUST be clean. Both directions asserted here.
//   AC4 — the ## Contract measure IS the checker's count over the three tick-cores; the band is 0.
//         Asserted against the REAL repo: the three tick-cores pass (count 0) via the default mode.
//         (No global counts are hardcoded — every assertion is relative to a fixture or the live
//         repo's actual current state.)
//   AC5 — the checker is wired into scripts/test.sh run_static_checks (a static-tier `change`
//         checker whose object is the three tick-cores); this file uses node:test and declares
//         // @test-group engine.
//
// Run:
//   scripts/test.sh plugin/test/state-worded-clause-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CHECKER = path.join(REPO_ROOT, "plugin/scripts/state-worded-clause-check.ts");

/** Run the checker with args against the REAL repo; returns the spawnSync result. */
function run(...args) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", REPO_ROOT, ...args],
    { encoding: "utf8" },
  );
}

/** Judge one temp fragment (absolute path) with --judge; returns the spawnSync result. */
function judgeFile(absPath) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--judge", absPath, "--json"],
    { encoding: "utf8" },
  );
}

/** Write a temp fragment and judge it; returns { res, dir } for cleanup. */
function tmpFragment(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "state-worded-check-"));
  const f = path.join(dir, "tick-core-fragment.md");
  fs.writeFileSync(f, text);
  return { res: judgeFile(f), dir };
}

test("the three tick-cores pass the default scan (## Contract band 0)", () => {
  const res = run("--json");
  assert.equal(res.status, 0, `checker exited ${res.status}: ${res.stdout} ${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.count, 0, `expected 0 state-worded clauses, got ${out.count}: ${JSON.stringify(out.hits)}`);
  // The scan surface is the three tick-cores — a missing scan doc must fail loudly (the ##
  // Contract invariant: the doc set must stay byte-identical across runs).
  const scanPaths = ["orchestration/manager-tick-core.md", "orchestration/orchestrator-tick-core.md", "orchestration/fast-mode-tick-core.md"];
  for (const p of scanPaths) assert.ok(fs.existsSync(path.join(REPO_ROOT, p)), `scan doc missing: ${p}`);
});

test("AC3 positive control: a 自测绿 result-state clause MUST be reported (the incident shape)", () => {
  const { res, dir } = tmpFragment("integration 切 branch→修→自测绿→fan-in。\n");
  try {
    assert.equal(res.status, 1, `incident shape did not redden the checker: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.count, 1, `expected exactly 1 hit, got ${out.count}`);
    assert.equal(out.hits[0].hit, "自测绿");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 negative control: the actionized form (command + readable product) MUST be clean", () => {
  const { res, dir } = tmpFragment(
    "integration 切 branch→修→在自带 worktree 里跑 `scripts/test.sh` 直到 `verification-round.jsonl` 出现 `scope=worktree` 且 `state=green` 记录→fan-in。\n",
  );
  try {
    assert.equal(res.status, 0, `actionized form reddened the checker: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.count, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 sibling: a 确保 result-state clause MUST also be reported", () => {
  const { res, dir } = tmpFragment("套件启动前先确保 develop 已含全部批量合。\n");
  try {
    assert.equal(res.status, 1, `确保 clause did not redden the checker: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.count, 1);
    assert.equal(out.hits[0].hit, "确保");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4: the ## Contract measure regex is per-LINE — an unrelated later 绿 is not swept in", () => {
  // 直到.*绿 must resolve within the SAME line; an unrelated 「未绿退出」 in a later sentence of the
  // same table cell must NOT be dragged into a hit by a leading 直到 (the orchestrator:35 shape that
  // made the bare measure show 1 after the 自测绿 fix until 未绿退出 was actionized too).
  const { res, dir } = tmpFragment(
    "在自带 worktree 里跑 `scripts/test.sh` 直到 `verification-round.jsonl` 出现 `scope=worktree` 且 `state=green` 记录→fan-in。\n" +
      "未绿退出 ⇒ `.halt`+outer 停下其它事处理。\n",
  );
  try {
    assert.equal(res.status, 0, `per-line scoping failed: ${res.stdout} ${res.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 regression (manager 2026-08-10): the A15 ④ table-cell shape — actionized clause + a LATER Chinese 绿 in the SAME line — must be clean", () => {
  // The real orchestrator:37 shape: one physical line (one markdown table cell) carries BOTH the
  // actionized clause ("跑 `scripts/test.sh` 直到 `verification-round.jsonl` 出现 `scope=worktree`
  // 且 `state=green`") AND a later unrelated clause containing Chinese 绿 ("无论绿退还是未绿退").
  // `state=green` is latin — the only Chinese 绿 on the line comes from the later clause, so a raw
  // `直到.*绿` sweep false-positives the ACTIONIZED clause (which AC41 判据① demands pass: command +
  // readable artifact). The exemption must keep this clean while the bare 自测绿 control above still
  // reddens (negative control intact).
  const { res, dir } = tmpFragment(
    "| A15 | 在自带 worktree 里跑 `scripts/test.sh` 直到 `verification-round.jsonl` 出现 `scope=worktree` 且 `state=green` 记录→(a)branch 合回 integration(fan-in)→(b)批量合;subagent 终止（无论绿退还是未绿退）⇒ `git worktree remove` 清理其 worktree |\n",
  );
  try {
    assert.equal(res.status, 0, `actionized A15 ④ shape reddened the checker: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.count, 0, `expected 0 hits, got ${out.count}: ${JSON.stringify(out.hits)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 companion: the SAME actionized clause WITHOUT the trailing Chinese 绿 must STILL flag its hard words — the exemption is 直到.*绿-only, not a blanket pardon", () => {
  // An actionized line that ALSO carries a hard result-state word (自测绿) must still be reported —
  // the exemption suppresses ONLY the 直到.*绿 alternative, never 自测绿/确保/保证.
  const { res, dir } = tmpFragment(
    "| A15 | 在自带 worktree 里跑 `scripts/test.sh` 自测绿 直到 `verification-round.jsonl` 出现 `scope=worktree` 且 `state=green` 记录→fan-in |\n",
  );
  try {
    assert.equal(res.status, 1, `hard word on actionized line was pardoned: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.hits[0].hit, "自测绿");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
