---
id: gap-extension-point-refactor-criteria-scaffold
title: 扩展点重构缺判据脚手架——四件套（正臂/负臂/注入泄漏/红线基线）每次靠手抄， 且 methodCount 读数混了方法体与方法壳
status: ready
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源（人 2026-10-22 指示本会话与 claudecodeui 会话「Quay 的 OO 设计重构」通信后立项）**：该会话 2026-10-22 在 claudecodeui 做了 5 刀 OO 重构（driver 读数/结局两刀、ws-proxy 帧路由一刀、前端 hook 一刀、voice 出环一刀），每一刀都**手工补写同一套判据**。它明确表示：archguard 的环/god 检测读现状够用，真正缺的是「扩展点判据四件套」的脚手架。

**四件套（对方原话，逐条记录）**：
1. **正臂**——从中心文件之外注册的 handler 被触发；
2. **负臂**——未注册时不触发；
3. **注入泄漏**——把分派器替换成泄漏实现后，同一断言必须打红；
4. **红线基线**——`wc -l < 基线`，改动前该断言必红。

**quay 侧现状**：`tasks/DIR-133.md` 裁定 2 已规定「设计调查/切片的 AC 必须含扩展点判据」，但**至今零检查器**——它是一条散文规则。这正是 ADR-004 说「只活成散文的规则会被改写掉」的形状。

**发生率（硬规则 12，按代码库计）**：扩展点缺失导致增长回流的实例已在 **3 个代码库**出现——quay worker（`2440b52d0` 之后中心增长占比 82%）、plantuml-js `gap-elk-layout-engine-split-responsibilities`（拆分后 `elk.ts` 570→150 行、数值 AC 全绿，随后 8 个功能提交又长回 278 行，call 出度探针 23→26）、claudecodeui ws-proxy（加了 dispatch 缝但没建扩展点，outDegree 65→66）。≥2 已满足，可以做成可执行检查。

**一个新读数口径缺陷（对方实测，quay 文档尚未记录）**：`methodCount` 在一次职责外移后几乎不降（driver 88→86），因为**公开方法壳留在契约上、只有方法体搬走了**。单看 `methodCount` 会把「有进展」误判成「没进展」——典型的代理量混了两类对象（硬规则 4b）。因此任何脚手架都必须区分「方法体」与「方法壳」，或改用同口径的 call out-degree。

**口径澄清（2026-10-22 对方复核后回答，原说法已由对方撤回）**：claudecodeui 的 `centralΔ` **不是** quay 的「中心文件增长占比」，两者不可比，⛔ 不得互相引用：
- 对方的 `centralΔ` = **单个重构 commit 内**中心文件改动行（insertions+deletions）÷ 该 commit 全部改动行。driver 那一刀：263 / 1275 = 0.206。
- quay 的「中心文件增长占比」= **时间窗内**中心文件行增量 ÷ 窗口内全部文件行增量（**只计新增**）。
- 前者度量「这次重构的 churn 有多少落在中心文件」，删除也算分子；后者度量「后续增长回流中心的比例」。**0.21 回答不了后者**，对方已明确撤回「≈ serve 1% 量级」的比较。

**对方各刀实测（读数口径 = `archguard_summary` 的 `topByOutDegree`，非 cognitive summary；methodCount 同源）**：
- 刀1 driver 读数：文件 6662→6559；刀2 driver 结局：6559→5811。两刀合计：文件 6662→5811、methodCount 88→86、outDegree 203→187、dependentCount 131→130。
- 刀3 ws-proxy 帧路由：文件 6718→6576；`handleVoiceRealtimeConnection` outDegree 65→66（加了 dispatch 缝，+1）。
- 刀4 前端 hook、刀5 voice 出环：已立案未完成，无读数。
- **方法壳不随提取消失的又一例**：刀1 完成后 methodCount 是 88，比先前报告的 87 还 +1，因为读数这一步多出一个 registry 委托壳。

## Plan

