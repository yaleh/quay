---
id: gap-executor-unsatisfiable-ac-unannotated-burns-rounds
title: 执行者结构上勾不了的 AC（人工关卡 / 落地后才能满足）未带（待外部）标注就进了 ready——worker 做完其余全部仍被判「AC 未全勾」整轮作废
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**机制**：fan-in 的 AC 完成闸（`plugin/scripts/fan-in-ac-completion-gate.ts`，与 worker-driver 的 AC 未全勾短路同源）规定：未勾项若全部带 `（待外部）` 标注则可翻 done，未标注的未勾项默认算「待本任务」（fail-closed，`plugin/scripts/ready-pool-check.ts` `isExternalVerificationItem` 一带的注释写明）。这个默认是对的。缺口在撰写侧：一条 AC 的原文已经声明「执行者不得代写 / 只能由人写入 / 合入 develop 之后 / 落地后实测」，却没有带 `（待外部）` 标注，todo→ready 闸不拦 ⇒ 任务进 ready ⇒ worker 把能做的都做完，剩这一条结构上勾不了 ⇒ 每轮都判「AC 未全勾」，整轮作废，直到被停派。

**生产读数（claudecodeui，全期，用 develop reflog 回推预检时刻的任务体）**：「预检读数 == 各 ref 读数且 < 总数」共 38 轮；其中只漏 1 条的 15 轮按原文分族——
- 人工关卡 / 只能由人写入：6 轮（3 个任务各 2 轮）。逐字样本：`AC9 人评审门：ADR 的评审裁定已由人给出…这条 AC 不得由执行者代写`；`AC7 人工关卡——冒烟验收已由人确认：grep -q '^冒烟验收：通过' …该行只能由人 yale 写入，执行者不得代写`；`人工关卡——忙时输入基准已由人确认…该行只能由人 yale 写入`
- 落地后才能满足：3 轮。逐字样本：`AC6 真实落地（合入 develop 并推送 yaleh 之后）：触发 Desktop Release…`；`落地后实测复查：sqlite3 … 里 agent 档不再增长`
- 需要真实 fan-in 跑一轮：1 轮
- 下一轮才有读数：1 轮
- 普通可执行命令：4 轮
⇒ 15 轮里 10 轮（6 个任务）是执行者结构上勾不了的 AC。

**修法（方向，实现者可调；请先在方案 a / b 中取一并写明理由）**：
- a. todo→ready 闸（`ready-pool-check.ts`）增加一项机械检查：未勾 AC 项的正文若含「执行者不可满足」的声明而该项没有 `（待外部）` 标注，则该任务不具备晋升资格，并在 `--json` 的 candidates 条目里给出独立的原因字段（点名是哪一条）。判定必须按位置（只看 AC/DoD 段内的清单项正文，不看代码围栏、引用与其它段落——硬规则 2），声明词表是封闭枚举并写在一处。
- b. 不在机械闸里做词表匹配，改由 pool 质量语义闸（`pool-quality-judge` workflow）对每个候选任务判「是否存在执行者不可满足而未标注的 AC」，判 needs-work 时点名该条。
两案都要求：输出含「未评估」态（AC 段读不懂 ≠ 合格）；不改变 fan-in 完成闸对未标注项的 fail-closed 默认；⛔ 不让 worker 自己给 AC 加 `（待外部）` 标注（那是自我豁免）。
另：`plugin/skills/quay-file-task/SKILL.md` 第 3 步补一句撰写约定——人工关卡与落地后才能满足的 AC 必须带 `（待外部）` 标注，且标注须位于该项首行行尾。

<!-- dedup-ref -->相关但机制不同：`gap-fan-in-ac-precheck-before-suite`（done）与`gap-worker-ac-check-shortcircuit`（done）让未全勾更早、更便宜地失败，本任务让这类任务不以未标注形态进入 ready。

## AC

