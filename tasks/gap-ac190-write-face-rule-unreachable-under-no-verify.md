---
id: gap-ac190-write-face-rule-unreachable-under-no-verify
title: AC-190 二次复发：写入面判定落在 pre-commit 钩子，而生产立案路径 commitStoreWrite 一律 --no-verify
  ⇒ 判定结构性不可达（生效线后第 2 条 delivery-critical 任务再次无 goal_ac）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-190
---
## Proposal

**AC-190 判据当前取假（实测 2026-09-14 21:31Z，本仓库生产工作树，立案前读数）**：

```
$ node --no-warnings --experimental-strip-types plugin/scripts/long-term-guarantee-goal-backed-check.ts --json
{"total":167,"violating":["gap-dist-closure-missing-driver-anchor-js"],"compliant":46,"grandfathered":120,
 "grandfathered_no_goal_ac":115,"grandfathered_with_goal_ac":5,"cutoff":"2026-09-09T00:00:00Z","status":"fail","ok":false}
EXIT=1
```

反例为真，不是误报：`tasks/gap-dist-closure-missing-driver-anchor-js.md` 的 `labels` 含 `delivery-critical`（**首见于该文件自己的立案提交** `1f774ef0d`，2026-09-14T18:30:14Z，晚于生效线 `2026-09-09T00:00:00Z`），top-level 与 `extra` 下都没有 `goal_ac` 键。⇒ 检测器判对了，红的是仓库本身。

### 为什么上一次修法没守住（根因：判定的落点在生产写者不走的那条路上）

上一次修法 `gap-ac190-goal-ac-rule-not-enforced-at-filing`（**done**，2026-09-13，`goal_ac: AC-190`）把规则接到「写入那一刻」，方向正确，但选错了**那一刻**：它落在 `plugin/scripts/precommit-guard.ts` 的判定 ③，而该判定**只有经 git `pre-commit` 钩子才会被调用**。生产立案路径根本不走钩子：

```
task_write（MCP / CLI / task edit）
  → packages/quay-native/src/store.ts  write()      # 锁内写盘，锁外提交
  → commitTaskWrite()                              # store.ts:1502
  → commitStoreWrite()                             # packages/quay/src/store-commit.ts:181
  → git commit --no-verify -m "tasks: <id> task_write by cli:<pid>" -- <relPath>
```

`store-commit.ts` 是五类 store（tasks / goals / meta / adr / docs-managed）**唯一**的写后提交原语（其头注释逐字指向 SPEC-store-commit-unification-2026-09-08 §3），`--no-verify` 是**明写的设计**（`:13-15`：pathspec-limited add + commit BACK-TO-BACK，机械 ABI 写入是 content-neutral 的）。`--no-verify` 跳过钩子 ⇒ 判定 ③ 在生产写路径上**结构性不可达**。

**发生率（硬规则 12，实测而非估计）**：`git log -400 --format=%s -- tasks/` 里 **370/400（92.5%）** 是 store-commit 生成的 `tasks: <id> <action> [by <actor>]` 形态提交 ⇒ 全部 `--no-verify`；能走到钩子的任务提交 ≤ 7.5%。上一次修法自己的 e2e 用的是「真 `git commit` 经安装的 pre-commit 钩子」——**它测的是人手路径，不是写者路径**（硬规则 4 推论三的同形：只有那条没人走的路径能满足它）。

**判定本身是对的**（所以修的不是规则，是落点）——本轮实测它对这条反例双向取假：

```
offenders(该文件原样，经 judgeStagedDeliveryCritical)  = ["tasks/gap-dist-closure-missing-driver-anchor-js.md (id=gap-dist-closure-missing-driver-anchor-js)"]
offenders(同一内容 + 一行顶层 goal_ac)                  = []          ← 取得到假，不是恒绿
```

⇒ 规则既能被满足、也能被违反；缺的是**让它在写者真正的路径上被执行**。

### 与既有机制的关系（⛔ 不重复、⛔ 不越界）

<!-- dedup-ref -->
相关但机制不同的既有任务：`gap-ac190-goal-ac-rule-not-enforced-at-filing`（done，交付钩子面判定 ③ 与那一轮的反例清理）、`gap-ac190-long-term-guarantee-goal-backed-check`（done，交付检测器脚本）、`gap-long-term-guarantee-registry-hand-maintained`（done，把判据从手维护表换成位置判定 + 生效线）。互补而**不可越界**的既有守卫：`plugin/scripts/eligible-no-goal-source-check.ts` 管「准入集合不得读 goal 源」（人 2026-09-11 裁定：准入只由 task 自身的自足属性决定，goal 信息永不改变成员资格）⇒ 本条落点是**写入面**，不得碰准入合取。

### 交付什么