1. **判据正本先行**：在 `docs/references/ownership-first-refactoring-methodology.md` §13 增加「扩展点判据四件套」一节，逐臂写清：断言形态、怎么取假（哪一步为红）、哪一臂是活性检查、以及红线基线是单次 AC 而非棘轮（见下）。
   模板文本**定稿前发 claudecodeui 会话「Quay 的 OO 设计重构」审一次**（执行者无跨会话发送能力时，由 manager 会话经 `SendMessage` 代发）（它 2026-10-22 主动要求审），它明确会看三点：(a) 正臂是否写成 `triggered=1`（活性检查）；(b) 负臂 + 注入泄漏臂的定位是否写成「证负臂不真空」；(c) `centralChurnShare` 与「中心文件增长占比」是否真的分键分 basis 存。审阅意见与采纳情况写进提交信息。⛔ 这不是外部阻塞项：若对方 24h 内未答复，按本方审议稿落地，并在任务里记录「未获答复」，不挂起本任务。
2. **红线基线的定位要说清楚**：对方确认 `wc -l < 基线` 是**单次任务 AC**，只在重构任务验收时由 worker 检查一次，任务 done 后永不复评——所以它**不会**在后续增长里恒红，**也不需要重锚规则**。模板必须写明这一点，并显式声明它**不是常设棘轮**；常设棘轮属于设计演进读数例程（`design-evolution-readings.ts`）的领域，不要在这条 AC 里假装拥有它。（本仓库「把行号钉进判据」的历史教训只在**常设**检查上成立，单次 AC 不适用。）
3. **负臂必须配正臂，否则是真空绿**（对方实测结论，必须写进模板）：负臂「未注册不触发」单独看对「注册了但断线」是假绿——断线时 `triggered=0`，负臂照样绿，只是绿错了理由。因此模板规定：
   - **正臂断言的必须是 `triggered=1`（计数）**，不是「handler 存在」；这条正臂就是活性检查，不另配。
   - **只写负臂、不写正臂 ⇒ 判据无效**，检查器应把它算作 `missing-arms` 而不是「已有一条」。
   - 注入泄漏分派器那一臂的作用是证明**负臂断言本身不真空**（不是给正臂兜底）。
4. **脚手架（生成骨架，不写任务体）**：新增 `plugin/scripts/extension-point-criteria.ts`，`--scaffold --task-id <id> --central <file> --outside <module>` 打印 AC/DoD 骨架到 stdout（dry-run；任务体仍只经 ABI 写入）。
5. **检查器**：新增 `plugin/scripts/extension-point-criteria-check.ts`，**按位置**读任务的 AC 列表项（硬规则 2：只读未勾选列表项文本，不读 Proposal 散文、不读代码围栏），四态输出：
   - `satisfied`（四臂齐备）；
   - `missing-arms`（列出缺哪几臂，逐臂具名）；
   - `not-applicable`（任务不是设计切片——无 `refactor-slice` 标签且标题/标签不含切片语义）；
   - `NOT-EVALUATED`（读不到 AC 段）——**必须是独立取值，不得与 `satisfied` 同形**（硬规则 3b）。
6. **skill**：`plugin/skills/extension-point-refactor/SKILL.md`，把「生成骨架 → 填四臂 → 跑检查器 → 落 AC」串成一次调用；优先于新 CLI（对方偏好：模板 + skill/MCP > CLI > 新图）。
7. **登记**：新脚本文档进 `plugin/scripts/capability-catalog-declarations.json`；并在 DIR-133 裁定 2 处补一行指针，指向本任务落地的检查器（避免同一规则出现两份正本）。

## Acceptance Criteria

