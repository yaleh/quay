---
id: gap-productize-deep-semantic-dedup-scan-routine
title: 把深度语义重复扫描(08-25 多 agent 判重模式)产品化为周期 routine,而非常驻热路径闸
status: todo
labels:
  - gap
  - finding
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

`orchestration/manager-tick-log.md`(约 2026-08-25 09:4x–10:19Z 附近)记录了一次一次性人工触发的动作——用 archguard 拉出 `plugin/scripts`(2017 实体)+ `packages/quay/src`(367 实体)全量函数清单,派 7 个 subagent 并发核实 15 个疑似重复簇,确证 8 个以上真实重复(含 `findRepoRoot`/`findWorkspaceRoot` 逐字节重复的函数体、`write:state` 6 处实现分裂成原子/非原子两种)。这是 ADR-007 设想的 L_G(重复抽象)检测第一次真正跑通并抓到真缺陷的案例,但从未变成常设机制,完全依赖人偶然想起来。

**已存在但更浅的相邻机制(立案时核实,需知会执行者)**:`plugin/probes/architecture-analysis.md` 已是一个挂在 `plugin/scripts/routine-scheduler.ts`(`interval:1440m` 触发)上的周期 routine(`gap-probe-mechanism-dead-15-days-rewire-to-two-layer`,已 done),但它是**单一 fresh-context analyst 一次性通读**,用 archguard/git-lens 找环/上帝包/重复——**不是** 08-25 那种"先拉全量实体清单→分片派多个 subagent 各自核实→聚合裁决"的深度模式,后者才是真正抓到 8+ 重复的那次。此外,`routine-scheduler.ts` 当初接线的生产调用点是 `plugin/loop/fast-mode-loop-tick.md` / `orchestration/orchestrator-loop-tick.md`,而当前 CLAUDE.md(2026-09-04)记录 inner(fast-mode)已被 worker-driver 取代、outer 角色已退役并入 manager 直接 subagent 派发。**执行者落地前必须先核实 `routine-scheduler.ts`/`plugin/skills/routines/SKILL.md` 当前是否还有活的生产调用点**(搜 `manager-tick-core.md`/`worker-driver.ts` 里是否仍调用它),不能想当然认为旧接线今天还通;若已断线,本任务需要一并把触发路径接回当前活的 tick 机制。

**反例对照(不要重蹈覆辙)**:`tasks/gap-fan-in-remove-archguard-gate.md`(已 done)记录了同一个 archguard-structure 闸接进 fan-in 关键路径后,244 次运行里 `sccCount` 从未非零过一次、零指引价值、每次 27s,最终被移出关键路径——证明把 L_G 检测做成常驻热路径廉价布尔闸这条路已经走不通。深度语义判重的成本(拉全量实体 + 派多个 subagent)远高于单次布尔闸,更不能上热路径。

## Acceptance Criteria

- [ ] AC1: 新增或扩展一个 routine 条目(沿用/替换 `.quay/config.yml` `loop.routines:` 里已有的 `architecture-analysis`,或新增一个如 `semantic-dedup-scan`),触发方式用 `plugin/scripts/routine-scheduler.ts` 已有的 `interval:<N>m` 两层时间量机制(不是热路径闸)。命令验证:`node --experimental-strip-types plugin/scripts/routine-scheduler.ts --now <未来时刻的 epoch-ms> --last-run <空或陈旧 last-run.json>` 的输出里出现该 routine 名与 `probe <name>` 派发行。
- [ ] AC2: 该 routine 对应的 probe 文档(建议新建 `plugin/probes/semantic-dedup-scan.md`,或改写 `plugin/probes/architecture-analysis.md` 使其明确区分两种深度)明确要求:① 先用 archguard/等效静态提取拉出 `plugin/scripts/` 与 `packages/*/src` 的全量实体/函数清单;② 分片派发多个 subagent 各自核实一批疑似重复簇(而非单一 agent 通读全部);③ 产出**结构化 finding 列表**(每条含涉及的具体文件路径 + 函数名 + 判定理由),不是一个绿/红布尔值。
- [ ] AC3(负控制,呼应 `gap-fan-in-remove-archguard-gate` 的教训): 该 routine 不得挂进 fan-in/scoped-gate 等每任务必经的关键路径——验证:`grep -rn "semantic-dedup-scan\|SemanticDedupScan"` 在 `plugin/scripts/worker-driver.ts` 及 fan-in 编排相关文件里命中数必须为 0。
- [ ] AC4(生产载体读数): 该 routine 落地并接入一个当前确实存在生产调用点的触发路径(AC1 已核实/修复的那个)后,实际发生过至少一轮真实调度(非测试 fixture 注入),产出至少 1 条结构化 finding 记录在某可查载体(建议 `.quay/routine-findings.jsonl` 或等效追加文件),且该记录的时间戳/commit 晚于本任务实现落地的 commit——验证:比较载体记录与 `git log -1 --format=%H -- <实现文件>`。若把该 routine 的生产调用点摘掉后同一条 AC4 记录仍然存在(说明记录只是测试跑出来的,不是生产真跑的),本 AC 判假。

## Definition of Done

- 深度语义判重从"人偶然想起来的一次性动作"变成一个周期 routine,产出结构化 finding(不是布尔闸);
- AC1-4 全部勾选,AC4 的生产记录必须晚于实现落地且不可被 fixture 单独满足;
- 未挂进任何 fan-in/scoped-gate 关键路径(AC3 负控制通过);
- 涉及改动的测试套件连续 2 次绿。

## Touches

- plugin/probes/architecture-analysis.md
- plugin/probes/semantic-dedup-scan.md
- plugin/scripts/routine-scheduler.ts
- plugin/skills/routines/SKILL.md
- .quay/config.yml
- .quay/routine-findings.jsonl
- plugin/test/routine-scheduler.test.mjs
- tasks/gap-productize-deep-semantic-dedup-scan-routine.md