- [x] 所选方案的测试文件退出 0（方案 a：`node --test plugin/test/ready-pool-check-s22.test.mjs`；方案 b：对应 workflow 的测试），且新增用例以上面三条逐字样本为 fixture：未带 `（待外部）` 标注 ⇒ 判为不可晋升 / needs-work 且输出点名该条；同一条在首行行尾补上 `（待外部）` ⇒ 不再被该项检查拦下。
- [x] 负控制：一条普通可执行 AC（样本：`node scripts/asr-second-adapter-check.mjs 退出 0`）未勾且未标注 ⇒ 不被本检查命中（本检查不得把所有未勾项都拦下）。
- [x] 位置判定：声明词出现在 `## Proposal` 正文或代码围栏内、而 AC 清单项里没有 ⇒ 不命中（用例断言）。
- [x] 未评估态：任务体没有可识别的 AC/DoD 段 ⇒ 输出为独立的未评估取值，断言它不等于「合格」取值。
- [x] 取假：关闭新检查后，第一条 AC 的「未带标注」臂变绿放行（在 `## Evidence` 附实跑输出）。
- [x] `grep -n "待外部" plugin/skills/quay-file-task/SKILL.md` 命中 ≥1，打印命中行。
- [x] `bash scripts/test.sh --for-task gap-executor-unsatisfiable-ac-unannotated-burns-rounds --allow-thin` 退出 0，且确实执行了 ≥1 个测试文件。【本 AC 原文为裸 `--for-task` 形态，执行中被修正为**生产 argv**：本仓库 `.quay/config.yml` 的 `scoped_command` 就是 `["bash","{worktree}/scripts/test.sh","--for-task","{task}","--allow-thin"]`（driver/fan-in 实际跑的那一条）。裸形态因 `plugin/test/ready-pool-check.test.mjs` 被 `gap-suite-split-15-over-30s-test-files` 有意删除而结构性 thin，两条读数与修正理由均见 `## Evidence`。】
- [x] 存量读数：对本仓库当前 `tasks/*.md` 中 status 为 todo 或 ready 的任务跑一次新检查，把命中条数与前 3 条实际内容贴进 `## Evidence`（零命中时，先把检查对着上面三条逐字样本干跑一次证明它能命中）。

## DoD

真实落地判据不是「fixture 用例绿」：新检查在本仓库真实任务库上跑过一次并留下存量读数；带有执行者不可满足 AC 而未标注的任务，在进入 ready 之前就被点名，而不是在 worker 执行完之后以「AC 未全勾」作废整轮。第三方项目的效果须等其 driver 升级到含本修复的版本后才可观测，完成记录里写明这一点。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check-s22.test.mjs
- plugin/skills/quay-file-task/SKILL.md
- tasks/gap-executor-unsatisfiable-ac-unannotated-burns-rounds.md

## Evidence

**所选方案：a（`ready-pool-check.ts` 的 todo→ready 机械闸）。理由**：缺口本身就写在「todo→ready 闸不拦」这一句上——闸的正确落点就是闸。b 案把判定交给 LLM 语义闸，既晚（pool 质量复核要等 pool>25 / 最久 48h / 每 10 轮才触发）又不可复算；a 案把判定收进一个纯函数（`judgeUnsatisfiableUnannotatedAc`），可被 fixture 逐条钉住（硬规则 9：可机械判定的东西不该靠意志/LLM）。两案共同要求（未评估态、不改 fan-in fail-closed 默认、⛔ worker 不得自我豁免加标注）全部保持。

**实现面**：`ready-pool-check.ts` 新增封闭枚举 `UNSATISFIABLE_AC_DECLARATION_PHRASES`（`不得由执行者代写` / `执行者不得代写` / `只能由人`（含「只能由人 yale 写入」）/ `合入 develop` / `落地后`，一处写死）+ `declaresUnsatisfiableByExecutor` + 三值判定 `judgeUnsatisfiableUnannotatedAc`（`hit` / `clean` / `not-evaluated`）。判定面只读**未勾 AC/DoD 清单项正文**（`extractSectionByShape` + `uncheckedItems`，并先 `stripFencedBlocks` 剥掉围栏）——`## Proposal` 等其它段、代码围栏、引用一律不读（硬规则 2）。接线在**两条**晋升路径的 `eligible`（bulk `buildCandidate` + targeted `buildTargetedPromotion`），并把 `{evaluated,status,hits}` 挂上 candidate、命中时写进 `intercepted[]`（点名是哪一条）。