- [x] AC1 判据正本四臂齐备：`grep -n '^### 臂' docs/references/ownership-first-refactoring-methodology.md` 输出 4 行，且每臂段落写明「取假方式」（哪一步为红）与它是否活性臂；贴这 4 行与前 3 条命中内容。 —— `grep -n '^### 臂'` 输出 4 行，且每臂写明取假方式与是否活性臂（原文：`是否活性臂`：臂1=是，臂2/3/4=否）。
- [x] AC2 脚手架可运行：对一个示例任务 id 运行 `node --experimental-strip-types plugin/scripts/extension-point-criteria.ts --scaffold --task-id <id> --central <file> --outside <module>`，stdout 含四臂占位符、正臂 `triggered=1` 断言模板、以及「本 AC 是单次验收、非常设棘轮」的固定说明，退出码 0；贴完整输出。 —— exit 0；stdout 含四臂占位符、`triggered=1` 断言模板、「本 AC 是单次验收、非常设棘轮」固定说明（完整输出见 Evidence）。
- [x] AC3 检查器四态可分：fixture 单测覆盖 `satisfied` / `missing-arms` / `not-applicable` / `NOT-EVALUATED` 四种输入，且断言 `NOT-EVALUATED` 的输出与 `satisfied` 在**每一个判别字段上都不同**（硬规则 3b）；贴测试文件路径与断言条数。 —— `plugin/test/extension-point-criteria-check.test.mjs`：8 个 test、54 条断言全绿；NOT-EVALUATED 判据内 7 条断言，`evaluated/verdict/applicable/satisfied/四臂` 每个判别字段都与 satisfied 不同。
- [x] AC4 位置判定负对照：把四臂文字整段放进 `## Proposal` 散文、AC 列表项只写行为判据，检查器必须报 `missing-arms`（不是 `satisfied`）；再把同样四臂写进 AC 列表项，必须报 `satisfied`。贴两次运行的完整输出。 —— Proposal 散文版 = `missing-arms` / exit 1；同样四臂写进 AC 列表项 = `satisfied` / exit 0（两次完整输出见 Evidence）。
- [x] AC5 生产载体读数：对主检出 `tasks/*.md` 中所有带 `refactor-slice` 标签（若无则用 `plan` 形状 + 标题含「拆分/切片/重构」）的任务实跑检查器，贴 `{evaluated:true, satisfied:N, missing:N, notApplicable:N}` 计数与前 5 条缺失任务 id。本条只要求读数可复现，**不要求本次把缺失清零**。 —— `{evaluated:true, satisfied:0, missing:34, notApplicable:1891}`（另有 notEvaluated:1019），前 5 缺失 id = `DIR-074, DIR-080, DIR-133, exp5-M-ARCH-AUDIT-M108-EXPLORE, exp5-M-TS-MIGRATION-P0`；本条不要求清零。
- [x] AC6 skill 可被调用：`plugin/skills/extension-point-refactor/SKILL.md` 存在且经 `plugin/scripts/capability-catalog.sh` 或清单可见；贴清单命令输出中对应行。 —— `find plugin/skills -maxdepth 2 -name SKILL.md` 命中 `plugin/skills/extension-point-refactor/SKILL.md`；`plugin/test/plugin-packaging.test.mjs` 的 14 目录清单含 `extension-point-refactor`。
- [x] AC7 目录一致：`bash plugin/scripts/capability-catalog.sh --summary` 自报计数与声明数一致、新增脚本 `0 unclassified`；贴原文。 —— `capability-catalog: 392 scripts | 392 declared | 0 unclassified | 387 ship
capability-catalog: 393 scripts | 393 declared | 0 unclassified | 388 ship   # 合并 develop 后复跑（develop 新增 slice-readings.ts），一致性判据不变`（原文见 Evidence）。
- [x] AC8 负臂真空绿被机件拦住：检查器 fixture 里放一份「只有负臂、正臂写成『handler 存在』」的任务体，必须输出 `missing-arms` 且命中项具名到正臂；同一份任务体把正臂改成 `triggered=1` 后才 `satisfied`。贴两次运行的完整输出与 fixture 路径。模板正本中对应三句（正臂断言 `triggered=1` / 只写负臂判无效 / 红线基线是单次 AC 非棘轮）各贴一行原文。 —— weak fixture（正臂写「handler 存在」）= `missing-arms` 且 `missing:["positive"]`、weak.reason=`named-but-no-count-assertion`；改成 `triggered=1` 后 = `satisfied`（两次输出与三句模板原文见 Evidence）。
- [x] AC9 两种占比口径分开记录：`docs/references/ownership-first-refactoring-methodology.md` §13 写明 `centralΔ`（单 commit churn，含删除，claudecodeui 口径）与「中心文件增长占比」（时间窗，只计新增，quay 口径）**不是同一个量、不可互引**，并各给一条公式与一个实例值；贴这两行原文。 —— §13.6 两条公式各带实例：`centralΔ` 263/1275 = 0.206（单 commit，含删除）；中心文件增长占比 +4,820/(4,820+1,025) = 82.46%（时间窗，只计新增），并显式写明不可互引（原文见 Evidence）。

## Definition of Done