1. **清掉当前反例**：给 `gap-dist-closure-missing-driver-anchor-js` 声明真实的顶层 `goal_ac`。该任务是打包产物闭环缺陷（`dist/driver-anchor.js` 不进 tarball），与 AC-202「凡被 spawn 的机件必进交付物——把闭包闸扩到 DRIVER_KINDS 这类数据表字面量引用」同域——AC-202 现为 `achieved`，而它的同一保证刚刚又以另一种字面量形态（动态路径引用）复发，这正是本任务必须引它的理由。实现者须逐字读 AC-202 与 AC-201 的 criterion 后确认或改选，**并把「为什么是这条 AC」写进该任务体**。⛔ **不许用「摘掉 `delivery-critical` 标签」换绿**——2026-09-13 已发生过一次（`3cb49af1b`），那条路正是本条要堵的洞。

2. **把判定挪到写者真正的路径上**（主选）：在 `packages/quay-native/src/store.ts` 的 `write()` 锁内校验缝（`validateWrittenYaml` 所在处，`fs.writeFileSync` 之后、`commitTaskWrite` 之前）加一条 fail-closed 判定，拒写时 throw **可归因**的错误（含 task id + 缺什么 + 怎么补），回滚语义沿用该缝既有的成熟形态（既有内容还原 / 新文件删除）。

3. **单源**（⛔ 不得出现第二份字符串判定）：把 `isDeliveryCritical` / `hasGoalAc` / `filedAfterCutoff` / `activationLineMs` 与钩子用的 `judgeStagedDeliveryCritical` 收进 `packages/quay/src/goal-ac-write-face.ts`（新模块），照 `packages/quay/src/goal-store.ts` 的形态办——`plugin/scripts/criterion-failure-attribution-check.ts` 今天刚落地的先例就是「谓词搬进 Core，plugin 侧 `export { … } from "../../packages/quay/src/…"` 保持旧 import 面」；`core-src-import.ts` 的头注释记着为什么静态字面量 + 运行时回退两者都要。`long-term-guarantee-goal-backed-check.ts` 与 `precommit-guard.ts` 改为从该模块取用或再导出，**脚本入口路径与 AC-190 判据的读数都不变**。

4. **⛔ 不得把第三方项目与存量打死**（硬规则 12 的镜像：不设未测量的限制）。`store.ts` 是 vendored 交付物，第三方工作区没有 goal 层（`goals/`），`goal_ac` 在那里无处可指 ⇒ 判定必须有**显式、可判定的启用条件**（例如「工作区存在 goal 层载体」），并有**负控制**证明没有 goal 层的工作区不会被它挡住。判定范围以**创建那一刻**为准（`existingRaw === null`），这样「翻一条存量任务的状态」不会被它拦——这也是生效线 grandfather 语义在写入面的正确形态，不必把本仓库那个字面日期搬进 Core。

5. **双向负控制（硬规则③b/④）**：正控制 = 生效线前 115 条无 `goal_ac` 存量、合规任务、无标签任务一律放行；负控制 = 「创建 + `delivery-critical` + `goal_ac` 空」经**真实 ABI 写路径**（store `write()` / MCP `task_write`，⛔ 不是 git 钩子、⛔ 不是只调纯函数）⇒ 被拒且文件未落盘；反向对照 = 同一内容补上顶层 `goal_ac` ⇒ 写入成功、盘上有、提交成功。

6. **判据本身不得被放宽**：AC-190 的 `--inject-unbacked-fixture` 负控制必须仍然 exit 非零。

## Plan

1. 读五份正本再动手：`goals/AC-190-task-ac.md`；`plugin/scripts/long-term-guarantee-goal-backed-check.ts`（导出的判定函数与生效线）；`plugin/scripts/precommit-guard.ts` 的 `judgeStagedDeliveryCritical` 与其 ③ 调用点；`packages/quay/src/store-commit.ts`（`--no-verify` 的设计理由）；`packages/quay-native/src/store.ts` 的 `write()`（锁内校验缝与回滚语义）。
2. 固定改前读数（本条已取，作为对照基线）：检测器 `--json` 的 `violating=["gap-dist-closure-missing-driver-anchor-js"]`；`judgeStagedDeliveryCritical` 对该文件 = 1 条 offender、补 `goal_ac` 后 = 0 条。
3. 给 `gap-dist-closure-missing-driver-anchor-js` 定 `goal_ac`：逐条读 AC-201 / AC-202 的 criterion，选定并**把理由写进该任务体**。⛔ 写入走 Provider ABI（`task_write` / Core `task edit`），⛔ 不手改 frontmatter 文本；写完用 `task_get` 回读。
4. 建 `packages/quay/src/goal-ac-write-face.ts`，搬入判定纯函数（行为逐字不变）。
5. 在 `packages/quay-native/src/store.ts` 的锁内校验缝接入 fail-closed 判定（启用条件见 Proposal 交付项 4），错误信息可归因。
6. `plugin/scripts/long-term-guarantee-goal-backed-check.ts` 与 `plugin/scripts/precommit-guard.ts` 改为从新模块取用或再导出（脚本入口路径不变）。
7. 测试：新增 `packages/quay-native/test/goal-ac-write-face.test.mjs`，四类断言各至少一条且每条都能取假：负控制（创建 + 标签 + 无 `goal_ac` 经真实写路径 ⇒ throw 且文件未落盘）、反向对照（补 `goal_ac` ⇒ 落盘 + 提交成功）、存量不误伤（已存在的 delivery-critical 无 `goal_ac` 任务被翻状态 ⇒ 放行）、第三方不误伤（无 goal 层的工作区 ⇒ 放行）。
8. 重建 vendored 产物（`plugin/scripts/sync-vendor.sh`）——`plugin/vendor/**` 与 `packages/*/dist/**` 是 gitignored 生成物，⛔ 不进 `## Touches`，但必须真重建，否则交付面跑的是旧代码。
9. 跑 AC-190 判据链确认 exit 0（脚本存在 → 真仓库默认绿 → `--inject-unbacked-fixture` 仍非零），并在同一次提交里记下改前 / 改后两个读数。

