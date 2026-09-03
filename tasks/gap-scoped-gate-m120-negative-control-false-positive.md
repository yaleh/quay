---
id: gap-scoped-gate-m120-negative-control-false-positive
title: 修缺：scoped-gate 把 build-dist.test.mjs 的 m120 负控制 stderr 误判为真实失败
status: ready
role: primitive
labels:
  - scoped-gate
  - false-positive
  - fan-in-blocker
  - cross-suite-violation
created: 2026-09-03T03:10Z
---

## Finding

**严重度**：🔴 blocks fan-in（已两次实例）
**发现者**：driver development progress (cross-session)

### 现象
scoped-gate（`scripts/test.sh --for-task <task> --allow-thin`，`worker-driver.ts` 的
`scopedGateCommandFor`）报红，输出中包含：
```
✘ [ERROR] Could not resolve "/tmp/quay-m120-does-not-exist.ts"
```

### 已核实的根因线索
1. 该字符串来自 `packages/quay/test/build-dist.test.mjs:99` 的**负控制测试 (c)**
   （`"(c) failure path: a nonexistent QUAY_BUILD_DIST_ENTRY makes buildDist() reject loudly"`）：
   故意把 `QUAY_BUILD_DIST_ENTRY` 设成一个不存在的路径,断言 `buildDist()` 必须 reject——
   esbuild 内部把解析失败打到 stderr,是**该测试通过的预期副产物**,不是真实故障。

2. `worker-driver.ts:2781` 的 `isFailureSignalLine()` 正则**故意**把 `Could not resolve` /
   `[ERROR]` 列为失败信号词——这是为了修复它的姊妹缺陷
   `gap-scoped-gate-reason-stderr-drops-stdout`（scoped 门**真红**时,esbuild 构建失败的这行
   摘要之前会被丢弃,导致 reason 里看不到真实原因）。

3. **本缺陷是该修复的镜像反例**：当 scoped-gate **整体通过**（负控制测试本身 `ok`,exit 0）,
   这行 stderr 文本依然出现在 stdout+stderr 合并流里；若下游把 `isFailureSignalLine` 的
   **非空匹配**当作「存在失败」的判据（而不是仅用于「已知失败后生成可读摘要」）,就会把
   一次真实通过的 scoped-gate 误判为红。

### 待查（下一步，实施者需现场确认，不猜测）
- `extractFailureSummary`/`extractFirstFailureLine` 的**调用点**：是否有任何调用方把
  「非空摘要」当作 pass/fail 判据本身用,而不是只在已知 `exit code ≠ 0` 之后才调用它们
  生成 reason 文本？（按 `worker-driver.ts:2793-2810` 的函数注释,设计意图是后者——
  需要现场核实是否有调用点违反了这个契约）
- `scripts/test.sh --for-task` 对 `node --test` 子进程的**真实 exit code** 在两次事故里
  分别是多少？如果 `node --test` 本身报 0（因为所有测试含负控制测试都是 `ok`）,而 fan-in
  仍判红,说明误判发生在**摘要提取层**之外，需要往上一层找（`select-static-checks-for-touches.ts`
  或 fan-in-execute 的判定逻辑）。

### 影响
- 🔴 **第一次**：`gap-unified-frontmatter-parser` 撞上,后续重派 scoped-gate 才通过
  （绕过而非修复,问题仍在）
- 🔴 **第二次（当前）**：`gap-task-write-schema-depends-on-documentation` 撞上,挡住 fan-in
- ⚠️ 全局缺陷（硬规则 5b）：非任务自身 Touches 问题（`TOUCHES-DIR-GLOB-HINT` 明确 hint only）,
  会挡住任何 scoped test 集合恰好包含 `build-dist.test.mjs` 的任务

---

## Plan

### Step 1：定位真实判定点
现场跑一次 `bash scripts/test.sh --for-task gap-task-write-schema-depends-on-documentation --allow-thin`,
对照：
- `node --test` 子进程的真实 exit code
- 若干层调用链（`select-static-checks-for-touches.ts` → checker 汇总 → fan-in 判定)
  各自读到的 pass/fail 判据分别是什么

### Step 2：修复方向（二选一或组合，由 Step 1 结果决定）
- **(a) 判定侧**：确保 pass/fail 判据只用真实 exit code（或 TAP `# fail N`/`not ok` 计数),
  `isFailureSignalLine` 系列函数只能用于「已知失败」之后的摘要展示,不得反向参与判定
- **(b) 源头侧**：`build-dist.test.mjs` 的负控制测试 (c) 抑制 esbuild 的 stderr 输出
  （例如捕获后不透传到进程真实 stderr,只保留在 assert 断言内部),从源头消除这行噪声

### Step 3：回归验证
- 两个已撞上的任务（`gap-unified-frontmatter-parser` 的历史记录 + 当前
  `gap-task-write-schema-depends-on-documentation`）重跑 scoped-gate,确认不再误红
- 补充负测试：一个只跑 `build-dist.test.mjs` 的 scoped-gate 调用应始终报绿

---

## Definition of Done

- [ ] 根因定位到具体的判定点（哪一层把非空摘要误当失败）
- [ ] 修复落地（判定侧和/或源头侧）
- [ ] `gap-task-write-schema-depends-on-documentation` 的 fan-in 可以继续推进
- [ ] 回归测试补充,防止同型缺陷再次发生
- [ ] （若判定侧修复）审计是否还有其它 checker/gate 有同类「摘要函数结果被当判据」的误用

---

## Touches

- `plugin/scripts/worker-driver.ts`（`isFailureSignalLine`/`extractFailureSummary` 及其调用点）
- `packages/quay/test/build-dist.test.mjs`（若采用源头侧修复）
- `plugin/test/worker-driver.test.mjs`（回归测试）

---

## References

- **Blocking**：gap-task-write-schema-depends-on-documentation（fan-in scoped-gate 红,当前实例）
- **Prior occurrence**：gap-unified-frontmatter-parser（重派绕过,未真正修复）
- **Sibling/root defect**：gap-scoped-gate-reason-stderr-drops-stdout（引入 isFailureSignalLine
  对 `Could not resolve`/`[ERROR]` 的匹配,本缺陷是其镜像反例）
- **Related**：gap-step-trace-reason-captures-gate-stdout（同一函数的另一次调整历史）