- 判据正本（四件套：正臂/负臂/注入泄漏/红线基线，含「负臂必须配正臂」与「红线基线是单次 AC 非棘轮」两条定位）与检查器、脚手架、skill 四者同时存在，且检查器至少在一次真实任务上产出过 `satisfied` 或 `missing-arms` 的读数（不是只在 fixture 里跑通）。
- `docs/references/ownership-first-refactoring-methodology.md` §13 的 R0–R3 表补上「方法体 vs 方法壳」读法，并链接本检查器；同节写清 `centralΔ`（单 commit churn，含删除）与「中心文件增长占比」（时间窗，只计新增）不可互引。
- `tasks/DIR-133.md` 裁定 2 处有一行指针指向检查器，规则不再只有散文一份载体。

## Evidence

### AC1 — 判据正本四臂（4 行命中 + 前 3 段原文）

```
$ grep -n '^### 臂' docs/references/ownership-first-refactoring-methodology.md
241:### 臂 1 — 正臂（positive arm）：从中心文件之外注册的 handler 被触发
248:### 臂 2 — 负臂（negative arm）：未注册时不触发
256:### 臂 3 — 注入泄漏（injection leak）：把分派器替换成泄漏实现后，同一断言必红
263:### 臂 4 — 红线基线（red-line baseline）：改动前 `wc -l <基线>` 的断言必红
```

前 3 段（各含「取假方式」与「是否活性臂」）：

```
### 臂 1 — 正臂（positive arm）：从中心文件之外注册的 handler 被触发
**断言形态**：从 `<outside>` 注册一个新的处理单元、**不修改** `<central>`，运行后读数必须是 **`triggered=1`（计数）**——不是「handler 存在」。
**取假方式**：删掉/断线外部注册后同一断言读数为 `triggered=0` ⇒ 本条必红。红色落点是「注册被移除/接线断开」这一步。
**是否活性臂**：**是**。这条正臂就是活性检查，不另配一条；负臂不能替代它。

### 臂 2 — 负臂（negative arm）：未注册时不触发
**断言形态**：同一个断言在【未注册】时读数为 `triggered=0`。
**取假方式**：分派器泄漏/无条件调用时，`triggered=0` 必红。
**是否活性臂**：**否**（它是真空绿的来源，必须配正臂）。⚠️ 负臂单独看，对「注册了但断线」是**假绿**——断线时 `triggered=0`，负臂照样绿，只是绿错了理由。因此：**只写负臂、不写正臂 ⇒ 判据无效**，检查器判 `missing-arms` 并具名到正臂；负臂只有在与一条 counted 正臂（`triggered=1`）成对时才被接受。

### 臂 3 — 注入泄漏（injection leak）：把分派器替换成泄漏实现后，同一断言必红
**断言形态**：把 `<central>` 的分派器替换成泄漏实现（无视注册表、无条件调用），臂 1 / 臂 2 的同一断言必须打红。
**取假方式**：替换后仍绿 ⇒ 该臂没测到分派器，判红。
**是否活性臂**：**否**。它的作用是证明**负臂断言本身不真空**（不是给正臂兜底）。
```

### AC2 — 脚手架完整输出（`--scaffold --task-id EX-SLICE-1 --central packages/quay/src/serve.ts --outside src/serve/handlers/registry.ts`，exit 0）