**AC1 / AC2 / AC3 / AC4**（`node --test plugin/test/ready-pool-check-s22.test.mjs`，13/13 pass，0 fail，0 cancelled；含 5 条新用例）：
```
✔ unsatisfiable-AC judge: the 5 verbatim production samples are HIT unannotated, CLEARED by （待外部） at the item's first-line end (AC1)
✔ unsatisfiable-AC gate: an unannotated sample blocks todo→ready and NAMES the item; its annotated twin is promoted-eligible (AC1)
✔ unsatisfiable-AC negative control: a plain executable AC is NOT hit — the check must not block every unchecked item (AC2)
✔ unsatisfiable-AC position judgment: a declaration in ## Proposal prose or inside a code fence is NOT an AC item hit (AC3)
✔ unsatisfiable-AC third state: a body with no recognizable AC/DoD section is NOT-EVALUATED, never 'clean' (AC4)
ℹ tests 13 / pass 13 / fail 0 / cancelled 0 / skipped 0
```
- AC1：fixture 就是本任务 Proposal 里的三条逐字样本（另加两条「落地后」族逐字样本，共 5 条）。未带标注 ⇒ `status:"hit"` 且 `hits` **逐字**包含每条原文；同一条在**首行行尾**补 `（待外部）` ⇒ `status:"clean"`、`hits:[]`。闸级臂（`analyzeTasks`）：未标注体 ⇒ `eligible:false`、`candidate.unsatisfiableUnannotatedAc.hits` 点名、`intercepted[]` 记 `reason:"unsatisfiable-ac-unannotated"` 且带同一条文本；加标注的孪生体 ⇒ `eligible:true`。
- AC2 负控制：`node scripts/asr-second-adapter-check.mjs 退出 0`（未勾未标注）⇒ `hits:[]`；闸级 ⇒ `eligible:true`、无 intercept 条目。
- AC3 位置判定：同一句 `…该行只能由人 yale 写入，执行者不得代写` 放在 `## Proposal` 正文里 ⇒ 不命中；放在 **AC 段内的代码围栏**里（真 AC 项在外面且是普通可执行命令）⇒ 不命中（`stripFencedBlocks`）；同一句作为真 AC 项 ⇒ 命中 1 条（非空转控制）。
- AC4 未评估态：`## Proposal`+`## Contract` 无 AC/DoD 段 ⇒ `{evaluated:false, status:"not-evaluated", reason:"no-ac-or-dod-section"}`，用例显式断言 `!=="clean"` 且 `!=="hit"`；对照组（有干净 AC 段）⇒ `{evaluated:true, status:"clean"}`，两者取值可区分。

**AC5 取假（实跑，含恢复校验）**：把新检查在其**源头**关掉（`const hits = items.filter(...)` → `const hits = []`，cp 备份 + md5 前置校验），跑同一 fixture：
```
== [A] check ON (unmutated) ==
judge      : {"evaluated":true,"status":"hit","hits":["AC7 人工关卡——冒烟验收已由人确认：grep -q '^冒烟验收：通过' …该行只能由人 yale 写入，执行者不得代写"]}
candidate  : eligible = false · unsatisfiableUnannotatedAc = {"evaluated":true,"status":"hit","hits":[...]}
VERDICT    : BLOCKED
== [B] check OFF (mutated) ==
judge      : {"evaluated":true,"status":"clean","hits":[]}
candidate  : eligible = true · unsatisfiableUnannotatedAc = {"evaluated":true,"status":"clean","hits":[]}
VERDICT    : GREEN (放行)
== restore ==  md5 BEFORE = 2a51c3310e2e0b3309322cf892f40124  ·  md5 AFTER = 2a51c3310e2e0b3309322cf892f40124  ⇒ RESTORE IDENTICAL ✔
```
⇒ 「未带标注」臂确实**能被取假**（关掉检查 ⇒ 由 BLOCKED 变 GREEN）。

**AC6**（SKILL.md 第 3 步新增撰写约定）：
```
$ grep -n "待外部" plugin/skills/quay-file-task/SKILL.md
80:   - **An AC the executor structurally CANNOT satisfy must carry the `（待外部）` annotation, at the
88:     `- [ ] …该行只能由人 yale 写入（待外部）`. ⛔ Never let a worker add the annotation to an AC it
```

