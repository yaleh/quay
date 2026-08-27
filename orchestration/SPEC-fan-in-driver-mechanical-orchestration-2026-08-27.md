# SPEC：fan-in 机械编排 —— 取消 fan-in workflow 子代理、机械部分交 driver、语义部分单独 Claude 会话

**作者**：manager｜**日期**：2026-08-27｜**状态**：proposal，待 outer 立案、待人裁定排期
**来源**：人 2026-08-27 09:0xZ 提出方案（逐字见 §0.1）。本 SPEC 是 `SPEC-fan-in-workflow-lock-and-S1-2026-08-26.md`
的**修订/后继**——那份 SPEC 引入了「S=1 workflow 锁 + ff-race 结构上归零」，本 SPEC 用实测证明该承诺未兑现，
并给出正确的执行载体（driver 机械编排）而非继续修锁。

---

## 0. 一句话

**取消 `fan-in-execute.js` workflow（子代理串行跑机械步骤），改由 driver 机械驱动 fan-in 的机械部分
（锁 / merge / delta 判定 / typecheck / scoped门 / suite / ff）；只有需要语义判断的失败点（冲突、
红 suite、typecheck 红、anti-drift 越界）才单独唤起一个 Claude Code 会话。suite 因此不再需要 detach，
fan-in 锁机械地包裹 suite 锁，锁持有时长从「模型的 ~30min」塌缩到「机械的 ~10min」。**

### 0.1 人的方案（逐字，⛔ 不得意译）

```
注意：总体来说，应当取消 fan-in workflow，而用 driver 覆盖其过程。对于其中可以机械驱动的部分，
如获取锁和 suite 测试等，应机械驱动；对于需要语义的部分单独调用 Claude Code 会话。当然，在
这一机制下，跑 suite 也不再需要 detach，fan-in 锁也应当机械地包裹 suite 锁。
```

---

## 1. 现状：S=1 workflow 锁的「ff-race 结构上归零」未兑现（实测，非推演）

`SPEC-fan-in-workflow-lock-and-S1-2026-08-26.md` 的承诺是「持锁 merge→suite→ff 整段，develop 在
持锁期间不前进 ⇒ ff-race 结构上归零」。**实测否证了这一承诺**，根因不是锁的对象错，是**执行载体错**。

### 1.1 三组实测数据（manager 08-27 读码 + 读 workflow-lock-events / suite log / 子代理 transcript）

**① 锁持有时长恒 ~30min，不是机械时长。** 每把 fan-in workflow 锁的持有都是 1820–1845s
（`1800s watchdog 强制释放 + 20-45s 轮询开销`），与任务内容无关：

```
lifecycle-driver   acquire 06:46:07 → release 07:16:50 = 30min43s
archguard          acquire 07:16:49 → release 07:47:12 = 30min23s
test-isolation     acquire 07:47:11 → release 08:17:36 = 30min25s
```

**② suite 跑在锁释放之后——锁根本没罩住 suite。** lifecycle-driver 的 suite `07:20:50→07:22:21`，
而它的锁 `07:16:50` 就 release 了（suite 晚 4min 才起）。即「持锁 merge→suite→ff」的承诺，实际上
watchdog 在 suite 还没跑完前就把锁放了。

**③ ff 仍然失败重试。** outer 08:51Z 实测：archguard suite release 07:47 → ff 失败 → 08:48 二次
acquire（同一 runId `fm-...-twe1vf`）重试。这直接否证「ff-race 结构上归零」——ff-race 还在发生。

### 1.2 为什么锁没兑现（执行载体错，不是锁参数错）

`fan-in-execute.js` 的 7 个步骤**全是机械的**（每步就是一条 Bash），却由一个 Claude Code 子代理
串行执行。子代理每跑一条命令前都要读一遍 ~1000 行的 prompt 再决定下一条 ⇒ 每条命令之间
~3-5min 的模型延迟。于是：

- 机械步骤本该 ~10min（merge 1min + scoped门 5min + suite 5min + ff 1s），被模型延迟撑到 ~30min。
- 锁被这个慢子代理拿着 30min ⇒ 必须挂 30min watchdog 防「锁死」⇒ watchdog 一到就放锁。
- suite 之所以 detach（`setsid & disown`），是因为子代理的 Bash 有 600s 硬顶、suite 19+min 超了——
  detach 的 suite 成了锁外的孤儿，watchdog 一放锁，下一个 fan-in 的 suite 就撞上它。

