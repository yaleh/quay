---
id: META-015
title: 请裁定：GOAL-036 的 AC-361 判据有一条【恒假】子句（全文件 `grep -c "inFlightTasks()" ≤ 1`，而
  goal 自身规格要求的是「重跑 AC-359 的窗口检查」）⇒ goal-036-merge-and-postmerge-verify 的 AC6/AC7
  结构上不可勾；goal 已并入 develop
status: proposed
handler: meta-driver
---
**只报告、不代裁** —— 阻塞点是一条 **goal AC 判据**（`goals/AC-361-*.md` 的 `criterion`），改写它是 **authoring 面**，不在执行者授权面内。已按纪律**未改判据、未勾选依赖它的 AC**，任务体 `## Evidence` 已把全部读数与所需决定逐字写下。

## 一、事实：本任务其余 8 条 AC 全过，GOAL-036 已并入 develop

- goal 合并请求 `7667e142-…`（`override: null`、`unmetAcs: []`，未用 `--override`）⇒ 机械 fan-in **landed**：`eb89d042e3799de07f9d1a3c3a73cbbc291f0c31`（`goal-merge-result` `5a406b99-…`，`19:27:53.410Z`）。
- 并入形态正确：`develop` tip == `landedSha` == first-parent 首行；`git rev-list --parents -n1` 恰两父（`^1`=并入前 develop tip、`^2`=goal tip `e5a2b7a2e`）；goal-内部提交泄漏 first-parent = **0**；`goal/GOAL-036` 已删。
- 两个受影响测试文件在主检出实测全绿：`driver-filters.test.mjs` + `worker-driver.test.mjs` ⇒ **203 pass / 0 fail，exit 0**。

## 二、根因：AC-361 的 `criterion` 里有一条子句在**任何**满足本 goal 范围的实现上都恒假

判据逐字（`goals/AC-361-*.md`）：

```
callCount=$(grep -c "inFlightTasks()" plugin/scripts/worker-driver.ts || true)
[ "${callCount:-0}" -le 1 ] || { echo "CAUSE=post-merge-regression -- worker-driver.ts still has $callCount inFlightTasks() call(s) …" >&2; exit 1; }
```

实测（主检出 = develop 尖端 `eb89d042e`，`quay goal gate AC-361 --dry-run --json` ⇒ **EXIT 1**，`treeSha 1d758ddf3`）：

```
grep -c "inFlightTasks()" plugin/scripts/worker-driver.ts   ⇒  4
  1666:  /** … = inFlightTasks() 的返回值 …            ← 注释
  5229:      const ids = inFlightTasks();               ← 冷启动读数（computeGoalBranchReading）
  5269:      inFlightTasks: inFlightTasks(),            ← writeRound 记录字段
  5317:      inFlightTasks: inFlightTasks(),            ← writeErrorRound 记录字段
```

而**同一棵树的窗口读数**（`step = "ready-pool"` → `step = "apply-filters"`）：`computeDispatchExclusion(` = **1**、`inFlightTasks()` = **0** ⇒ 本刀的结构改动**确已落地**。

**四条独立证据表明 ≤1 这一子句写错了（goal 自己的规格要求的是窗口检查）：**

1. GOAL-036 记录 `## AC` 一节把 AC-361 定义为「**`develop` 尖端（`merge-base` 一致性核验）重跑 AC-359 的结构检查** + 两个测试文件全量回归」——**窗口范围**。
2. GOAL-036「退出条件」写的是「**在一轮调度内**的唯一计算点」——**无**「全文件 ≤1」。
3. 兄弟任务 `goal-036-dispatch-exclusion-single-source` 的 `## Plan` 第 3 步**明文要求保留**闭包与那 3 处非派发调用点（"Do NOT remove the `inFlightTasks()` closure itself if it's used elsewhere … only the two dispatch-path call sites at ~5740/~5753 are in scope"）；第 4 步明写 "it may still appear elsewhere in the file … that's fine, out of scope"。
4. AC-359 的判据本身就是窗口范围的，已在 goal 分支 `exit 0`、记录 `achieved`（ledger 末条 `pass`）。

⇒ 与硬规则 4c 同形（判据没测量它自己声明的性质）；本任务此刻无法勾 AC6（要求 AC-361 exit 0）/ AC7（要求 `≤ 1`），且**勾上就是把「没测到」记成「测到了」**。

## 三、请求的裁定（一行即可，authoring 面）

把 AC-361 `criterion` 里那两行换成与上列 1–4 条一致的**窗口检查**，例如：

```
s=$(grep -n 'step = "ready-pool"'   plugin/scripts/worker-driver.ts | head -1 | cut -d: -f1)
a=$(grep -n 'step = "apply-filters"' plugin/scripts/worker-driver.ts | head -1 | cut -d: -f1)
w=$(sed -n "${s},$((a+40))p" plugin/scripts/worker-driver.ts)
[ "$(printf '%s' "$w" | grep -c 'computeDispatchExclusion(')" = 1 ] || { echo "CAUSE=…" >&2; exit 1; }
[ "$(printf '%s' "$w" | grep -c 'inFlightTasks()')" = 0 ]        || { echo "CAUSE=…" >&2; exit 1; }
```

⚠️ 改判据有**已知副作用**（`amending-a-goal-criterion-reds-tests-that-extract-it-verbatim`）：落笔前须 `grep -rln "AC-361\|goals/AC-361" packages/*/test plugin/test` 并跑命中测试。建议按先例 `gap-ac356-criterion-environment-fatal-window-check-unsatisfiable`（`done`）**独立立案**（`goal_ac: AC-361`，Touches = goal 记录 + 该任务自身文件），**并要求负控制**证明修好的检查仍有判别力。

## 四、我这一侧的可核事实

- 本任务**未改任何 `plugin/scripts/**`、`plugin/test/**`、`packages/**`**；`git diff --name-only develop...HEAD`（worktree）⇒ 空。
- ⛔ 未调用任何 `quay driver start|stop|restart`、未重启 `serve`。
- ⛔ **未跑 scoped 门、未写 scoped-gate cache** —— 依 `unsatisfiable-ac-requiring-authoring-loops-the-worker-driver` 的实测：AC 未全勾时驱动在 fan-in 前即以 `short_circuit: "ac-not-checked"` 短路，跑门不改变本轮结论。
- ⛔ 未改判据文本、未勾 AC6/AC7、未标 `（待外部）`（那会把「仪器坏了」伪装成「等外部绿轮」）。
- ⛔ **请勿重复立案**：阻塞点是**已存在**的 goal 记录 `AC-361` 的 `criterion` 一条子句，无第二个独立缺陷可立。

（本任务通过跨会话 `SendMessage` 另行通知了 GOAL-036 的立案会话。）