```
<!-- extension-point-criteria scaffold — generated by plugin/scripts/extension-point-criteria.ts -->
<!-- task: EX-SLICE-1 ; central: packages/quay/src/serve.ts ; outside: src/serve/handlers/registry.ts -->
<!-- dry-run: paste the AC block below into the task's ## Acceptance Criteria through Provider ABI task_write. -->

## Acceptance Criteria

<!-- 扩展点判据四件套 — paste these four items into the task's own Acceptance Criteria via task_write. -->

- [ ] 正臂（活性检查）：从 src/serve/handlers/registry.ts 注册一个新的处理单元、不改 packages/quay/src/serve.ts，运行后读数必须是 triggered=1（计数断言，不是「handler 存在」）。取假方式：删掉/断线 src/serve/handlers/registry.ts 的注册后同一断言读数为 triggered=0 ⇒ 本条必红。**这条正臂就是活性检查，不另配。**
- [ ] 负臂：同一个断言在【未注册】时读数为 triggered=0，并同时断言 handlerRegistered=false（注册表确认无此 handler——把「unregister 真被 gate 掉」与「unregister 没生效但恰好被正臂拦住」两条绿路拆开）。取假方式：分派器泄漏/无条件触发时该断言必红。⚠️ 负臂必须与一条 counted 正臂（triggered=1）成对；**只写负臂、不写正臂 ⇒ 判据无效**，检查器判 missing-arms。
- [ ] 注入泄漏：把 packages/quay/src/serve.ts 的分派器替换成泄漏实现（无视注册表、无条件调用），上一臂/正臂的同一断言必须打红。取假方式：替换后仍绿 ⇒ 该臂没测到分派器。它的作用是证明【负臂断言本身不真空】，不是给正臂兜底。
- [ ] 红线基线：改动前记录 `wc -l packages/quay/src/serve.ts` 的基线（<填基线行数>），并断言改动后的中心文件行数 < 基线；在改动前跑该断言必须为红。取假方式：基线前跑不红 ⇒ 断言没测到那次增长。**本 AC 是单次验收、非常设棘轮**，不是常设检查。

### 固定说明

本 AC 是单次验收、非常设棘轮：红线基线只在本次重构任务验收时由 worker 检查一次，任务 done 后永不复评，不进入常设检查链，也不需要重锚规则。常设棘轮属于设计演进读数例程（design-evolution-readings.ts）的领域，本 AC 不假装拥有它。

### 落 AC 前自检

```bash
node --experimental-strip-types plugin/scripts/extension-point-criteria-check.ts --task-id EX-SLICE-1 --json
```

四态读法：satisfied（四臂齐备）/ missing-arms（逐臂具名缺哪几臂）/ not-applicable（不是设计切片）/ NOT-EVALUATED（AC 段读不到，独立取值，不得与 satisfied 同形）。
```

### AC3 — 测试文件与断言条数

- 文件：`plugin/test/extension-point-criteria-check.test.mjs`
- `node --test plugin/test/extension-point-criteria-check.test.mjs` ⇒ `tests 8 / pass 8 / fail 0`；全文件 `assert.` 54 条。
- AC3 判据（`NOT-EVALUATED is a distinct value...`）内 7 条断言：`verdict`/`reason` 2 条 equal + `evaluated`/`verdict`/`applicable`/`satisfied`/四臂 5 条 notEqual（四臂循环逐臂断言）——每个判别字段都与 `satisfied` 不同。

### AC4 — 位置判定负对照（两次完整输出）

fixture 目录：`/tmp/epc-evidence-Jb8PhM/`

第一次：四臂整段放 `## Proposal` 散文，AC 列表项只写行为判据（`ac4-prose.md`）：

```json
{"evaluated":true,"verdict":"missing-arms","applicable":true,"satisfied":false,"arms":{"positive":false,"negative":false,"injectionLeak":false,"redLineBaseline":false},"missing":["positive","negative","injectionLeak","redLineBaseline"],"missingLabels":["正臂","负臂","注入泄漏","红线基线"],"missingArms":[{"arm":"positive","label":"正臂","question":"从中心文件之外注册的 handler 被触发了吗（计数断言 triggered=1，不是「handler 存在」）？"},{"arm":"negative","label":"负臂","question":"未注册时确实不触发吗（且与一条 counted 正臂成对，否则是真空绿）？"},{"arm":"injectionLeak","label":"注入泄漏","question":"把分派器换成泄漏实现后，同一断言会打红吗（证明负臂不真空）？"},{"arm":"redLineBaseline","label":"红线基线","question":"改动前 `wc -l <中心文件>` 的基线断言为红吗（单次验收，非常设棘轮）？"}],"weak":[],"acItems":1,"taskId":"ac4-prose","taskFile":"/tmp/epc-evidence-Jb8PhM/ac4-prose.md","status":"fail","ok":false,"message":"missing-arms — ac4-prose: missing 正臂 / 负臂 / 注入泄漏 / 红线基线"}
EXIT=1
```

第二次：同样四臂写进 AC 列表项（`ac4-in-ac.md`）：

```json
{"evaluated":true,"verdict":"satisfied","applicable":true,"satisfied":true,"arms":{"positive":true,"negative":true,"injectionLeak":true,"redLineBaseline":true},"missing":[],"missingLabels":[],"missingArms":[],"weak":[],"acItems":4,"taskId":"ac4-in-ac","taskFile":"/tmp/epc-evidence-Jb8PhM/ac4-in-ac.md","status":"pass","ok":true,"message":"satisfied — ac4-in-ac: 四臂齐备 (正臂 / 负臂 / 注入泄漏 / 红线基线)"}
EXIT=0
```

