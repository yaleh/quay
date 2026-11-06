---
id: gap-develop-red-set-empty-conflates-clean-with-not-evaluated
title: develop 红基线集把「评估过且全绿」与「没评估成」写成同一个空集 ⇒ 每次负载 flake 都被判成本任务引入
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

（以下读数由立案方 2026-11-06 在本机实测；`develop-red-set.json` 的三个字段已由立案执行者在 `/data/home/yale/work/quay` 上逐字复核，与本段一致。）

- 载体 `.quay/develop-red-set.json` 当前逐字读作：

  ```json
  { "develop": "f2bd81f2f21bf1e628e261d558a006b463a6c0ad", "evaluatedAt": "2026-11-06T12:40:40.902Z", "reds": [] }
  ```

  记录的 sha 在检查时刻等于实时 `develop`（相差 0 个提交），所以这份文件是**刚写下的** —— 然而**其中没有任何东西区分「基线 suite 跑过且全绿」与「基线评估没产出可用读数」**。
- 同一窗口内 suite 可证地**并不是**可靠全绿的：17:00 CST 以来 19 个 verification round，其中 **5 个带 `notEvaluated: "oom-killed (1|2)"`**；反复出现的红只属一个家族（`dist/quay.js` 55、`register-plugin.mjs` 15、`npm-pack-e2e.test.mjs` 10、`verify-sea-artifact.test.mjs` 7、`build-plugin-dist.test.mjs` 6）。
- 这些同样的文件在 develop 上单独跑是通过的：`node --test packages/quay/test/verify-sea-artifact.test.mjs` ⇒ 13/13 通过，1.2 s；`sea-build-node-version` + `sea-bundle-plugin-sidecar` ⇒ 8/8 通过，1.1 s。所以 suite 时段的红是并发/负载 flake，不是缺陷。
- 后果：`reds: []` 断言了一个干净的基线，于是命中 flake 的任务轮产出的红集**不是**基线的子集 ⇒ fan-in 拒绝落地 ⇒ worker 以 exited-not-landed 退出 ⇒ 整个任务被重新派发。实测：**最近 12 个 worker 中 8 个 exited-not-landed**；已完成的轮次中位数约 101 min，而每次未落地大约浪费 67 min。
- 形态：这是硬规则 3b ——「评估不成」与「评估过且干净」共用了同一个取值。

## Proposed fix

（形状留给实现者；以下是立案方给的约束，不是实现方案。）

给载体一个显式的评估态（例如 `state: clean|reds|not-evaluated`，或 `evaluated: true|false` + `reason`）；只要基线 suite **不完整 / 被 OOM kill / 被 watchdog kill**，就写 `not-evaluated`；并让**每一个**消费者按该状态分叉 —— `not-evaluated` 既不得等于「没有红可以减」，也不得等于「红」。红本身继续写，以保住既有的「某个红消失了」信号。

**立案时已核对的两处事实（实现者可直接采用，⛔ 不要重新猜路径）**：

- 本仓**不存在** `plugin/scripts/develop-red-set.ts`（读到 `File does not exist`）⇒ 读写两侧都在既有两个脚本里，本任务不新增载体脚本。
- 现状的读侧在 `plugin/scripts/worker-fan-in.ts`：`readDevelopRedSet(root)` 返回 `{evaluated:true,set}` 或 `{evaluated:false,reason}`（`plugin/test/develop-red-set.test.mjs:237-254` 已断言「读不懂 ≠ 空红集」）。**注意**：读侧的 `evaluated` 只描述**文件能否解析**，不描述**基线是否评估成功** —— 正是本任务的缺口所在。⛔ 实现时不要用「再加一个同名字段」把它盖过去。
- 仓外还有一个消费者：`gap-develop-red-set-writer` 的 Proposal 写明 **fleet 只读该载体**做「可重派」判定。它不在本仓 Touches 内；若它按 `reds: []` 分叉，需要 fleet 仓自己的任务跟进（本任务只负责让本仓写出的载体**带着可区分状态**，并在 Evidence 里点名这个跨仓消费面）。

<!-- dedup-ref --> **去重（按机制，不是按症状词）**：`develop-red-set` 在 todo/ready 池内命中 0；全库仅 3 条命中，都是 done —— `gap-develop-red-set-writer`（**建**这个载体与它的 writer，`reds: []` 的语义就是它定义的）、`gap-instrument-decay-baseline-red-exempt-unadjudicated`、`gap-instrument-decay-suite-red-blocks-landing-steps-unadjudicated`（后两条只**引用**该载体作为读数，不涉评估态）。⇒ 本条不是重复立案：既有任务是「让载体存在」，本条是「让载体不再把两种不同的世界写成同一个值」。