三个症状（锁 release 早于 suite、detached suite 孤儿、ff 失败重试）是**同一个根的三张脸**：
**机械活不该由一个慢子代理来跑。**

### 1.3 实测数据口径（供后续判据引用）

| 量 | 实测 | 谁花的 |
|---|---|---|
| scoped门（`--for-task`，312 tests） | ~5min | 机械命令 |
| suite RUN（真跑测试） | 1.5–5min（archguard 26min 异常） | 机械命令 |
| acquire → suite_start 的 gap | 24–60min | **子代理模型延迟** |
| 锁持有时长 | ~30min（watchdog 1800s） | 上面 gap 的连锁 |

---

## 2. 正确机制：机械/语义分离

fan-in 的 7 步里，**happy path 100% 机械**，语义只出现在「失败时的处置」：

| 步骤 | 性质 | 失败时谁处置 |
|---|---|---|
| 获取 fan-in 锁 | 机械（flock） | — |
| merge develop | 机械（git merge） | **冲突 → Claude 会话** |
| anti-drift Touches 核对 | 机械 | **HARD FAIL → Claude 会话**（窄化 Touches vs 真违规） |
| delta 断言面判定 | 机械（git diff + classify） | — |
| ts-typecheck 闸 | 机械 | **typecheck 红 → Claude 会话** |
| scoped门 + doc + suite | 机械（scripts/test.sh） | **suite 红 → Claude 会话**（fix-scope 循环） |
| ff-merge + 入账 + 释放锁 | 机械 | **ff 失败 → 重试** |

**机制**：driver 机械跑完全链；只在四个失败点（冲突 / HARD FAIL / typecheck 红 / suite 红）唤起一个
Claude Code 会话做「看懂失败 + 出修复」这一语义动作，修完 driver 机械重跑对应检查并继续。

### 2.1 为什么这修掉 30min

30min = 7 条 Bash × 每条之间模型思考。driver 跑同样的 7 步是**纯命令执行**：merge 1min + scoped门
5min + suite 5min + ff 1s ≈ **~10min 机械时长，零模型延迟**。30min → 10min，省掉的是模型磨蹭。

### 2.2 为什么不再需要 detach

之前 detach 是**被逼的**（`fan-in-execute.js` 注释原文「⛔ 禁止前台 bash scripts/test.sh（suite 19+
min > Bash 单次 600s 硬顶）」）。driver 是长生命周期进程（`worker-driver.ts` 已跑 6h+），**没有 600s
Bash 硬顶**，suite 作为它的子进程（spawn + poll + 超时 kill）直接管理。detach 及它带来的整套
孤儿/watchdog/锁 release 早于 suite 问题**一起消失**。

### 2.3 锁层级：fan-in 锁机械包裹 suite 锁

当前锁顺序（「先 fan-in 锁 → 再 suite 锁」）写在**子代理 prompt 里**，靠模型「记得做」，会漂移。
挪到 driver 后，顺序变成 driver 代码里的确定性控制流：

```
acquire fan-in 锁 → run suite（内部 acquire suite 锁）→ ff → release fan-in 锁
```

锁持有时长从「模型 30min」变成「机械 ~10min」——**30min watchdog（锁太久的补丁）没了存在理由**。

---

## 3. 与现有 driver 的关系（不是新造轮子）

`worker-driver.ts` 已经在 dispatch worker（Claude Code 会话）。本 SPEC 把它**扩到 fan-in 编排**：

```
worker（Claude 会话）在 worktree 里实现 → 实现完退出
→ driver 接管 worktree，机械跑 fan-in（merge → 判定 → scoped门 → suite → ff）
→ 失败时 driver spawn 一个 Claude 会话做语义修复 → 机械重跑 → 循环（maxFixRounds）
```

