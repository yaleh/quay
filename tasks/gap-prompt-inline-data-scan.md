---
id: gap-prompt-inline-data-scan
title: 把 meta-driver 的 −88% fresh/轮 作为模板，全量扫描 driver 的 prompt 组装点——按机制列出仍把数据内联进
  prompt 的候选与实测体积
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`gap-meta-driver-probe-readings-inline-over-1mb`（2026-11-01 19:26 落地）产生了一次干净的生产阶跃：meta-driver 的首条 user 消息 1,286,071 → 26,260 字符（−98%），每轮 fresh tokens 467.8k → 55.2k（−88%）。机制是通用的——**prompt 组装点把一个大 JSON 结构 `JSON.stringify` 后整段内联，而不是落盘 + 给路径指针**。改造后同一份 readings 仍可从 `.quay/meta-driver-readings.json` 完整读回。

问题是"还有别处也在这么做吗"，目前只有手工抽测的零散读数（2026-11-02 实测首条 prompt 字符数：meta-driver 26,260、probe-runner 12,292、worker 4,128、arch-judge 3,048、pool-judge 1,627、selector 889）。**"大"不等于"内联数据"**：meta-driver 现在仍是最大，但其余量已是固定 prose。仅按体积排序无法区分"可改的内联数据"与"必须逐字在场的指令"，所以需要一次按机制（组装点是否插值大结构）而不是按体积的扫描。

本任务只做扫描与计量，不改任何 prompt 内容；命中项各自给处置，改动另立。

<!-- dedup-ref -->
与已 done 的 `gap-meta-driver-probe-readings-inline-over-1mb`（meta-driver 单点修复）保持独立：那条修一个组装点，本条枚举其余组装点并判定各自属于"内联数据 / 固定指令 / 非 prompt"，不改 prompt；与已 done 的 `gap-worker-prompt-note-family-slimming`（note 族瘦身，按体积）独立：那条压缩固定文字，本条识别"数据本不该逐轮重发"这一类。

## Plan

1. 实现只读扫描器 `scripts/prompt-inline-scan.mjs`：枚举 `plugin/scripts/**` 中构造 prompt 的函数（名字含 prompt/brief/readings 的组装点，或把字符串传给 spawn/stdin 的位置），按位置判定每个组装点是否插值变量/大对象（`JSON.stringify(`、模板字符串里插入对象、`readings` 类字段），输出 file:line + 分类。
2. 分类必须枚举，不得布尔：`inline-data`（插值了大结构）、`fixed-prose`（只拼静态文本）、`pointer`（落盘 + 路径）、`not-a-prompt`、`not-evaluated`（读不懂/无法解析）。
3. **零计数的配套动作**：把扫描谓词对着一个已知为真的样本干跑一次（改造前的 meta-driver `buildProbePrompt` 内联形态，可从 git 历史取），确认它会被判为 `inline-data`；否则"零命中"只是谓词失效。
4. 对每个 `inline-data` 命中给处置：已改为落盘+指针 / 仍内联 / 其实不是 prompt；并取至少一条真实生产读数（sessionId + 首条 user 消息字符数）作为该命中的体积证据。
5. 生成 `docs/analysis/prompt-inline-size-2026-11-02.md`：给全部命中、分类计数、top-3 候选的实测体积与预期节省（测不出就写 not-evaluated，不估算）。

## Acceptance Criteria

- [ ] AC1 `node --test scripts/prompt-inline-scan.test.mjs` exit 0；fixture 至少覆盖：①插值大对象/`JSON.stringify(readings)` 的组装点 ⇒ `inline-data`；②只拼静态文本 ⇒ `fixed-prose`；③落盘 + 路径指针 ⇒ `pointer`；④无法解析的输入 ⇒ `not-evaluated`，不得与"干净"共用输出。
- [ ] AC2 谓词干跑证据：对 git 历史中改造前的 `buildProbePrompt`（`patch` 前版本）运行扫描，必须判为 `inline-data` 并把命令与输出贴进报告；跑不出来 ⇒ 扫描器不算完成。
- [ ] AC3 扫描真实仓库后，报告给出每个分类的计数与完整命中清单（file:line + 分类），并至少对 3 个组装点人工核对分类与位置一致（按位置判定，注释/字符串里提到不算命中）。
- [ ] AC4 每个 `inline-data` 命中都有处置（已改为指针 / 仍内联 / 非 prompt）；每个"仍内联"命中附至少一条真实生产读数（sessionId + 首条 user 消息字符数 + 读取时刻），不得只给静态估算。
- [ ] AC5 报告给 top-3 候选的实测体积与"预期节省或 not-evaluated"，并明确本条不修改任何 prompt 内容。
- [ ] AC6 `git diff --check` exit 0，改动只在声明 Touches 内；`plugin/scripts/meta-driver.ts` / `plugin/scripts/worker-driver.ts` 的 diff 为空。

## Definition of Done

- 扫描器对真实仓库运行，分类计数与命中清单落盘；至少一个 `inline-data` 判定能对着已知为真的历史样本复现。
- 报告能让读者回答"还有哪些 prompt 把数据逐轮重发、各自多大"，且结论不依赖未测量的体积估算。
- 变更经相应检查，并通过约定的落地流程进入 develop。

- 该轴仍暗,理由:只读扫描与报告，不改依赖结构或分层，无 L_D/L_G 可测读数。

## Touches

- scripts/prompt-inline-scan.mjs (new)
- scripts/prompt-inline-scan.test.mjs (new)
- docs/analysis/prompt-inline-size-2026-11-02.md (new)
- tasks/gap-prompt-inline-data-scan.md

## Blocker

**2026-11-02T16:12:26.620Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (1) — new regression at lower concurrency: packages/quay/test/serve-live-body-i18n.test.mjs (passed at the original concurrency 128, fails at 64) — needs a code fix
- run_id：wk-prod-anchor
- session_id：25303333-ad0e-4b35-8fd9-287e4b9b12c7
