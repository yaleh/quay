---
id: gap-single-session-single-model-invariant
title: 单会话单模型不变式检查——防 model 与 ANTHROPIC_DEFAULT_*_MODEL 不一致导致会话内模型漂移打穿缓存
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

同一会话内模型一旦切换，prompt 缓存前缀失效，后续每轮从 cache_read（0.05–0.1×）退化为 cache_write（1.25×）甚至 fresh（1×）。模型有两个配置来源会打架：`launchArgv` 发的 `--model <v>`（profile 的 model）与 env `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL`（Claude Code 给子代理/default 模型用）。若两者不一致（如 model=v4.1flash 而 DEFAULT_OPUS 指向别的），会话内 spawn 子代理或回退时就会静默切模型。两份 carrier 已各自表达纪律但无检查：quay dev-tree 把三个 DEFAULT_* 都设成 = model（自洽），claudecodeui shipped 版刻意**不声明**三个 DEFAULT_*（靠 launcher wrapper 单一承载，自洽）。本任务把这条纪律变成机械不变式：**要么三个 DEFAULT_* 全缺省，要么三者全等于 model，不允许混合/不一致态**。

## Plan

1. 在 `plugin/scripts/profiles-role-coverage-check.ts`（或就近新增 checker）加一条：对每个 role 解析出的 ResolvedProfile，读 `env.ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL` 与 `model`，判三类：三者全缺省（合法）/ 三者全 == model（合法）/ 混合或不一致（报红）。
2. 写合成配置负控制：一个「model=v4.1flash 但 DEFAULT_OPUS=deepseek-v4-pro」的配置必须红。

## Acceptance Criteria

- [x] AC1 checker 对 quay dev-tree 与 claudecodeui shipped 两份 profiles.yml 均报绿（两者分别命中「全缺省」或「全一致」分支）。
  - quay dev-tree（全一致）：`--check --root <worktree> --json` → `modelInvariantViolations: []`、`modelInvariantCarriers` 覆盖 shipped/init/dev-tree 三份（dev-tree `.quay/profiles.yml` 的 DEFAULT_*==model）。
  - claudecodeui shipped（全缺省）：追加 `--carrier /data/home/yale/work/claudecodeui/.quay/profiles.yml` → 4 carriers 全绿（worker-default model=v4.1flash、无 DEFAULT_*）。
- [x] AC2 负控制：合成「DEFAULT_* 三值之一 != model」的配置被报红（贴 checker 输出）。
  - checker 输出（exit 1）：`modelInvariantViolations: ["carrier:/tmp/gap-single-model-negative-carrier.yml:task-worker: DEFAULT_* != model — model=\"v4.1flash\", but ANTHROPIC_DEFAULT_OPUS_MODEL=\"deepseek-v4-pro\""]`。
- [x] AC3 该 checker 进 run_static_checks（或既有 profiles-role-coverage-check 入口），测试全绿。
  - 既有入口 `plugin/scripts/runner-static-gate.ts` 已收录本 checker（`run_checker "profiles-role-coverage-check" …`）；`node --test plugin/test/profiles-role-coverage-check.test.mjs` 10/10 绿（含 2 个正控制 + 2 个负控制）。

## Definition of Done

- AC1–AC3 带真实证据勾选；checker 是「读宿主」而非字面量（换模型/换项目继续有效）。

## ADR-007 暗轴记录

- 该轴仍暗,理由:本任务为局部 checker 增强（profiles-role-coverage-check.ts 加单会话单模型不变式 + 测试负/正控制），不改包/依赖结构、不新增跨层引用（沿用既有 profile-policy.ts/yaml 依赖），无可测的 L_D/L_G 读数。

## Touches
- plugin/scripts/profiles-role-coverage-check.ts
- plugin/test/profiles-role-coverage-check.test.mjs
- tasks/gap-single-session-single-model-invariant.md