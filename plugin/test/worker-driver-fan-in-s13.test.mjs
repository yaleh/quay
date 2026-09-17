// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in-s10.test.mjs by gap-suite-split-15-over-30s-test-files — shard 13 (1 test). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { assert, fs, makeMechRepo, mechOpts, path, rmSafe, runMechanicalFanIn, suiteLogFileName } from "./helpers/worker-driver-fan-in-harness.mjs";

test("AC3 — landed 后清理该任务名下全部历史 attempt 日志；兄弟任务 `<task>-<suffix>` 日志保留（⛔ 只增不减/误删 ⇒ 假）", async (t) => {
  const m = makeMechRepo("prune-on-land");
  t.after(() => rmSafe(m.base));
  const q = path.join(m.repo, ".quay");
  fs.mkdirSync(q, { recursive: true });
  // 预埋：本任务 gap-mfh 两份历史红 attempt 日志（跨 runId）+ 兄弟任务 gap-mfh-A 一份（⛔ 不得被误删）。
  const h1 = suiteLogFileName("gap-mfh", "wk-prod-old-1", "1");
  const h2 = suiteLogFileName("gap-mfh", "wk-prod-old-2", "1");
  const sibling = suiteLogFileName("gap-mfh-A", "wk-prod-old-1", "1");
  fs.writeFileSync(path.join(q, h1), "old-red-1", "utf8");
  fs.writeFileSync(path.join(q, h2), "old-red-2", "utf8");
  fs.writeFileSync(path.join(q, sibling), "sibling", "utf8");
  // 落地一次（mechOpts 缺省 suite 绿 ⇒ landed → cleanup 触发 prune）。
  const r = await runMechanicalFanIn(mechOpts(m, "wk-prod-land"));
  assert.equal(r.outcome, "landed", `must land (step=${r.step} reason=${r.reason})`);
  assert.ok(!fs.existsSync(path.join(q, h1)) && !fs.existsSync(path.join(q, h2)), "historical attempt logs pruned after landing");
  assert.ok(fs.existsSync(path.join(q, sibling)), "sibling task log retained（⛔ `-` boundary 误删 ⇒ 假）");
});
