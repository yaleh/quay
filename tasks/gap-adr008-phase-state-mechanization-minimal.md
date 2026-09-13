---
id: gap-adr008-phase-state-mechanization-minimal
title: ADR-008 两阶段呼吸的最小机制化——记录 phase 字段,不做自动阈值触发
status: done
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

`adr/ADR-008-two-phase-breathing-expansion-convergence.md` 仍是 `status: proposed`,其 enforcement 注释标「E3, deferred」——dashboard 应记录当前 phase(expansion|convergence)及切换时的 trigger,但从未落地。`docs/analysis/crystallization-the-contraction-phase-has-no-mechanism.md`(2026-08-04,ADR-008 成文半个月后)已经量化诊断:当晚新增 27,839 行规格文档,收缩动作 4 次全部人工发起,机制发起的收缩 0 次——原文"膨胀相自动,收缩相完全靠人,机制侧没有东西会说删掉它"。

**立案时复核(2026-09-13)**:`experiments/quay-perpetual-stream/dashboard.md` 第 3 行至今仍显示 `milestone_counter: 206`,与另一任务(`gap-outer-bg-job-migration-proposal`,superseded)2026-09-03 核实的"该文件末次真实更新 2026-08-02、`milestone_counter` 定格于 2026-07-31 写入"完全一致——**dashboard.md 本身可能已经不是活跃状态载体**(ADR-022 退役经典管线、outer 角色 2026-09-04 并入 manager 直接派发后,该文件的持续维护者已消失)。全库搜 `phase: expansion|convergence` 字段命中数为 0,证实两个月来两阶段状态从未落地。`docs/references/维度边界与结晶——从熔融实现中发现原则.md` §3(两体结构:测量由机器做、形变方向由人供给)提示原设计里"数值阈值自动触发切换"这个方向本身可能是错的方向。

**要做的(明确排除自动阈值触发,只做记录+人工声明两件事)**——鉴于 dashboard.md 活跃性存疑,执行者落地前必须先核实其近 30 天内是否有真实 commit(`git log -1 --format=%cI -- experiments/quay-perpetual-stream/dashboard.md`);若不活跃,选独立的 `.quay/` JSON 状态文件路径,不要往一个事实上已停摆的文件里加字段造成"看起来在维护、实际没人看"的假象(同 CLAUDE.md 硬规则 3b)。

## Acceptance Criteria

- [x] AC1: 增加一个机器可读、可独立解析(grep/parse 可得,不需要在散文段落里搜索)的字段记录当前 phase(`expansion`|`convergence`)。落点二选一,由执行者按上述核实结果决定:若 `experiments/quay-perpetual-stream/dashboard.md` 近 30 天有真实 commit,则写在该文件一个专用字段行(如 `**phase: expansion**`);否则落在新建的 `.quay/two-phase-state.json`。命令验证:`grep -n "^\*\*phase:" experiments/quay-perpetual-stream/dashboard.md` 或 `jq .phase .quay/two-phase-state.json` 直接取到 `expansion`/`convergence` 二值之一。 〔落地:核实 `git log -1 --format=%cI -- experiments/quay-perpetual-stream/dashboard.md` = 2026-08-02T18:30:26+00:00(距 2026-09-13 逾 30 天)⇒ 按 AC 的决策规则取第二个落点 `jq .phase .quay/two-phase-state.json` → `convergence`。〕
- [x] AC2: 提供一条命令(建议 `plugin/scripts/phase-declare.ts --to <expansion|convergence> --reason "<一句话>"`)供人显式声明切换。调用后该载体的 phase 字段被覆盖,且机械记录:切换时刻(ISO 时间戳)、触发原因(人给的一句话,必填)、一次真实 L_D/L_S 读数快照(调用已有的 `plugin/scripts/git-lens-l-d-code-doc-ratio.ts` 或 `plugin/scripts/git-lens-l-g-structural-drift.ts` 取到的真实数值,不是占位符)。负控制:不带 `--reason` 调用必须 exit 非零、不写任何状态(fail-closed)。 〔落地说明:AC2 点名的 `plugin/scripts/git-lens-l-d-code-doc-ratio.ts` 路径已不存在——该 git-lens 代理 2026-09-07 作为 zero-call 脚本归档到 `archive/2026-09-07-zero-call-scripts/`,experiments 下的同名入口只剩悬空符链,归档副本亦不可运行(其 `gate-script-base.ts` 未同期归档)。故按原规则(doc=/\.(md|txt)$/i、ratio=docLines/codeLines、FLAGGED 阈值 3.0/20)在 `phase-declare.ts` 内逐字重实现,L_D 规则出处写入载体 `reading.rule`;实测读数 docLines=7073 codeLines=20717 与独立 `git diff --numstat` 复算一致。负控制已由 `plugin/test/phase-declare.test.mjs` 覆盖:无/空白/过短 `--reason` 一律 exit 非零且不写字节。〕
- [x] AC3(不做自动判定): 该命令/字段机制本身不含任何"数值超过阈值即自动切换 phase"的代码路径——人工核对 `plugin/scripts/phase-declare.ts` 实现文件里不存在读取一个数值并据此自动写 phase 的分支(唯一写入口是人显式调用带 `--reason` 的命令)。 〔人工核对:全文件对 `flagged`/`ratio`/`verdict` 的引用仅三类——`computeRatio` 内计算、`Reading` 字段赋值、`--json`/stdout 打印,无一进入条件分支;载体 phase 的唯一赋值处是 `phase: opts.to as Phase`(人给的 `--to`)。〕
- [x] AC4(生产载体读数): 落地后,至少发生一次真实(非本任务测试 fixture)的人工 phase 声明调用,该记录的时间戳晚于本任务实现落地的 commit——验证:读该状态载体记录的时间戳,与 `git log -1 --format=%H -- plugin/scripts/phase-declare.ts` 的落地 SHA 比较,证明是落地之后真实用过一次,不是只在测试里跑过。 〔实测:落地 commit `9d2662b19019c3ac3c47707db56fc87600829257`(2026-09-13T20:35:02+00:00);`.quay/two-phase-state.json` 的 `history[0].declaredAt` = 2026-09-13T20:35:47.187Z,晚 45 秒。该次为真实调用 `--to convergence`,reason 与 reading 随载体一并提交(commit f57807f5c)。〕

**明确排除**:不修改 `adr/ADR-008-two-phase-breathing-expansion-convergence.md` 本身(ADR 文本修订走 `quay adr` 命令,不在本任务范围内,由发起者另行处理)。

## Definition of Done

- 命令可用、AC1-4 全部满足,AC4 的生产载体读数必须来自实现落地**之后**的真实一次人工声明,不能只由本任务自己的测试 fixture 满足;
- AC3 的"不做自动判定"由人工代码审查 + 无自动分支的事实确认,不是靠测试覆盖率;
- 涉及改动的测试套件连续 2 次绿。

## Touches

- experiments/quay-perpetual-stream/dashboard.md
- .quay/two-phase-state.json
- plugin/scripts/phase-declare.ts
- plugin/scripts/capability-catalog.sh
- plugin/test/phase-declare.test.mjs
- tasks/gap-adr008-phase-state-mechanization-minimal.md
