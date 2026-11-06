---
id: gap-ac940-exit-condition-contradiction
title: AC-940 退出条件矛盾可见化：跨 AC 反证成为第五类 divergence + GOAL-914 退出条件纳入 AC-938 + 判据回归锁
status: ready
labels:
  - gap
  - meta-driver
  - goal-driver
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-940
---
## Proposal

**现状读数（2026-11-06 在主检出上实测，非转述）**

- AC-940 判据原样执行 ⇒ exit 1，stderr 逐字：`{"AC934":"achieved","AC938":"active","contradiction":"achieved AC whose evidence AC is red"}`。
- `plugin/scripts/meta-driver.ts:146` 的 `DivergenceKind` 只有四类，且 `computeDivergences`（同文件 :342）逐条只看**单条** AC 的 `status × verdict` —— 没有任何一类是**跨 AC** 的，所以上面这个矛盾在每轮 `readings.divergences` 里保持为空。
- `goals/GOAL-914-…md` 的 `## 退出条件` 节只写 AC-934..937，**不点名** AC-938 —— 目标自己的书面契约没有写下「哪条 AC 会否证我的主结论」。
- 两点必须写清楚，避免夸大：① I2（`goalAchievedFromRecords` → `inScopeAcsOf`，`plugin/scripts/goal-driver.ts:904-931`）今天**确实**挡着 GOAL-914 翻 `achieved`（AC-938 / AC-940 都是 active 且在域），所以此刻不存在「假 achieved 的 GOAL」；缺的是**可见性**与**书面契约**，不是翻转闸。② 让 AC-938 翻绿的是 `gap-goal-filing-ledger-landing`（ready，`goal_ac: AC-938`）的落地工作 —— ⛔ 本任务不重做落地，也不改任何 AC 的 status 或 criterion。
- 第三条同源缺口：AC-940 的判据**没有任何测试执行过它**。同链的 `gap-ac939-ledger-binding-regression-lock` 已给 AC-939 立过「从 store 读原文 + 正负控 + 变异负控」的锁，AC-940 一把都没有。

**本任务做什么**：把「一条已 achieved 的 AC 被它自己声明的替代者反证」变成**每轮可见的一类读数**（第五类 divergence —— 枚举、不是布尔、不是计数），把 AC-938 / AC-940 写进 GOAL-914 的 `## 退出条件`，并给 AC-940 判据立一把能取假的回归锁。

**为什么加一类 divergence 而不是新造一个 readings 字段**：`DIVERGENCE_HANDLER_KIND` 是 `Record<DivergenceKind, string>`，加 kind 会**编译期强制**给出处理者三态的决定；handler 路由 / recurrence / digest / probe 规格四套既有机制直接复用；⛔ 不新增第五个 carrier。

**误报纪律（必须写进代码注释，否则这条会变成每轮都在的噪声）**：`supersedes` 关系本身**不等于**矛盾 —— 「替代者尚未达成」在一个正常重构窗口里同样成立。本类只声明**读数**（谁声明取代谁、双方此刻状态各是什么），由语义半判定是否良性；确定性逃逸口有两条：让替代者达成，或把旧 AC 退役成 `superseded`（那时它已不在承诺态）。

<!-- dedup-ref -->**与既有任务的关系（相关但机制不同，决定 separate）**：`gap-goal-filing-ledger-landing`（ready，AC-938 落地）、`gap-goal-driver-filing-ledger`（ready，AC-934 台账实现）、`gap-meta-goaldriverchildtimeoutms`（第四类 `not-evaluated` 的先例）、`gap-goal-achieved-but-failing-no-handler`（handler 路由先例）。`task-granularity-advice.ts` 在本任务 Touches 上返回的 `peers` 是前两条 + `gap-meta-synchealth-doc-to-develop-outcome-invisible`，共享文件只有 `plugin/scripts/meta-driver.ts`（及 `plugin/probes/meta-driver.md`）—— 那是**调度串行化**，不是同一机制，故不合并。

## Plan