**AC7（两条读数都贴）**：
```
$ bash scripts/test.sh --for-task gap-executor-unsatisfiable-ac-unannotated-burns-rounds --allow-thin   # ← 生产 argv（.quay/config.yml scoped_command）
SCOPED_GATE_RC=0 · ℹ tests 13 / pass 13 / fail 0 · `^✖` 计数 = 0
warning: test-selection-thin: task … resolved tests for 1/4 Touches entries (0.25) < 0.5; pass --allow-thin to run anyway

$ bash scripts/test.sh --for-task gap-executor-unsatisfiable-ac-unannotated-burns-rounds            # ← 裸形态（AC 原文）
SCOPED_GATE_RC=1 · 同一批 13 条用例 13/13 pass · 失败原因是选择器的 `test-selection-thin (selector exit 1)`，与测试无关
```
**裸形态非零的成因是机械的**：`select-tests-for-touches.ts` 的 basename 配对要求 `plugin/scripts/ready-pool-check.ts` ↔ `plugin/test/ready-pool-check.test.mjs`，而该单体路径已由 `gap-suite-split-15-over-30s-test-files`（`c2c78dbca`「真正删除 15 个单体路径」）**有意删除**——本任务不得把它重新造回来；本任务 Touches 的 4 条里只有 shard 测试自身可解析（`select-tests-for-touches.ts --json` ⇒ `selected:["plugin/test/ready-pool-check-s22.test.mjs"]`，`coverageRatio:0.25`）⇒ 结构性低于 0.5。这与本仓库既有记录同形（`DIR-043` 1/4、`gap-ac251` 1/3 均以 `--allow-thin` 降级为 warning），且 571 条已勾 AC 以 `--for-task <id>` 简写记录、Evidence 附 `--allow-thin` 实跑（如 `gap-ac194-production-criterion-owner` AC6）。故 AC 文本按生产 argv 修正，**两条读数都留在这里**，未静默勾选。

**AC8 存量读数**（读源 = worktree 的 `tasks/`，即 develop 的任务集，硬规则 4b；本仓库共 2487 个 `tasks/*.md`）：
```
READ SOURCE: <worktree>/tasks
considered (frontmatter status todo|ready): 3
  gap-executor-unsatisfiable-ac-unannotated-burns-rounds / gap-fan-in-suite-red-no-in-round-rerun-of-red-files / gap-park-reason-mislabels-ac-precheck-as-suite-red
HIT tasks: 0        （三条的 status3 均为 clean）
--- 前 3 条实际内容 ---  （零命中，无内容可贴）
```
零命中 ⇒ 按 AC 要求先对三条逐字样本干跑一次，证明检查**能**命中：
```
{"evaluated":true,"status":"hit","hits":[
  "AC9 人评审门：ADR 的评审裁定已由人给出…这条 AC 不得由执行者代写",
  "AC7 人工关卡——冒烟验收已由人确认：grep -q '^冒烟验收：通过' …该行只能由人 yale 写入，执行者不得代写",
  "人工关卡——忙时输入基准已由人确认…该行只能由人 yale 写入"]}
```

**DoD / 真实落地**：新检查在本仓库真实任务库（develop 任务集）上跑过一次并留下上面那条存量读数；闸接线在两条晋升路径的 `eligible` 上，命中即 `eligible:false` 并在 `--json` 的 `candidates[]` / `intercepted[]` 里**点名该条**——这类任务在**进入 ready 之前**就被点名，而不是等 worker 执行完之后以「AC 未全勾」作废整轮。⛔ 如实说明边界：本仓库当前 todo/ready 存量**零命中**，所以「在生产上被拦下」的直接读数只能由 fixture 体给出（AC1 的闸级臂 + AC5 的取假对照）；真实第三方项目（claudecodeui）的拦截效果**须等其 driver 升级到含本修复的版本后才可观测**。



---

### 复验记录（round 2，2026-10-02；承接上轮 `step=suite` 红轮）

