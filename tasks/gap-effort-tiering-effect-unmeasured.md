---
id: gap-effort-tiering-effect-unmeasured
title: role 降 effort 到 low 已在生产生效，但 output token 与延迟未见下降（meta-driver 反而
  +12%）——交付一次可复跑的对照读数并给出 keep/revert/not-evaluated
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`gap-role-effort-tiering-selector-pool-judge-meta-driver`（2026-11-01 20:12 落地）把 selector / pool-judge / meta-driver 三个 role 的 `effort` 从 high 降到 low。生产侧确认该改动**确实生效**：token 记录的 `effort` 字段显示，2026-11-01 12:00Z 之前的 selector/pool-judge/meta-driver 会话全部是 `high`，之后全部是 `low`（按 sessionId 逐条读取）。

但同一次核查没有测到收益：

| role | output tokens / msg（high → low） | 单会话时长 p50 |
|---|---|---|
| selector | 306 → 268（−12%，n=18→7） | 0.2 → 0.2 min |
| pool-judge | 1,391 → 1,331（−4%，n=3→1） | 1.2 → 5.1 min |
| meta-driver | 927 → 1,043（**+12%**，n=8→5） | 3.6 → 4.2 min |

样本量小、任务负载不同，且 `output_tokens` 未必包含推理 token，所以这既不能证明"降 effort 无用"，也不能证明"有用"。当前状态是**配置已改、效果未测**——这正是硬规则 4 推论三要挡的形状：配置生效被当成收益。

本条要求交付一次可复跑的对照读数，并据此给出 keep / revert / not-evaluated 的结论；在读数出来之前，不假设降档有益，也不据此再扩到其它 role。

<!-- dedup-ref -->
与已 done 的 `gap-role-effort-tiering-selector-pool-judge-meta-driver`（做出降档改动）保持独立：那条只把配置改成 low 并验证 argv/解析生效，本条测的是改动之后的实际 token 与延迟，不改配置；与已 done 的 `gap-role-profile-permissionmode-effort-declaration-and-provenance`（effort 字段的声明与来源）独立：那条建立字段，本条测量字段的取值后果。

## Plan

1. 实现只读工具 `scripts/effort-tiering-effect.mjs`：输入 `--sessions-dir`（与 E1 同源的 Claude Code 会话目录），按首条 user 消息给 session 归类（selector / pool-judge / meta-driver / 其它），从 assistant 记录的 `effort` 字段与 `message.usage` 聚合 `fresh / cache_read / output / msgs`，按 role × effort 输出分位数与样本数。
2. 缺 `effort` 字段或 usage 的会话不得当成 high/low 参与聚合：单列 `not-evaluated` 计数（"无法评估"要有独立取值）。
3. 跨降档时刻的会话（同一 session 内 effort 混用）单列 `mixed`，不并入任一侧。
4. 对真实会话目录运行，生成 `docs/analysis/effort-tiering-effect-2026-11-02.md`：三个 role 各给 high/low 对照、样本数、分位数，以及"样本是否足够"的显式判断（n < 20 视为不足）。
5. 结论三选一并写理由：keep（保留 low）/ revert（恢复 high，另立案执行）/ not-evaluated（说明缺什么输入、何时可重测）。
6. 不修改 `.quay/profiles.yml` 或 `plugin/.quay/profiles.yml`；本条只测量。

## Acceptance Criteria

- [ ] AC1 `node --test scripts/effort-tiering-effect.test.mjs` exit 0；fixture 至少覆盖：①同 role 的 high 与 low 会话分别聚合、互不混入；②缺 `effort` 字段 ⇒ 进入 `not-evaluated` 而不是计入某一侧；③同一 session 内 high/low 混用 ⇒ 进入 `mixed`，不并入任一侧。
- [ ] AC2 `node scripts/effort-tiering-effect.mjs --help` exit 0，公开输入 schema、role 分类规则、缺失语义与 `mixed` 语义。
- [ ] AC3 对真实会话目录运行并把读数贴进报告：至少覆盖 selector / pool-judge / meta-driver 三个 role 的 high vs low 的 `output/msg`、`fresh/msg`、`cache_read/msg` 与会话时长分位数，每格必须带样本数 n。
- [ ] AC4 报告对每个 role 显式写"样本是否足够（n ≥ 20）"；任一侧 n < 20 时必须标为不足，且结论不得据此宣称收益或损失。
- [ ] AC5 报告给出 keep / revert / not-evaluated 三选一的结论与理由；若为 not-evaluated，必须写出所缺输入与可重测条件。
- [ ] AC6 `git diff --check` exit 0，改动只在声明 Touches 内；`.quay/profiles.yml` 与 `plugin/.quay/profiles.yml` 的 diff 为空。

## Definition of Done

- 工具对真实会话目录运行并产出报告，至少一个 role 的 high vs low 读数来自生产会话（不是 fixture），且报告能让读者用一条命令复跑。
- 结论与读数一致：样本不足时不得写成"降 effort 有效"或"无效"；结论为 revert 时，恢复动作另立案，不在本条偷偷改配置。
- 变更经相应检查，并通过约定的落地流程进入 develop。

- 该轴仍暗,理由:只读测量脚本与报告，不改依赖结构或分层，无 L_D/L_G 可测读数。

## Touches

- scripts/effort-tiering-effect.mjs (new)
- scripts/effort-tiering-effect.test.mjs (new)
- docs/analysis/effort-tiering-effect-2026-11-02.md (new)
- tasks/gap-effort-tiering-effect-unmeasured.md