三段都是现有能力，缺的是**把 `fan-in-execute.js` 的 7 步从「prompt 交给子代理」重写成「driver 的
控制流」**。而这 7 步的脚本（`fan-in-ff-merge.sh` / `select-static-checks-for-touches.ts` /
`fan-in-ts-typecheck-gate.ts` / `scripts/test.sh --buckets`）**全部已经存在**，只是现在被 prompt 串起来，
改成被 driver 串起来。

### 3.1 三个必须澄清的设计点

- **① driver 不能同步阻塞 26min**：suite 最长 26min，driver 若同步等它会卡死其它派发。正确形态是
  「不 detach ≠ 同步阻塞」——driver 用 spawn 子进程 + 异步 poll（exit 文件），suite 跑时 driver 照常派 worker。
- **② 语义循环由谁控**：红 suite 的 fix-scope 循环（maxFixRounds=4）现在是子代理内部循环。新机制下
  driver 控循环（检测红 → 调 Claude 会话修 → 重跑 suite → 再判），Claude 会话只做「看懂失败 + 出修复」。
  driver 是状态机，会话是无状态的一次性判断。
- **③ worktree 归属**：现在 worker 建 worktree + 自己跑 fan-in。分离后 worker 只负责实现，实现完退出；
  driver 接管 worktree 跑机械 fan-in。这同时消掉 outer 报的「worker TaskOutput 收尾慢 30-40min」——
  worker 不再等 fan-in 结果。

---

## 4. 取代/修订关系与待裁定

- **取代** `SPEC-fan-in-workflow-lock-and-S1-2026-08-26.md` 的**解法**（S=1 workflow 锁 + 30min
  watchdog + detached suite），保留其**诊断**（ff-race 是 merge 阶段无锁 / suite 窗口导致的）。
  本 SPEC 的立场：那份 SPEC 把「锁的对象」改对了（fan-in 整链），但「执行载体」仍错了（子代理）。
- **不冲突** `SPEC-unified-driver-architecture-2026-08-23.md`（driver 两级分层）与
  `SPEC-worker-driven-inner-2026-08-16.md`（机械驱动 + per-task claude 会话）——本 SPEC 是这两个
  SPEC 在 fan-in 这一段的自然延伸。

**待裁定（人）**：① 是否先做「driver 机械 fan-in」的 happy-path（机械跑完，失败仍走旧 workflow 兜底），
再逐步搬语义失败点；还是整体一步到位。② 语义会话的唤起粒度（每个失败点一个会话 vs 一个修复会话循环）。

---

## 5. 判据（可验证，非自证）

- [ ] **AC1（锁时长塌缩）**：一次 fan-in 的 fan-in workflow 锁持有时长 ≤ 机械时长 + 余量（merge +
  scoped门 + suite + ff），⛔ 不再是 ~30min 恒值；实测多个任务锁持有显著低于 1800s 且与任务内容相关。
- [ ] **AC2（锁罩住 suite）**：fan-in 锁 release 时刻**不早于** suite 结束时刻（`lock-events release ≥
  suite exit end_iso`），⛔ 不再出现「suite 跑在 release 之后」。
- [ ] **AC3（无 detach）**：suite 进程是 driver 的子进程（`ppid` 指向 driver），⛔ 不是 `setsid & disown`
  的孤儿（`ppid=1`）。
- [ ] **AC4（ff-race 归零，真兑现）**：连续 N 个 code-delta 任务 fan-in，ff 失败次数 = 0（或仅
  inert-delta 的毫秒级 re-ff，非重跑 suite）；⛔ 不再出现 archguard 式「ff 失败 + 二次 acquire 重试」。
- [ ] **AC5（吞吐恢复）**：任务落地吞吐从 ~1/h 回到 ≥ 3/h（同 3 在飞下，landing 不再被 30min 编排撑长）。

---

## 6. 反例判据（一条命令可查）

若满足以下任一，则本 SPEC 未兑现：

```
(a) 锁持有仍恒 ~1800s（watchdog 仍在强制释放）⇒ AC1 假；
(b) suite exit end_iso 晚于 lock release ts ⇒ AC2 假；
(c) suite 进程 ppid=1（仍 detach）⇒ AC3 假；
(d) fan-in-retries.jsonl 仍出现同一任务的 attempt=2/3 且 error 为 Diverging branches ⇒ AC4 假。
```
