---
id: gap-goal-get-meta-get-mcp-name-collision
title: goal_* MCP 工具未经 Core 聚合层暴露，与同前缀 meta_* 工具发生真实命名碰撞（已有实际报错复现）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: finding
---
## Finding

- `packages/quay-native/src/mcp-server.ts:412-541` registers the real `goal_list`/`goal_get`/`goal_write`/`goal_gate` tools, but ONLY on quay-native's own standalone MCP server. `packages/quay/src/mcp-handlers.ts`'s `registerAllHandlers` (the Core aggregator exposed to Claude Code as `mcp__plugin_quay_quay__*`) re-exposes `adr_*`/`task_*`/`meta_*` but does NOT re-expose `goal_*` at all. Result: a normal Claude Code session connected to the aggregated quay plugin cannot discover or call any `goal_*` tool.
- `mcp-handlers.ts:910-963` registers `meta_get`/`meta_list`/`meta_write` — an UNRELATED "meta-driver message mailbox" (proposed→answered lifecycle for meta-driver, not goal/metadata-related) that IS exposed at the aggregator and shares naming proximity with "goal".
- CONFIRMED real incident (not hypothetical): `plugin/scripts/goal-driver.ts:2613` — a gap-worker dispatch-prompt template literally instructs: "Read the AC record (goal_get MCP) to understand the work it demands...". `goal_get` does not exist on the aggregator. Session evidence (local jsonl `9f6a5493-f198-4551-97ac-12f73c9637cf.jsonl`, dated 2026-10-03) shows an agent dispatched under this prompt actually called `mcp__plugin_quay_quay__meta_get({id:"AC-326"})`, got back `{"is_error":true, ...: "no such META: AC-326"}`, then fell back to Bash/grep over `tasks/` to locate the AC manually.
- This exact prompt phrasing ("goal_get MCP") is a template used across goal-driver's gap-worker dispatches — grep shows it is the kind of instruction that recurs every time this dispatch path fires, meaning the failure mode is latent in the template itself, not a one-off typo in a single historical commit.
- Candidate remedy directions (for whoever executes — do not treat any one as mandated, this is a finding not yet a committed plan): (a) re-expose `goal_*` through the Core aggregator so the tool genuinely exists where the prompt expects it; (b) independently, fix the goal-driver.ts:2613 prompt wording to stop claiming a nonexistent "goal_get MCP" tool and instead point at the Bash/grep fallback that already works, or at whatever the correct direct-provider path is; (c) separately consider renaming the `meta_*` mailbox tool family away from a name that collides with "goal" semantics, to prevent recurrence of this exact confusion elsewhere.

**Dedup check performed**: `task_list` searched for `goal_get`, `goal_list`, `meta_get`, `registerAllHandlers`, `goal_get MCP`, `aggregator`, `name collision`, `goal tool not exposed`, `read the AC record`, `no such META`, `mailbox tool`, `Core aggregator`. Related-but-distinct hits: `gap-goal-store-abi-encapsulation-provider-backed` (done — wired `goal_*` onto the native provider's own MCP server and provider-client, but did NOT touch the Core aggregator's `registerAllHandlers`, which is the exact gap this finding is about); `gap-meta-records-should-be-a-first-class-store-kind-not-a-task-label` (done — designed the `meta_*` mailbox kind itself, unrelated to this naming-collision/missing-aggregator-exposure issue). No genuine duplicate found.

## Resolution (2026-10-07) — remedy (a) + (b), both halves

Doing only one half leaves the failure reproducible, so both were done:

- **(a) `goal_*` re-exposed on the Core aggregator.** `packages/quay/src/mcp-handlers.ts` gains `registerGoalHandlers` (goal_list / goal_get / goal_write / goal_gate), proxying the provider client's already-existing goal ABI (`provider-client.ts` `goalList`/`goalGet`/`goalWrite`/`goalGate` — wired onto the native provider by `gap-goal-store-abi-encapsulation-provider-backed`), and `registerAllHandlers` now calls it alongside the adr_/meta_ families. The four tools are reachable as `mcp__plugin_quay_quay__goal_*` in any Claude Code session on the aggregated plugin.
- **(b) goal-driver prompts name the exact tool.** Both prompt sites were corrected (hard rule 5b — the CLUSTER, not just the filed `:2613`): `buildGapWorkerPrompt` (was `Read the AC record (goal_get MCP) ...`) and `buildSufficiencyFollowupPrompt` (was `Read the goal record (\`goal_get\` MCP) ...`) now both name `mcp__plugin_quay_quay__goal_get`, so the "nearest-sounding name" substitution that produced the `meta_get` miss is no longer available to a dispatched agent.