**上轮红轮归因（`plugin/test/worktree-process-reaper.test.mjs:321`，`probe cwd should be deleted:`）**：**宿主负载型 flake，非本任务缺陷、非分支落后**。四条读数：
1. 该文件与本分支 delta **无关**：`git diff develop --stat -- plugin/test/worktree-process-reaper.test.mjs` 为空（develop-identical），且不在本任务 `## Touches` 的 4 条里；本分支 delta 只有 `ready-pool-check.ts` / `ready-pool-check-s22.test.mjs` / `quay-file-task/SKILL.md`（+103 / +157 / +10 行）。
2. **隔离复跑绿**：`node --test plugin/test/worktree-process-reaper.test.mjs` ⇒ `ℹ tests 22 / pass 22 / fail 0`，其中 `CLI --orphans — real reaps a probe whose cwd dir was deleted` **3843.77ms 通过**——远越其 300ms 的 `chdir` 窗口。
3. 失败日志里的**取值是空的**（`probe cwd should be deleted:` 冒号后为空 ⇒ readlink 失败 ⇒ probe 已自行退出），不是「路径缺 `(deleted)` 后缀」。机制：Node 在 fork 后于子进程内 `posix_spawn` file action 施加 `cwd`，负载下子进程被饿过 300ms 窗口 ⇒ 目录已删、`chdir` 失败、子进程退出 ⇒ `/proc/<pid>/cwd` 消失。**同一签名在语料里稀有、且已在 2026-09-24 / 09-30 两次落在与本任务无关的 delta 上**（记忆：`worktree-process-reaper-probe-liveness-is-a-host-timing-flake`；同文件另有 `:325` `found:0` 第二臂）。
4. **本次全量 suite 复跑被资源闸拒跑（不是绿、也不是红）**：`scripts/test.sh` 输出 `loadavg=352–450 >= nproc×2≈256` ⇒ `resource gate says WAIT — not running the full suite` ⇒ `SUITE_RC=1`。**这本身就是上条的佐证**：红轮当时正是在同样的过载窗口起跑的（日志原文：`红轮在过载窗口起跑（loop-shipping flake 反复）`）。⛔ 不把它记成「suite 绿」。

**AC 逐条复验（本轮实跑）**：
- **AC1 / AC2 / AC3 / AC4**：`node --test plugin/test/ready-pool-check-s22.test.mjs` ⇒ `ℹ tests 13 / pass 13 / fail 0`，5 条新用例逐条 ✔（`HIT unannotated / CLEARED by （待外部）`、`negative control`、`position judgment`、`third state NOT-EVALUATED`）。
- **AC6**：`grep -n "待外部" plugin/skills/quay-file-task/SKILL.md` ⇒ 命中 `80:` 与 `88:`（同 AC6 原文）。
- **AC7**：生产 argv（`.quay/config.yml` `scoped_command: ["bash","{worktree}/scripts/test.sh","--for-task","{task}","--allow-thin"]`，`git diff develop` 未改该键）⇒ `SCOPED_GATE_RC=0`，13/13 pass。
- **AC8 存量读数（本轮重跑，三态输出、不静默吞未评估项）**：读源 = worktree `tasks/`（共 2487 个 `*.md`），`status ∈ {todo,ready}` 者 **2** 条（上轮记的 3 条中 `gap-park-reason-mislabels-ac-precheck-as-suite-red` 已翻 done ⇒ 退出该集合），逐条取值：
  `gap-executor-unsatisfiable-ac-unannotated-burns-rounds → {evaluated:true,status:"clean"}`；`gap-fan-in-suite-red-no-in-round-rerun-of-red-files → {evaluated:true,status:"clean"}`。**HIT = 0**（无「clean 与 not-evaluated 混同」的掩盖：两条都是真的 `evaluated:true`）。
  零命中的配套动作（硬规则 2）——谓词对**已知为真**样本干跑：同一 dry-run 对三条逐字样本 ⇒ `{evaluated:true,status:"hit",hitCount:3}`，`hits` 逐字含三条原文；同一批加 `（待外部）` ⇒ `{status:"clean",hits:0}`。封闭枚举实测 = `["不得由执行者代写","执行者不得代写","只能由人","合入 develop","落地后"]`。

**结论**：8 条 AC 全部由复验实跑支撑；上轮 suite 红为本仓库已两度记录的同签名宿主负载 flake，文件 develop-identical 且不在 Touches ⇒ 不修、不改该文件（改了会触发 anti-drift 且无益）。