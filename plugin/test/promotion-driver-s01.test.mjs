// @test-group engine
// promotion-driver.test.mjs — AC130 + AC131 + AC132 + AC134 (tasks/gap-ac130-promotion-driver-resident-loop,
// tasks/gap-ac131-promotion-mechanical-no-llm, tasks/gap-ac132-fix-worker-structured-input,
// tasks/gap-ac134-promotion-outcome-ledger): the resident
// promotion driver loops forever, calling ready-pool-check for the FULL-pool determination (never a
// single --targeted task) each round, does not exit after one round, and enters the next round after
// --interval. AC2 is the FALSIFIABLE half: stop the driver ⇒ a newly-eligible todo in the pool is NOT
// promoted — proving promotion is driven by the driver, not some outer tick.
// AC131 (falsifiable): a qualified todo (four artifacts complete + empty deps) is promoted to ready
// within one round via the mechanical A22 --apply path, with ZERO LLM — the round's outcome record
// carries promote_path_llm_invoked=false (derived from the spawned argv, not hardcoded).
// AC132 (falsifiable): an ineligible todo spawns a short-lived `claude -p` fix worker whose input is
// the task id + the gate's STRUCTURED missing list (A24 三可修/五不可修), never a prose directive.
// AC2: a DoD<40 todo ⇒ the fix worker's prompt carries the structured identifier (fourArtifacts=false
// missing=[dod]); a prompt with only the task id and no missing list would falsify it.
// AC134 (falsifiable): every determination/promotion/fix writes one structured outcome record to
// .quay/promotion-outcome.jsonl (gitignored) with task_id · gate(eligible + missing) · action
// (promote/fix/skip) · result · ts. AC2: the carrier holds REAL records from the real ready-pool-check
// against real task files (not fixture/injected output) — ≥ N records after the driver runs.
//
// The ready-pool-check command is injectable (--ready-pool-cmd) so the pure/loop tests never touch the
// real checker; the AC2 test drives the REAL ready-pool-check --apply against a temp workspace to prove
// the promotion lands on disk while the driver lives and does not after it is SIGTERM'd. The fix-worker
// command is injectable (--fix-worker-cmd) with the structured prompt appended as the last arg, so the
// AC132 AC2 test captures the prompt the worker actually received without spawning a real claude.
//
// Run: scripts/test.sh plugin/test/promotion-driver.test.mjs

// SPLIT from promotion-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/8 (6 tests). Shared fixtures: ./helpers/promotion-driver-harness.mjs (single source).

import { test } from "node:test";
import { CAP_DEFAULT, INTERVAL_MS_DEFAULT, assert, computeRoundRecord, defaultPromotionCheckArgv, fs, os, parseIntervalMs, path, resolveCap, runPromotionRound } from "./helpers/promotion-driver-harness.mjs";

test("defaultPromotionCheckArgv — full-pool --apply (never --targeted) + --cap + --json", () => {
  const argv = defaultPromotionCheckArgv("/r", 5);
  assert.equal(argv[0], "node");
  // gap-promotion-driver-ready-pool-check-path-third-party：脚本锚在本 kernel 安装位置（dev tree =
  // 本仓库 plugin/scripts/ready-pool-check.ts，带 --experimental-strip-types），⛔ 非 /r/plugin/scripts/。
  assert.equal(argv[1], "--experimental-strip-types");
  assert.ok(argv[2].endsWith(`${path.sep}plugin${path.sep}scripts${path.sep}ready-pool-check.ts`), `argv[2] 是 kernel 侧 .ts：${argv[2]}`);
  assert.ok(!argv[2].startsWith("/r/"), `argv[2] ⛔ 不锚在 task root：${argv[2]}`);
  assert.ok(argv.includes("--apply"), "AC130: the resident round applies promotions (A22 heartbeat path)");
  assert.ok(argv.includes("--json"));
  assert.deepEqual(argv.slice(argv.indexOf("--root"), argv.indexOf("--root") + 2), ["--root", "/r"]);
  assert.deepEqual(argv.slice(argv.indexOf("--cap"), argv.indexOf("--cap") + 2), ["--cap", "5"]);
  assert.ok(!argv.includes("--targeted"), "AC130: full-pool determination, NOT a single --targeted task");
});

// gap-promotion-driver-ready-pool-check-path-third-party AC2 负控制：第三方项目（quay-init 布下的面）
// 无 plugin/scripts/*.ts，只有 shipped dist/*.js。resolveKernelSibling 须回退到 dist/*.js 且不带
// --experimental-strip-types（stripTypes=false），⛔ 不得拼出 root/plugin/scripts/ready-pool-check.ts。