### AC5 — 生产载体读数（主检出 `tasks/*.md`）

```
$ node --experimental-strip-types plugin/scripts/extension-point-criteria-check.ts --scan --tasks-dir /data/home/yale/work/quay/tasks --json
{"evaluated":true,"tasksDir":"/data/home/yale/work/quay/tasks","satisfied":0,"missing":34,"notApplicable":1891,"notEvaluated":1019,"missingIds":["DIR-074","DIR-080","DIR-133","exp5-M-ARCH-AUDIT-M108-EXPLORE","exp5-M-TS-MIGRATION-P0"],"status":"pass","ok":true,"message":"extension-point criteria over /data/home/yale/work/quay/tasks: satisfied=0 missing=34 notApplicable=1891 notEvaluated=1019 | first missing: DIR-074, DIR-080, DIR-133, exp5-M-ARCH-AUDIT-M108-EXPLORE, exp5-M-TS-MIGRATION-P0"}
```

`refactor-slice` 标签在主检出 0 个任务携带（唯一命中是本任务正文的自述），因此按 AC5 的 fallback（标题含「拆分/切片/重构」）判定适用性。

合并 develop 后在 worktree（@ 246ee92d5）复跑同一条命令（tasksDir 不变）：`{"evaluated":true,"satisfied":0,"missing":34,"notApplicable":1892,"notEvaluated":1019}`——期间新增一个任务体使 notApplicable +1；`missing=34` 与缺失 id 前 5 条均不变。

### AC6 — skill 可见

```
$ find plugin/skills -maxdepth 2 -name SKILL.md | sort
...
plugin/skills/extension-point-refactor/SKILL.md
...
```

`plugin/test/plugin-packaging.test.mjs` 的 14 目录清单已含 `'extension-point-refactor'`（第 108 行）。

### AC7 — 目录一致

```
$ bash plugin/scripts/capability-catalog.sh --summary
capability-catalog: 392 scripts | 392 declared | 0 unclassified | 387 ship
```

### AC8 — 负臂真空绿被机件拦住（两次完整输出 + 三句模板原文）

fixture：`/tmp/epc-evidence-Jb8PhM/ac8-weak.md`（正臂写成「handler 存在」）⇒

```json
{"evaluated":true,"verdict":"missing-arms","applicable":true,"satisfied":false,"arms":{"positive":false,"negative":true,"injectionLeak":true,"redLineBaseline":true},"missing":["positive"],"missingLabels":["正臂"],"missingArms":[{"arm":"positive","label":"正臂","question":"从中心文件之外注册的 handler 被触发了吗（计数断言 triggered=1，不是「handler 存在」）？"}],"weak":[{"arm":"positive","label":"正臂","reason":"named-but-no-count-assertion","item":"正臂：从外部注册的 handler 存在。"}],"acItems":4,"taskId":"ac8-weak","taskFile":"/tmp/epc-evidence-Jb8PhM/ac8-weak.md","status":"fail","ok":false,"message":"missing-arms — ac8-weak: missing 正臂 (weak: 正臂=named-but-no-count-assertion)"}
EXIT=1
```

同一份任务体把正臂改成 `triggered=1`（`/tmp/epc-evidence-Jb8PhM/ac8-strong.md`）⇒

```json
{"evaluated":true,"verdict":"satisfied","applicable":true,"satisfied":true,"arms":{"positive":true,"negative":true,"injectionLeak":true,"redLineBaseline":true},"missing":[],"missingLabels":[],"missingArms":[],"weak":[],"acItems":4,"taskId":"ac8-strong","taskFile":"/tmp/epc-evidence-Jb8PhM/ac8-strong.md","status":"pass","ok":true,"message":"satisfied — ac8-strong: 四臂齐备 (正臂 / 负臂 / 注入泄漏 / 红线基线)"}
EXIT=0
```

模板正本三句原文（`docs/references/ownership-first-refactoring-methodology.md` §13.5）：

```
**断言形态**：从 `<outside>` 注册一个新的处理单元、**不修改** `<central>`，运行后读数必须是 **`triggered=1`（计数）**——不是「handler 存在」。
因此：**只写负臂、不写正臂 ⇒ 判据无效**，检查器判 `missing-arms` 并具名到正臂；负臂只有在与一条 counted 正臂（`triggered=1`）成对时才被接受。
**本臂是单次任务 AC，不是常设棘轮**：只在重构任务验收时由 worker 检查一次，任务 done 后永不复评，因此它**不会**在后续增长里恒红，**不需要重锚规则**。
```