<!-- dedup-ref --> **合并判断 = separate**：唯一共享 Touches 的 open peer 是 `gap-meta-classifyrecoveryround`（ready），它同样在 `plugin/scripts/worker-fan-in.ts` 上（调度器会串行化这两个任务）。它修的是**恢复阶梯**的 `classifyRecoveryRound` 把 SUITE-NOT-RUN 折成 `complete-red`（硬规则 3b 的**同族兄弟实例**），与本条修的**载体落盘态**是两个机制、两个载体、两个测试文件 ⇒ 不合并，但实现时应读它已确立的形状（「没跑」必须是具名取值，且与「跑了且红」「跑了且绿」三者互不相等），避免两个 sibling 用两套口径。

## AC

- [ ] AC1（写侧三态，正负控制齐）对 `applyDevelopRedObservation` / `maintainDevelopRedSet` 断言三条互不相等的落盘形态：① 一次**不完整 / OOM-killed / 被 watchdog kill** 的基线评估 ⇒ 载体写出显式的 `not-evaluated` 且 `reason` 非空；② 正控制——一次**完整且全绿**的基线评估 ⇒ 写出 `clean`（或 `evaluated:true` + `reds: []`），且与 ① 的载体 JSON **不相等**；③ 一次**完整且真红**的评估 ⇒ `reds` 非空且不被标成 `not-evaluated`。三条都由 `node --test plugin/test/develop-red-set.test.mjs` 断言；贴 tests/pass/fail 与三种载体 JSON 逐字。⛔ 判据可假：把新的状态分支去掉后 AC1 必须变红（贴变异负控的两侧输出）。
- [ ] AC2（消费侧双向都不误判）先**枚举**仓内该载体的全部消费点（以 `readDevelopRedSet` 的调用点为准，⛔ 不假设清单），再把 `not-evaluated` 交给它们并同时断言**两个方向**：① 不得得出「本任务引入了红」（不得落到 `hard-red` / `task-introduced-red` 一类的判词）；② 不得被当成「基线是干净的」（不得因「红集为空」而把任务侧红判成基线子集 ⇒ `exempt`/放行）。并贴正控制：`clean` 与 `reds` 非空两种输入走原路径、行为不变。⛔ 只断言一个方向视为未测（这正是本条要防的两次相反误判）。
- [ ] AC3（写者唯一 + 成因可区分）`.quay/develop-red-set.json` 仍只有 `worker-driver.ts` 一个生产写调用点（沿用既有 AC4 的枚举断言，`plugin/test/develop-red-set.test.mjs:259-271`）；`not-evaluated` 的 `reason` 逐字落在载体里，且 OOM-killed / incomplete / watchdog 三种成因**可区分**（不是同一个字符串、也不是三类共用一个 `reason: null`）。
- [ ] AC4（live reading，落地后）落地之后的下一次真实评估在 `.quay/develop-red-set.json` 上落下一个显式状态（`clean` / `reds` / `not-evaluated` 三者之一），并把该文件逐字引用进本任务 Evidence；若落地后窗口内没有真实评估发生，记 `NOT-EVALUATED` + 该窗口的 verification-round 读数 + 一条可跑的 unpark 检查，⛔ 不得用 fixture 输出充数。（待外部）
- [ ] AC5 `bash scripts/test.sh --for-task gap-develop-red-set-empty-conflates-clean-with-not-evaluated` exit 0，且 `plugin/test/develop-red-set.test.mjs`（命中文件）贴出 tests/pass/fail。

## DoD

真实交付物是**载体文件本身**带上可区分的评估态：一个刚被 OOM/不完整评估过的窗口，读 `.quay/develop-red-set.json` 能看出「没评估成」，而不是读成 `reds: []`；一个完整且全绿的窗口仍写出 `clean`。两侧都由生产写入路径产生并被引用进 Evidence（AC4 是这一项的读数，⛔ fixture 回显不算 —— 硬规则 4 推论三）。⛔ 三条红线：不把 `not-evaluated` 折成 `reds: []` 之外的任何既有取值来「兼容」旧消费者；不加一个只改命名的同义字段（读侧已有的 `evaluated` 描述的是文件可解析性，不是评估成败）；不把「本任务新增了状态字段」等同于「生产载体已带上该状态」。跨仓消费面（fleet）若仍按 `reds: []` 分叉，须在 Evidence 里点名并留给 fleet 仓自己的任务。

## Touches

- plugin/scripts/worker-driver.ts（writer：`applyDevelopRedObservation` / `writeDevelopRedSet`，唯一落盘入口）
- plugin/scripts/worker-fan-in.ts（观察面 `developRedObservation` + 载体读侧 `readDevelopRedSet` + 基线 A/B 的子集判定）
- plugin/test/develop-red-set.test.mjs（既有测试，三态与双向负控落在这里）
- tasks/gap-develop-red-set-empty-conflates-clean-with-not-evaluated.md

> 立案时已核对：上述三个代码/测试路径都存在；`plugin/scripts/develop-red-set.ts` **不存在**（⛔ 不要新建它）。仓外 fleet 读者不在本 Touches 内。