test("defaultPromotionCheckArgv — 无 plugin/ 的第三方项目解析到 shipped dist/ready-pool-check.js（stripTypes=false）", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "promotion-third-party-"));
  try {
    const dist = path.join(root, "scripts", "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, "ready-pool-check.js"), "// bundled\n", "utf8");
    const saved = process.env.QUAY_PLUGIN_ROOT;
    process.env.QUAY_PLUGIN_ROOT = root; // resolveKernelScriptsDir() = <root>/scripts，<root>/scripts/*.ts 不存在
    try {
      const argv = defaultPromotionCheckArgv("/task-root", 5);
      assert.equal(argv[0], "node");
      // ⛔ stripTypes=false ⇒ 无 --experimental-strip-types flag，argv[1] 直接是 bundled .js。
      assert.equal(argv[1], path.join(root, "scripts", "dist", "ready-pool-check.js"));
      assert.ok(!argv.includes("--experimental-strip-types"), "stripTypes=false ⇒ 不带 flag");
      assert.ok(!argv.some((a) => a.includes("/task-root/plugin/scripts/ready-pool-check.ts")), "⛔ 不锚在 task root 的 .ts");
      assert.ok(argv.includes("--apply") && argv.includes("--json"));
    } finally {
      if (saved === undefined) delete process.env.QUAY_PLUGIN_ROOT;
      else process.env.QUAY_PLUGIN_ROOT = saved;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("parseIntervalMs / resolveCap — defaults + valid + invalid (fail-closed on bad input)", () => {
  assert.equal(parseIntervalMs(undefined).value, INTERVAL_MS_DEFAULT);
  assert.equal(parseIntervalMs("25").value, 25);
  assert.equal(parseIntervalMs("0").value, 0, "zero interval is legal (test seam)");
  assert.equal(parseIntervalMs("-5").ok, false, "negative interval rejected");
  assert.equal(parseIntervalMs("abc").ok, false, "non-numeric interval rejected");

  assert.equal(resolveCap(undefined).value, CAP_DEFAULT);
  assert.equal(resolveCap("7").value, 7);
  assert.equal(resolveCap("0").ok, false, "cap must be positive");
  assert.equal(resolveCap("2.5").ok, false, "cap must be an integer");
});


test("runPromotionRound — parses pool/promotions/applied_promotions from the injected full-pool output", () => {
  const cmd = ["node", "-e", "console.log(JSON.stringify({pool:2,should_apply:true,promotions:[{id:'gap-a',reason:'r'},{id:'gap-b',reason:'r'}],applied_promotions:[{id:'gap-a',ok:true,from:'todo',to:'ready',deliveryCritical:false}]}))"];
  const r = runPromotionRound("/r", cmd, 5);
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  assert.equal(r.pool, 2);
  assert.equal(r.shouldApply, true);
  assert.deepEqual(r.promotedIds, ["gap-a", "gap-b"], "promotedIds = the gate's eligible-promotion id list");
  // MULTI-PATH TOUCHES GUARD (gap-promotion-driver-commit-bypasses-precommit-touches-guard): the driver
  // re-map now propagates reason + committed so a blocked promotion is not silent in the ledger.
  assert.deepEqual(r.applied, [{ id: "gap-a", ok: true, from: "todo", to: "ready", deliveryCritical: false, reason: null, committed: false }]);
});


test("runPromotionRound — fail-closed: non-zero exit / unparseable output ⇒ error, ⛔ not 'no candidates'", () => {
  const nonZero = runPromotionRound("/r", ["node", "-e", "process.exit(1)"], 5);
  assert.equal(nonZero.ok, false, "non-zero exit ⇒ fail-closed");
  assert.match(nonZero.error, /exited 1/);
  assert.deepEqual(nonZero.promotedIds, [], "no fabricated promotions on read failure (硬规则 3b)");

  const garbage = runPromotionRound("/r", ["node", "-e", "console.log('not json')"], 5);
  assert.equal(garbage.ok, false);
  assert.match(garbage.error, /unparseable/);
});


test("computeRoundRecord — action ∈ promote|fix|none|error derived from the round", () => {
  const base = { round: 1, runId: "pm-1", pid: 42, at: "2026-08-22T00:00:00.000Z", pool: 1, shouldApply: true, applied: [], promotePathLlmInvoked: false, fixes: [] };
  assert.equal(computeRoundRecord({ ...base, promotedIds: ["gap-a"], error: null }).action, "promote");
  assert.equal(computeRoundRecord({ ...base, promotedIds: [], error: null }).action, "none");
  assert.equal(computeRoundRecord({ ...base, promotedIds: [], error: "boom" }).action, "error");
  assert.equal(
    computeRoundRecord({ ...base, promotedIds: [], error: null, fixes: [{ id: "gap-f", spawned: true, missing: ["fourArtifacts=false missing=[dod]"], unfixable: [], exitCode: 0 }] }).action,
    "fix",
    "AC132: a round that spawned a fix worker is a 'fix' round",
  );
  const rec = computeRoundRecord({ ...base, promotedIds: ["gap-a"], error: null });
  assert.equal(rec.run_id, "pm-1");
  assert.equal(rec.pid, 42);
  assert.equal(rec.promote_path_llm_invoked, false, "AC131: round record carries promote_path_llm_invoked=false on the mechanical promotion path");
  assert.deepEqual(rec.fixes, [], "AC132: no fix worker ⇒ fixes empty");
  assert.ok(rec.ts && rec.round, "ts/round present");
});
