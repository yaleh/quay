---
id: gap-ac939-ledger-binding-regression-lock
title: "AC-939 判据回归锁：绑定台账 filed 的 taskId，且任意带 goal_ac: AC-937 的 done 任务不得替代"
status: todo
labels:
  - gap
  - goal-driver
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-939
---
## Proposal

AC-939 的全部保证活在一段 YAML 标量里：`goals/AC-939-*.md` 的 `criterion`。每轮 goal-driver 都会跑它取读数，但仓库里**没有任何测试执行过这段判据**——同链的三条任务各自只覆盖自己那一面：`gap-goal-filing-chain-audit` 测它的只读审计器，`gap-goal-driver-filing-ledger` 与 `gap-goal-filing-ledger-landing` 测台账的写入面与落地，AC-938 测「绿来自代码而非静态文件」。于是「其它任何带 `goal_ac: AC-937` 的 done 任务不能顶替台账 filed 的 taskId」这句话，至今只在散文里成立：把判据改回 AC-937 那种扫全表的 `taskFiles.some(...)` 形态，不会有任何检查变红——而那正是 AC-937 → AC-939 已经真实发生过的那次回归。

本任务给这段判据加一把可执行的回归锁：从 goal store **读**出 criterion（⛔ 不把判据文本抄进测试——抄一份就是造第二个真相源），在临时工作区里对原文跑正控与四条负控，并做一次**变异负控**（把绑定段换回扫全表形态后，替代品检测必须失效）。没有这次变异负控，这把锁就无法证明自己测的是「绑定」而不是别的，只会是一个永远为真的断言（硬规则 2/4：谓词要对着已知为真的样本干跑一次）。

<!-- dedup-ref -->与 `gap-goal-filing-chain-audit`（读面审计器）、`gap-goal-driver-filing-ledger` / `gap-goal-filing-ledger-landing`（写入面与落地）是同链相邻而非重复：本条不新增任何台账读写器，只把 store 里已有的那份判据跑起来并钉住它的负控；Touches 与其零重叠（`task-granularity-advice.ts` 对这三个 Touches 返回 `peers: []`、`mentions: []`）。

## Plan

1. 判据来源：用 `createGoalStore(path.join(<repoRoot>, 'goals')).get('AC-939')`（经 `packages/quay-native/src/goal-store.ts` 的 re-export 读 Core 的实现，单一真相源）取 `criterion` 原文；取不到或为空 ⇒ 测试红。⛔ 不得在测试里内联一份判据副本。
2. 新增 `plugin/test/ac939-goal-filing-ledger-binding.test.mjs`：每个用例建一个临时工作区（照本仓库既有 `makeWorkspace()` 手法：真 `.quay/config.yml` + `tasks/` + `.quay/goal-filing.jsonl`），在该临时根下以 `execFileSync('node', ['-e', criterion], {cwd: tmpRoot})` 取退出码与 stderr/stdout。判据里的路径是相对路径（`tasks/…`、`.quay/…`），所以 cwd 必须是 fixture 根，不是仓库根。
3. 正控：`filed {ac:'AC-937', taskId:'T'}` + `tasks/T.md` 带 `goal_ac: AC-937` 且 `status: done` ⇒ 退出 0，stdout JSON 的 `filedTaskIds` 含 `T` 且 `allDone:true`。
4. 负控（AC-939 的原文要求）：
   - ① 替代品：`filed {ac:'AC-937', taskId:'T1'}` 而 `tasks/T1.md` 是 `todo`，另置 `tasks/T2.md` 带 `goal_ac: AC-937` 且 `status: done` ⇒ 退出 1，stderr JSON 的 `pending` 恰为 `['T1']`（⛔ 判 0 即回归）。
   - ② `filed` 行没有 `taskId` 字段 ⇒ 退出 1。
   - ③ `taskId` 指向不存在的 `tasks/<id>.md` ⇒ 退出 1 且 `pending` 含该 id。
   - ④ 台账只有 `spawned` 行、无 `filed` 行 ⇒ 退出 1。