## Meta-Naming-Collision Assessment (AC3 decision: keep `meta_*` as-is, do NOT rename)

Decision: **keep the `meta_*` tool family name unchanged** (no rename). Rationale, evidence-ordered:

1. **The root cause is absence, not the name.** In the incident `meta_get({id:"AC-326"})` answered honestly — `no such META: AC-326`. It did not masquerade as an AC tool; the agent substituted the nearest name because `goal_get` did not exist. With `goal_*` present (half (a) above), the substitution has no motive and the failure shape disappears.
2. **A rename is a real breaking ABI change whose benefit has no evidence.** `meta_*` is a first-class store kind (its own proposed→answered lifecycle and provider support matrix); renaming it would churn Core / native / github plus their tests. The occurrence count of "the `meta_*` NAME itself caused a mis-call" is **0** — the single observed mis-call traces entirely to `goal_get` absence (point 1). Per hard rule 12, paying a real regression cost for a 0-occurrence risk is not warranted.
3. **Reversible.** If a name-proximity-caused mis-call is ever observed independently, the rename can be made then, once its own occurrence reading exists. This decision is recorded here and may be overturned by such evidence.

## AC

- [x] `grep -n "goal_" packages/quay/src/mcp-handlers.ts` shows zero `goal_list`/`goal_get`/`goal_write`/`goal_gate` tool registrations today (negative control confirming the gap as filed) — or, if already fixed by the time this is worked, the AC is satisfied by the aggregator exposing all four and a real MCP call to each succeeding. —— 取「已修复」分支：`registerGoalHandlers`（`mcp-handlers.ts:904`）注册四工具并接入 `registerAllHandlers`（`:1121`）；`packages/quay/test/mcp-goal.test.mjs` 以真实 Core MCP stdio client（`quay mcp`，非 fixture）对四者各发起一次调用 —— goal_write / goal_get / goal_list / goal_gate 全部非 isError，goal_gate 对 `exit 0` 判据返回 `verdict:"pass"`（5/5 green）。
- [x] `plugin/scripts/goal-driver.ts:2613`'s dispatch-prompt template text is identified and either (a) corrected to not claim a nonexistent "goal_get MCP" tool, or (b) left as-is only once `goal_get` genuinely exists on the aggregator and a real call to `mcp__plugin_quay_quay__goal_get` succeeds — one of the two, not neither. —— 两处都取 (a)：`buildGapWorkerPrompt`（原 `:2613`）与 `buildSufficiencyFollowupPrompt`（原 `:2683`，硬规则 5b 同簇兄弟）均改为点名 `mcp__plugin_quay_quay__goal_get`；(b) 同时成立（goal_get 已存在于聚合器且真实调用成功，见 AC1）。回归钉：`plugin/test/goal-driver-s01.test.mjs` 与 `plugin/test/goal-sufficiency-followup.test.mjs` 断言含完整工具名、且不残留旧占位措辞。
- [x] The `meta_*` naming-collision risk is explicitly assessed (keep as-is with documented rationale, or rename) and the decision is recorded in this task's body. —— 见上文 `## Meta-Naming-Collision Assessment`：决定保持 `meta_*` 命名不变；理由=根因是 `goal_*` 缺席而非名字（`meta_get` 诚实回 `no such META`）、重命名是真实 ABI 回归代价而「名字本身致误」发生率 0（硬规则 12）、且决定可逆。

## DoD

A real Claude Code session connected to the aggregated quay plugin can either successfully call a `goal_get`-equivalent tool to read an AC record, or the dispatch-prompt template no longer claims one exists where it doesn't — the specific confirmed incident (agent calling `meta_get` by mistake and falling back to grep) cannot recur under the corrected state. Evidence must be a real tool call/transcript, not prose assertion.

## Touches

- plugin/scripts/goal-driver.ts
- packages/quay/src/mcp-handlers.ts
- packages/quay-native/src/mcp-server.ts
- tasks/gap-goal-get-meta-get-mcp-name-collision.md

## Test-Files

- packages/quay/test/mcp-goal.test.mjs
- plugin/test/goal-driver-s01.test.mjs
- plugin/test/goal-sufficiency-followup.test.mjs
