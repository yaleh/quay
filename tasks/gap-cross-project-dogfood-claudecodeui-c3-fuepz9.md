---
id: gap-cross-project-dogfood-claudecodeui-c3-fuepz9
title: "[cross-project dogfood] The resident selector parses only the first line
  of the model reply, so any prose first line (e.g. about a missing…"
status: ready
labels:
  - gap
  - cross-project-dogfood
parent: null
children: []
extra: {}
---
## Proposal
Cross-project Quay dogfooding round `cpd-943549-1791888744490-fuepz9` read the real usage artifacts of source project `claudecodeui` and formed this hypothesis; an independent verifier and an independent refuter both returned `supported`.

**Claim**: The resident selector parses only the first line of the model reply, so any prose first line (e.g. about a missing orchestration file) forces dispatch of candidates[0] instead of the intended pick.

**Quay-side components**: `plugin/scripts/driver-runtime.ts`

**Why this is Quay-generic, not host-local**: the claim names Quay's own mechanism, not the source project's product; the source project is only where the failure became visible.

## Evidence
- `plugin/scripts/driver-runtime.ts:2476` — Before choosing, read orchestration/dispatch-preference.md — its 覆盖段 carries the current priority (manager-maintained). Honor it unless a candidate is structurally ineligible ...
- `plugin/scripts/driver-runtime.ts:2490` — const line = String(stdout ?? "").trim().split("\n")[0]?.trim() ?? "";  // only the FIRST line is ever matched against candidate ids
- `plugin/scripts/driver-runtime.ts:2503` — reason: `selector worker returned no valid pick (exit ${exitCode ?? "null"}${got}${errFrag}); fallback to first shuffled candidate`
- `.quay/worker-outcome.jsonl:1298` — "selector_reason":"selector worker returned no valid pick (exit 0, got \"No `orchestration/dispatch-preference.md` exists in this repo root (only the qua\", stderr=\"\"v4.1flash\" isn't described ..."); fallback to first shuffled candidate"

- round: `cpd-943549-1791888744490-fuepz9` (record `cross-project-dogfood@cpd-943549-1791888744490-fuepz9::c3`)
- source project: `claudecodeui`
- verifier verdict: `supported`; refuter verdict: `supported`

## Plan
1. Reproduce the claim from the cited positions above (the artifact that exposed it), then read the named Quay-side surface.
2. Either fix the mechanism, or record why the claim does not hold for Quay's own code — the round's refuter was satisfied, so "it is only that host" needs its own evidence.
3. Correct `## Touches` to the files the fix actually changes before editing them.

## Answer（本 round 的答复：claim 成立，已修）
**Claim 成立（reproduced on Quay's own tree）。** `parseSelectorOutput` 旧实现取
`String(stdout ?? "").trim().split("\n")[0]` —— **只把首行**拿去匹配候选 id。用一个两行 stdout
对着该函数逐字复跑（`candidates=["gap-a","gap-b"]`，首行是散文、次行才是选择）：

```
stdout line 1: No `orchestration/dispatch-preference.md` exists in this repo root (only the quay plugins).
stdout line 2: gap-b because it unblocks the suite
⇒ old first token = "No"（非候选）⇒ FALLBACK -> gap-a        模型实际选的是 gap-b
```

即：散文首行 ⇒ 首 token 非候选 ⇒ **静默回退 candidates[0]**，把模型已经给出的正确选择丢掉。且这次回退
与「模型没选出任何东西」**同形**——`selector_reason` 只说 `no valid pick`，读的人看不出模型其实选对了
（硬规则 3b：读不懂输入不得返回与「合格」同形的值；此处是回退与「真的没选」同形）。

⚠️ 关于引用位置的时效：本任务开立时引的 `.quay/worker-outcome.jsonl:1298` 已被后续轮次覆写（该 carrier
现为 3120 行，第 1298 行是另一条记录）。**但 claim 不依赖那一条历史记录**——它可从上面两个代码位置
（`:2490` 的 `[0]`、`:2503` 的兜底 reason）直接复现，这正是本条 AC①的判据。

**Why it is Quay-generic, not host-local**: 触发条件是「模型在给出选择前写了一段前言」——这与
源项目 `claudecodeui` 的产物无关，是 Quay selector 自身的解析契约过窄。任何宿主上只要 selector 的
LLM 回复带前言，就会命中（且宿主越陌生、越会触发——prompt 要求它去读 `orchestration/dispatch-preference.md`，
而在一个没有该文件的 repo 里，模型的自然第一反应恰好就是报告这件事）。

**修法**（`plugin/scripts/driver-runtime.ts`）：
1. `parseSelectorOutput` 改为**逐行扫**，取**首个「首 token 命中候选 id」的行**；一行都没有才回退
   `candidates[0]`。约定输出仍是「一行 `<task-id> <reason>`」，故这严格是**放宽被接受的输入集合**，
   不改变任何旧行为已正确解析的输入（首行命中候选时结果不变）。
2. `defaultSelectorArgv` 的 prompt 增加一句：⛔ 不要写前言／不要评论所读文件是否存在，**第一行就必须
   以选中的 `<task-id>` 开头**——降低触发频率（治因，但解析器的健壮性是治本，两层都留）。

**负控制（防「总能捞到一个」空转）**：新增回归测试含两条反向断言——①一行都不以候选 id 开头时仍必须
回退首个候选；②只认**首 token**，`gap-zzz then gap-b` 不得被误配成 `gap-b`。

## Acceptance Criteria
- [x] the Quay-side mechanism named in the claim behaves as the claim says (reproduce it from the cited positions)
- [x] the fix is verified on Quay's own tree, not only on the source project that exposed it

## Definition of Done
- the defect is fixed or shown not to exist, and the round's claim is answered in the task body.

## Touches
- `plugin/scripts/driver-runtime.ts`
- `plugin/test/worker-driver-resident-s01.test.mjs`
- `tasks/gap-cross-project-dogfood-claudecodeui-c3-fuepz9.md`