5. 变异负控（证明锁在测量）：在内存里把 criterion 的 filed 绑定段（`const ids=[...new Set(...)]` 到 `pending` 计算那一段）替换成 AC-937 的扫全表形态（遍历 `tasks/*.md`，任一文件带 `goal_ac: AC-937` 且 `status: done` 即通过），在负控① 的同一 fixture 上重跑 ⇒ 必须**退出 0**。若变异后仍退出 1，说明负控① 通过的原因与绑定无关，测试自身红并输出「lock is not measuring the binding」。
6. live 读数：在主检出（仓库根为 cwd）上真跑一次同一段 criterion，把命令、退出码、stdout/stderr 逐字写进 `docs/evidence/2026-11-06-ac939-ledger-binding.md`，并写清此刻 `filedTaskIds` 与 `pending` 各是什么、pending 那个任务文件的状态与 `depends_on`——让下一轮判断「翻了没有」不必重新推导。
7. 若新测试需要泳道标注（`@test-group` / `@static-tier`），按 `scripts/test.sh` 头注释（唯一正本）处理；随后跑 `node --test plugin/test/ac939-goal-filing-ledger-binding.test.mjs` 与全量 `bash scripts/test.sh`。

## AC

- [ ] `node --test plugin/test/ac939-goal-filing-ledger-binding.test.mjs` 退出码 0，用例覆盖正控 + 四条负控 + 变异负控，且每个用例名可读地写明它验哪一种形态。
- [ ] 判据单一真相源：测试经 `createGoalStore(<root>/goals).get('AC-939')` 取 `criterion`，测试文件内不含判据正文副本；并断言取到的 criterion 含 `r.ac==='AC-937'` 且**不含** `taskFiles.some`（判据被改回扫全表形态时这条断言直接红）。
- [ ] 负控①逐条可核：`filed` 的 taskId 为 todo 而另有一份 `goal_ac: AC-937` 的 done 任务时，判据退出 1，且 stderr JSON 的 `pending` 恰为 `["T1"]`。
- [ ] 其余三条负控可核：`filed` 行无 `taskId` ⇒ 1；taskId 指向不存在文件 ⇒ 1 且 `pending` 含该 id；只有 `spawned` 行 ⇒ 1。
- [ ] 变异负控可核：把 criterion 的绑定段换成扫全表形态后，负控① 的同一 fixture 从退出 1 变为退出 0（证明锁测的是绑定，不是别的）。
- [ ] live 证据：`docs/evidence/2026-11-06-ac939-ledger-binding.md` 逐字记录主检出上 criterion 的命令与输出，并写明当前 `filedTaskIds` / `pending` 与 pending 任务的状态和 `depends_on`。
- [ ] `bash scripts/test.sh` 全绿。

## DoD

真实交付物是 `plugin/test/ac939-goal-filing-ledger-binding.test.mjs` 这把锁，加上 `docs/evidence/2026-11-06-ac939-ledger-binding.md` 里的真实读数。落地判据：锁在**当前**主检出上跑绿，**且**变异负控能让它翻绿——即它确实能区分「绑定台账 filed 的 taskId」与「任意带 `goal_ac: AC-937` 的 done 任务」这两种判据形态；做不到这一点就说明它只是一个回声，本任务不算落地（硬规则 4：结构上不可能取假的量不是测量）。⚠️ 本条**不**把 AC-939 判成绿：AC-939 的 criterion 要求台账 `filed` 行指向的 `gap-goal-filing-chain-audit` 达到 `status: done`，那是它的翻转路径；本任务只在证据里把这条链的当前读数钉下来，⛔ 不得用替代品、改判据、或改任何任务的 status 让它提前变绿。全量 `bash scripts/test.sh` 绿。

## ADR-007 dark axis

- 该轴仍暗，理由：本任务只新增一个测试文件与一份证据文档，不改动任何模块的依赖边，未产生 L_D/L_G 数值读数。

## Touches

- plugin/test/ac939-goal-filing-ledger-binding.test.mjs (new)
- docs/evidence/2026-11-06-ac939-ledger-binding.md (new)
- tasks/gap-ac939-ledger-binding-regression-lock.md