## AC

- [ ] AC1 `node --no-warnings --experimental-strip-types plugin/scripts/long-term-guarantee-goal-backed-check.ts` exit 0；`--json` 的 `ok` 为 `true` 且 `violating` 为 `[]`
- [ ] AC2 `--inject-unbacked-fixture` 仍 exit 非零（⛔ 不得靠放宽判据换绿）
- [ ] AC3 `tasks/gap-dist-closure-missing-driver-anchor-js.md` 的**顶层** `goal_ac` 非空、任务体里写明「为什么是这条 AC」，且其 `delivery-critical` 标签仍在（⛔ 不得靠摘标签换绿）
- [ ] AC4 负控制走**真实 ABI 写路径**（store `write()` / MCP `task_write`，⛔ 不是 git 钩子、⛔ 不是只调纯函数）：创建一条「`delivery-critical` + 无 `goal_ac`」的任务 ⇒ 被拒（throw / 非零）且文件未落盘
- [ ] AC5 反向对照：同一内容补上顶层 `goal_ac` ⇒ 写入成功、文件落盘、store 提交成功
- [ ] AC6 不误伤：已存在的 delivery-critical 无 `goal_ac` 存量任务被翻状态 ⇒ 放行；无标签 / 非 `tasks/` 路径不触发。给出**真仓库全量任务档**的读数（⛔ 不只 fixture）
- [ ] AC7 第三方不误伤：一个没有 goal 层的工作区里创建一条带 `delivery-critical` 的新任务 ⇒ 不被本条判定拒绝（给出可复跑命令与读数）
- [ ] AC8 单源：写入面判定与检测器 / 钩子共用同一组判定函数（证据 = `import` 或 `export … from` 行本身，⛔ 不是第二份字符串比较）；`judgeStagedDeliveryCritical` 对同一样本的双向读数在改动前后逐字相同
- [ ] AC9 `node --no-warnings --experimental-strip-types plugin/scripts/eligible-no-goal-source-check.ts` exit 0（未把 goal 源塞回 `ready-pool-check.ts` 的准入合取）
- [ ] AC10 `scripts/test.sh` 全量绿（含 AC4–AC7 的正、反、对照断言）（待外部）

## DoD

生产工作树上同时成立三件事，缺一不算完成：

1. **AC-190 判据回到 exit 0，且不是靠放宽判据或摘标签换来的**：默认运行 `violating=[]`、`--inject-unbacked-fixture` 仍非零；那条反例真的有顶层 `goal_ac` 且有理由、`delivery-critical` 标签仍在。
2. **规则在违反发生的那一刻、在写者真正走的那条路上起作用**：经 Provider ABI 创建一条「`delivery-critical` + 无 `goal_ac`」的任务会被**真的拒掉**（文件不落盘），正 / 反 / 对照三类断言实测过。⛔ 只在 git 钩子面再补一条判定不算完成——那正是本条的成因。
3. **不把第三方和存量打死**：没有 goal 层的工作区不被拒；存量任务被翻状态不被拒。

⛔ 只补那一条任务的 `goal_ac` 而不改落点 ⇒ 第三次复发只是时间问题（本 AC 已复发两次，第二次的修法落地 1 天内被真实立案路径再次违反）。
⛔ 把判定塞回 `ready-pool-check.ts` 的 `eligible` 合取 ⇒ 违反人 2026-09-11 裁定，`eligible-no-goal-source-check.ts` 会红。

## Touches

- packages/quay/src/goal-ac-write-face.ts (new)
- packages/quay-native/src/store.ts
- packages/quay-native/test/goal-ac-write-face.test.mjs (new)
- plugin/scripts/long-term-guarantee-goal-backed-check.ts
- plugin/scripts/precommit-guard.ts
- tasks/gap-dist-closure-missing-driver-anchor-js.md
- tasks/gap-ac190-write-face-rule-unreachable-under-no-verify.md