1. **读数面（meta-driver）**：给 `CriterionReading` 加两字段 `supersedes: string[]` / `supersededBy: string[]`，在 `collectReadings`（:1124 那段）从**同一批** `listGoalRecords` 记录里填充 —— ⛔ 不新增第二次 store 读（那是白花一次读面成本，且两次读可能不同步）。今天就能看到真实的两向漂移：AC-938 的 `supersedes: ["AC-934"]`，而 AC-934 的 `supersededBy: []`。⛔ 不许把单向不一致静默当成「没有关系」（硬规则 5/3b）：取两向并集，并在 `reason` 里带 `direction:"one-way"`，让漂移本身可见。
2. **新增第五类**：`DivergenceKind` 加 `achieved-but-superseder-unmet`；在 `computeDivergences` 里作为**第二遍**实现（跨 AC 判定需要整批读数），**不改动**第一遍既有四类的分支与顺序（既有测试一条都不能改）。判定写全：X.status==="achieved" ∧ ∃Y≠X 同 goal：Y 声明取代 X ∧ Y.status!=="achieved" ⇒ 一条 divergence（`id`=X.id，`reason` 枚举 Y 的 id 与 status）。
3. **handler**：在 `DIVERGENCE_HANDLER_KIND` 里为它填值并**写清理由**（`Record` 类型会强制你填）。今天的消解路径是「落地替代者」或「人把旧 AC 退役」，都不是 driver 一轮能做的 ⇒ 倾向 `"none"`，但⛔ 必须把理由写成注释；若选 `"goal"`，必须论证 goal-driver 的重跑能翻替代者。
4. **读面文档**：`plugin/probes/meta-driver.md` 的 kind 清单（:45 附近）与 JSON 示例（:298 附近）加第五类，并加一句「语义半怎么对待它」—— ⛔ 不许让 probe 把它读成「已实现」或「已退役」。
5. **GOAL-914 退出条件**：经 goal store 自己的写入面（`quay goal write` / MCP `goal_write`）把 `## 退出条件` 一节补上 AC-938（台账写入代码真的在工作区树上）与 AC-940（两者冲突时 GOAL 不得退出）。⛔ 不手搓 frontmatter；body 其余节逐字保留，写完 `git diff goals/` 必须**只**显示这一节的变化。
6. **判据回归锁**：新增 `plugin/test/ac940-exit-condition-contradiction.test.mjs`。判据**从 store 读**（`createGoalStore(<root>/goals).get('AC-940').criterion`，经 `packages/quay-native/src/goal-store.ts` 的 re-export，单一真相源），⛔ 测试里不内联副本。执行器用 `spawnSync('bash', ['-c', criterion], {cwd: root})` —— 判据正文本身是一整条 `node -e "…"` shell 命令，喂给 `node -e` 会把字面量当 JS ⇒ 恒假（`gap-ac939-ledger-binding-regression-lock` 的 Plan 已记过这次偏离）。每个用例在临时工作区（真 `.quay/config.yml` + `tasks/` + `goals/`）里造 AC-934 / AC-938 的 status 组合。
7. **meta-driver 单测**：在 `plugin/test/meta-driver.test.mjs` 补 (a) achieved + 替代者 active ⇒ 恰一条新 kind、id=旧 AC、reason 含替代者 id；(b) 替代者 achieved ⇒ 零条；(c) 旧 AC active ⇒ 零条；(d) 无 supersede 关系 ⇒ 零条；(e) 单向 / 双向漂移各一例；(f) 既有四类行为不变（同输入下新旧输出只在新增类上不同）。
8. **live 证据**：`docs/evidence/2026-11-06-ac940-exit-condition-contradiction.md` 逐字记录 ① AC-940 判据在主检出的命令 / exit / stderr；② 在主检出跑一次 `collectReadings`（或等价最小读面）后 `readings.divergences` 里新增的那一条（应为 id=AC-934、kind=achieved-but-superseder-unmet、reason 点名 AC-938）；③ GOAL-914 `## 退出条件` 改后全文 + `git diff goals/`；④ AC-940 翻绿的 unpark 命令与它此刻仍为 1 的事实。
9. **suite**：`bash scripts/test.sh` 绿；新测试若需泳道 / 静态分层标注，按 `scripts/test.sh` 头注释（唯一正本）处理。

## AC

