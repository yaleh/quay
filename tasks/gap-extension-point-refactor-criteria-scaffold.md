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

- [ ] AC1 判据正本四臂齐备：`grep -n '^### 臂' docs/references/ownership-first-refactoring-methodology.md` 输出 4 行，且每臂段落写明「取假方式」（哪一步为红）与它是否活性臂；贴这 4 行与前 3 条命中内容。
- [ ] AC2 脚手架可运行：对一个示例任务 id 运行 `node --experimental-strip-types plugin/scripts/extension-point-criteria.ts --scaffold --task-id <id> --central <file> --outside <module>`，stdout 含四臂占位符、正臂 `triggered=1` 断言模板、以及「本 AC 是单次验收、非常设棘轮」的固定说明，退出码 0；贴完整输出。
- [ ] AC3 检查器四态可分：fixture 单测覆盖 `satisfied` / `missing-arms` / `not-applicable` / `NOT-EVALUATED` 四种输入，且断言 `NOT-EVALUATED` 的输出与 `satisfied` 在**每一个判别字段上都不同**（硬规则 3b）；贴测试文件路径与断言条数。
- [ ] AC4 位置判定负对照：把四臂文字整段放进 `## Proposal` 散文、AC 列表项只写行为判据，检查器必须报 `missing-arms`（不是 `satisfied`）；再把同样四臂写进 AC 列表项，必须报 `satisfied`。贴两次运行的完整输出。
- [ ] AC5 生产载体读数：对主检出 `tasks/*.md` 中所有带 `refactor-slice` 标签（若无则用 `plan` 形状 + 标题含「拆分/切片/重构」）的任务实跑检查器，贴 `{evaluated:true, satisfied:N, missing:N, notApplicable:N}` 计数与前 5 条缺失任务 id。本条只要求读数可复现，**不要求本次把缺失清零**。
- [ ] AC6 skill 可被调用：`plugin/skills/extension-point-refactor/SKILL.md` 存在且经 `plugin/scripts/capability-catalog.sh` 或清单可见；贴清单命令输出中对应行。
- [ ] AC7 目录一致：`bash plugin/scripts/capability-catalog.sh --summary` 自报计数与声明数一致、新增脚本 `0 unclassified`；贴原文。
- [ ] AC8 负臂真空绿被机件拦住：检查器 fixture 里放一份「只有负臂、正臂写成『handler 存在』」的任务体，必须输出 `missing-arms` 且命中项具名到正臂；同一份任务体把正臂改成 `triggered=1` 后才 `satisfied`。贴两次运行的完整输出与 fixture 路径。模板正本中对应三句（正臂断言 `triggered=1` / 只写负臂判无效 / 红线基线是单次 AC 非棘轮）各贴一行原文。
- [ ] AC9 两种占比口径分开记录：`docs/references/ownership-first-refactoring-methodology.md` §13 写明 `centralΔ`（单 commit churn，含删除，claudecodeui 口径）与「中心文件增长占比」（时间窗，只计新增，quay 口径）**不是同一个量、不可互引**，并各给一条公式与一个实例值；贴这两行原文。

## Definition of Done

- 判据正本（四件套：正臂/负臂/注入泄漏/红线基线，含「负臂必须配正臂」与「红线基线是单次 AC 非棘轮」两条定位）与检查器、脚手架、skill 四者同时存在，且检查器至少在一次真实任务上产出过 `satisfied` 或 `missing-arms` 的读数（不是只在 fixture 里跑通）。
- `docs/references/ownership-first-refactoring-methodology.md` §13 的 R0–R3 表补上「方法体 vs 方法壳」读法，并链接本检查器；同节写清 `centralΔ`（单 commit churn，含删除）与「中心文件增长占比」（时间窗，只计新增）不可互引。
- `tasks/DIR-133.md` 裁定 2 处有一行指针指向检查器，规则不再只有散文一份载体。

## Touches

- plugin/scripts/extension-point-criteria.ts
- plugin/scripts/extension-point-criteria-check.ts
- plugin/test/extension-point-criteria-check.test.mjs
- plugin/skills/extension-point-refactor/SKILL.md
- plugin/scripts/capability-catalog-declarations.json
- docs/references/ownership-first-refactoring-methodology.md
- tasks/DIR-133.md
- tasks/gap-extension-point-refactor-criteria-scaffold.md