### AC9 — 两种占比口径分开记录（原文两行）

```
- **`centralChurnShare`（canonical 键名；claudecodeui 口径；单 commit churn，含删除。早期写作 `centralΔ`——`Δ` 易被读成「净变化」，故 canonical 键名取 `centralChurnShare`）** = (该 commit 内中心文件的 insertions + deletions) ÷ (该 commit 全部文件的 insertions + deletions)。实例：driver 那一刀 263 / 1275 = 0.206。
- **中心文件增长占比（quay 口径；时间窗，只计新增）** = 窗口内中心文件新增行 ÷ (中心文件新增行 + 非中心文件新增行)。实例：`worker-history` 基线 `2440b52d0` → `ff32d031d`，中心 +4,820 ÷ (4,820 + 1,025) = 82.46%；同一公式在 serve 上得 1.31%（10-22T00:40Z 记录：中心 +153 ÷ (+153 + +11,534)，分母 = 中心 + 非中心新增行；早期「serve 1%」是该值的取整基线）。
```

同节显式结论：「不是同一个量，⛔ 不得互相引用」。

### 审阅意见与采纳（claudecodeui 会话「Quay 的 OO 设计重构」，2026-10-22）

- (a) 正臂 = 计数 `triggered=1` 的活性检查、不另配 —— ✓ 无异议，未改。
- (b) 负臂建议同时断言伴生读数 `handlerRegistered=false` —— **已采纳**：模板 §13.5 臂 2、脚手架负臂行、skill 都加入该伴生读数（把「unregister 真被 gate 掉」与「unregister 没生效但恰好被正臂拦住」两条绿路拆开）；检查器的臂身份判定仍以臂名 + counted 正臂为准，AC8 的真空绿契约不变。
- (c1) 键名 `centralΔ` → `centralChurnShare` —— **已采纳**：canonical 键名改为 `centralChurnShare`，`centralΔ` 记为早期拼写（`Δ` 易被读成净变化，而本量含删除）。
- (c2) serve 实例数值自查 —— 正本载体 10-22T00:40Z 记录为 +153 ÷ (+153 + +11,534) = 1.31%（分母 = 中心 + 非中心新增行）；文档已显式写出该 basis，并注明早期「serve 1%」是其取整基线。0.98% 来自另一个 15,644 行分母，不是本公式的 basis。
- 采纳情况同步写进提交 `b7ecf5dba`。

## Touches

- plugin/scripts/extension-point-criteria.ts
- plugin/scripts/extension-point-criteria-check.ts
- plugin/test/extension-point-criteria-check.test.mjs
- plugin/test/plugin-packaging.test.mjs
- plugin/.claude-plugin/plugin.json
- plugin/skills/extension-point-refactor/SKILL.md
- plugin/scripts/capability-catalog-declarations.json
- docs/references/ownership-first-refactoring-methodology.md
- tasks/DIR-133.md
- tasks/gap-extension-point-refactor-criteria-scaffold.md

## Dark-axis record (ADR-007)

- L_D 本任务 diff（`git diff --numstat develop...HEAD`，2026-10-22 合并 develop 后在 worktree 实测） codeLines=820 docLines=180 ratio=4.6:1（code-heavy 是本任务形态：检查器 + 脚手架 + 夹具 + 模板正本）
- L_G import-graph-check（结构性代理；`node --experimental-strip-types plugin/scripts/import-graph-check.ts . --json`，worktree @ 246ee92d5） files=498 edges=1475 valueEdges=1343 typeEdges=132 valueSccs=0 typeSccs=0 reverseEdges=0 kernelViolations=0 gateLayerViolations=0 evaluated=true

## Blocker

**2026-10-22T03:48:21.895Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=dark-axis: dark-axis (ADR-007 per-milestone predicate) refused the flip — MISSING: MISSING — the task body records no L_D/L_G reading (a numeric quantity at an axis-anchored line) and carries no explicit "该轴仍暗,理由:<...>" declaration. ADR-007 requires one or the other before the task may be called done.
- run_id：wk-prod-anchor