- [ ] `node --test plugin/test/ac940-exit-condition-contradiction.test.mjs` 退出码 0；四个控制臂各自命名并写明形态：(934 achieved, 938 achieved) ⇒ 0；(achieved, active) ⇒ 1 且 stderr JSON 同时含 `AC934` 与 `AC938` 两个状态；(active, active) ⇒ 0；(938 记录缺失) ⇒ 2。
- [ ] 单一真相源可核：`grep -c "achieved AC whose evidence AC is red" plugin/test/ac940-exit-condition-contradiction.test.mjs` 为 `0`，且测试内断言从 store 读到的 criterion 非空并含 `AC938`（判据被改坏或取不到时直接红）。
- [ ] 变异负控可核：在内存里把判据的冲突分支 `b!=='achieved'` 换成 `false` 后，同一个 (achieved, active) fixture 必须从 exit 1 变成 exit 0；若仍为 1，测试自红并输出「lock is not measuring the conflict branch」（证明这把锁测的是冲突分支，不是别的）。
- [ ] 新 kind 可执行可核：`node --experimental-strip-types --input-type=module -e "import {computeDivergences} from './plugin/scripts/meta-driver.ts'; …"` 用三条合成读数输出**恰一条** `kind:"achieved-but-superseder-unmet"`，同一段命令内 (b)(c)(d) 三个负控各为零条，退出码 0。
- [ ] handler 决定留痕：`grep -n "achieved-but-superseder-unmet" plugin/scripts/meta-driver.ts` 命中 ≥3 处（类型 / 判定 / 映射），且 `DIVERGENCE_HANDLER_KIND` 该条旁有写明理由的注释（⛔ 不许只填值）。
- [ ] `node --test plugin/test/meta-driver.test.mjs` 退出码 0，且新增用例覆盖 Plan 7 的 (a)-(f) 六种形态（用例名可读地写明形态）。
- [ ] GOAL-914 的 `## 退出条件` 节同时含 `AC-938` 与 `AC-940`：用一段**按节取文本**的 node 检查（⛔ 不用整文件 `grep AC-938` —— `## 范围` 节也提到它，整文件 grep 会假通过，硬规则 2 按位置判定），且 `git diff goals/` 中该文件只有 `## 退出条件` 一节发生变化。
- [ ] `plugin/probes/meta-driver.md` 的 kind 清单与 JSON 示例都含第五类（`grep -c "achieved-but-superseder-unmet" plugin/probes/meta-driver.md` ≥ 2），并有一句语义半的处置指引。
- [ ] live 证据：`docs/evidence/2026-11-06-ac940-exit-condition-contradiction.md` 逐字含 ① 判据命令 + exit 1 + stderr 全行、② 主检出上新增的那条 divergence（id / kind / reason）、③ 改后的退出条件节全文与 `git diff`、④ unpark 命令；读数必须来自主检出（⛔ 不能只用 fixture / 临时工作区）。
- [ ] `bash scripts/test.sh` 退出码 0。
- [ ] AC-940 判据在主检出退出 0（= AC-938 落地后自动成立，本任务不含落地工作）（待外部）

## DoD

真实交付物是**四件真实对象**，不是四份说明：① `readings.divergences` 在**主检出**上真的多出那条 id=AC-934 的 `achieved-but-superseder-unmet`（读生产载体，不是 fixture 回显 —— 硬规则 4 推论三：把 fixture 关掉后仍能取到的读数才算测量）；② `goals/GOAL-914-…md` 这个**真**目标记录的 `## 退出条件` 真的点名了 AC-938 / AC-940（diff 只此一节）；③ 一把能取假的锁 —— 把判据的冲突分支改成恒假后同一 fixture 必须翻绿，做不到即视为回声、本任务不算落地；④ 证据文档里 AC-940 判据此刻仍 exit 1 的原始读数与 unpark 命令。

⛔ 三条红线：不改 AC-934 / AC-938 / AC-940 任何一条的 `status` 或 `criterion` 来让判据变绿（那正是 AC-940 要防的事）；不用任何替代品（另写一条扫全表的检查、或拿别的 AC 顶替）；不把「本任务已完成」等同于「AC-940 已翻绿」—— 翻绿要等 AC-938 落地（待外部），本任务只保证那时它是**自动**翻绿、且此前不会每一轮都隐形。全量 `bash scripts/test.sh` 绿。

## ADR-007 dark axis

- 该轴仍暗，理由：本任务只在 meta-driver 的读数层加一个派生 kind、改一份目标记录的正文一节、新增一个测试与一份证据文档；不新增模块间依赖边、不引入新 carrier，未产生 L_D/L_G 数值读数。

## Touches

- plugin/scripts/meta-driver.ts
- plugin/probes/meta-driver.md
- plugin/test/meta-driver.test.mjs
- plugin/test/ac940-exit-condition-contradiction.test.mjs (new)
- docs/evidence/2026-11-06-ac940-exit-condition-contradiction.md (new)
- goals/GOAL-914-goal-driver-自驱闭环-立案生命周期-下一步投影与请求消费-quay-native.md
- tasks/gap-ac940-exit-condition-contradiction.md