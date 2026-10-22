---
id: gap-extension-point-refactor-criteria-scaffold
title: 扩展点重构缺判据脚手架——四件套（正臂/负臂/注入泄漏/红线基线）每次靠手抄，且 methodCount 读数混了方法体与方法壳
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

**待验证（已向对方发出澄清，回答未到，⛔ 不得当作已有结论）**：对方报「扩展点成立时 centralΔ 0.21（≈ quay serve 的 1% 量级）」。0.21 与 1% 不是同一量级，两边的 `centralΔ` 很可能不是同一定义。在对方给出公式（分子/分母/时间窗口）之前，**本任务不引用 0.21 作为与 serve 1% 可比的证据**。

## Plan

1. **判据正本先行**：在 `docs/references/ownership-first-refactoring-methodology.md` §13 增加「扩展点判据四件套」一节，逐臂写清：断言形态、怎么取假（哪一步为红）、以及**红线基线的重锚规则**（见下）。
2. **红线基线不得变成恒红**：`wc -l < 基线` 在后续正常增长下必然失效。模板必须要求写明：(a) 基线钉在哪个提交；(b) 何时允许重锚、由谁重锚；(c) 重锚后旧基线作废的记录落在哪。同族先例见本仓库「把行号/行数钉进判据」的历史教训。
3. **脚手架（生成骨架，不写任务体）**：新增 `plugin/scripts/extension-point-criteria.ts`，`--scaffold --task-id <id> --central <file> --outside <module>` 打印 AC/DoD 骨架到 stdout（dry-run；任务体仍只经 ABI 写入）。
4. **检查器**：新增 `plugin/scripts/extension-point-criteria-check.ts`，**按位置**读任务的 AC 列表项（硬规则 2：只读未勾选列表项文本，不读 Proposal 散文、不读代码围栏），四态输出：
   - `satisfied`（四臂齐备）；
   - `missing-arms`（列出缺哪几臂，逐臂具名）；
   - `not-applicable`（任务不是设计切片——无 `refactor-slice` 标签且标题/标签不含切片语义）；
   - `NOT-EVALUATED`（读不到 AC 段）——**必须是独立取值，不得与 `satisfied` 同形**（硬规则 3b）。
5. **skill**：`plugin/skills/extension-point-refactor/SKILL.md`，把「生成骨架 → 填四臂 → 跑检查器 → 落 AC」串成一次调用；优先于新 CLI（对方偏好：模板 + skill/MCP > CLI > 新图）。
6. **登记**：新脚本文档进 `plugin/scripts/capability-catalog-declarations.json`；并在 DIR-133 裁定 2 处补一行指针，指向本任务落地的检查器（避免同一规则出现两份正本）。

## Acceptance Criteria

- [ ] AC1 判据正本四臂齐备：`grep -n '^### 臂' docs/references/ownership-first-refactoring-methodology.md` 输出 4 行，且每臂段落含「取假方式」与「重锚规则」各一处；贴这 4 行与前 3 条命中内容。
- [ ] AC2 脚手架可运行：对一个示例任务 id 运行 `node --experimental-strip-types plugin/scripts/extension-point-criteria.ts --scaffold --task-id <id> --central <file> --outside <module>`，stdout 含四臂占位符与「重锚规则」占位符，退出码 0；贴完整输出。
- [ ] AC3 检查器四态可分：fixture 单测覆盖 `satisfied` / `missing-arms` / `not-applicable` / `NOT-EVALUATED` 四种输入，且断言 `NOT-EVALUATED` 的输出与 `satisfied` 在**每一个判别字段上都不同**（硬规则 3b）；贴测试文件路径与断言条数。
- [ ] AC4 位置判定负对照：把四臂文字整段放进 `## Proposal` 散文、AC 列表项只写行为判据，检查器必须报 `missing-arms`（不是 `satisfied`）；再把同样四臂写进 AC 列表项，必须报 `satisfied`。贴两次运行的完整输出。
- [ ] AC5 生产载体读数：对主检出 `tasks/*.md` 中所有带 `refactor-slice` 标签（若无则用 `plan` 形状 + 标题含「拆分/切片/重构」）的任务实跑检查器，贴 `{evaluated:true, satisfied:N, missing:N, notApplicable:N}` 计数与前 5 条缺失任务 id。本条只要求读数可复现，**不要求本次把缺失清零**。
- [ ] AC6 skill 可被调用：`plugin/skills/extension-point-refactor/SKILL.md` 存在且经 `plugin/scripts/capability-catalog.sh` 或清单可见；贴清单命令输出中对应行。
- [ ] AC7 目录一致：`bash plugin/scripts/capability-catalog.sh --summary` 自报计数与声明数一致、新增脚本 `0 unclassified`；贴原文。

## Definition of Done

- 判据正本（四件套 + 重锚规则）与检查器、脚手架、skill 四者同时存在，且检查器至少在一次真实任务上产出过 `satisfied` 或 `missing-arms` 的读数（不是只在 fixture 里跑通）。
- `docs/references/ownership-first-refactoring-methodology.md` §13 的 R0–R3 表补上「方法体 vs 方法壳」读法，并链接本检查器。
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
