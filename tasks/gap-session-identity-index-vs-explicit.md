---
id: gap-session-identity-index-vs-explicit
status: ready
labels: []
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**跨层同源缺陷：`inner-exec-mode-report.ts` 缺省 `--session` 时自动检测「~/.claude/projects/ 下最新 .jsonl」——从 manager/outer 这边跑必然命中**自己**的会话（manager 实测：它报 session=b8dc91a6…，那是 manager 自己的会话）。这与我 00:22 把 b8dc91a6 当 inner transcript 读是同源：**两处都用「最新/索引」而不是「显式身份」**。这不是两个孤立 bug，是同一个根因的两个实例。**

### 实证（manager 2026-08-10 更正 + outer 复核）

- **inner-exec-mode-report.ts:36**：`缺省 --session 自动检测：~/.claude/projects/ 下最新 .jsonl，优先父目录名匹配仓库 slug`——从 manager 那边跑命中 manager 自己的会话（实测 session=b8dc91a6，是 manager）。
- **同源对照（00:22 我犯的错）**：我 00:22 起把 b8dc91a6（manager transcript）当 inner 读了 26 次——因为「最新 .jsonl」猜内层会话，没反查 pane pid 显式身份。两处都是「最新/索引」替代「显式身份」。
- **根因**：会话识别用「最新/索引启发式」而非「显式身份」（pane pid → session 反查 / --session 显式传参）。启发式在单会话环境碰巧对，多会话（outer/manager/inner + subagents）下必然命中错误对象。

**为什么重要**：这是「索引/最新替代显式身份」的跨层实例——manager 的 inner-exec-mode-report 和我的 transcript 读取都栽在同一根因。并成一条根因，修一处覆盖两处（至少显式身份优先、启发式 fallback 报 WARN）。

### 选定机制方向（实现归内层，接法留执行时）

1. **显式身份优先**：inner-exec-mode-report 缺省 --session 时先反查 pane pid → session（显式身份），启发式（最新 .jsonl）仅作 fallback 且报 WARN（「未指定 --session，用启发式命中 <session>」）。
2. **同根标注**：与我 00:22 错读 b8dc91a6 同根（索引替代身份）——本条覆盖两实例。

**验证锚**：修后 (a) inner-exec-mode-report 缺省 --session 报 WARN + 显式身份优先；(b) 从 manager/outer 跑不再命中自己会话；(c) 启发式 fallback 有 WARN。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 inner-exec-mode-report.ts:36 启发式命中自己 + 00:22 错读同源（本任务 Proposal 已含）
- [ ] AC2: **显式身份优先**——缺省 --session 先反查 pane pid → session，启发式仅 fallback + WARN
- [ ] AC3: **同根覆盖**——一条根因（索引替代身份）覆盖 inner-exec-mode-report + 外层 transcript 读取两实例
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：inner-exec-mode-report 缺省跑报 WARN + 命中显式身份（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/inner-exec-mode-report.ts（缺省 --session 显式身份优先 + 启发式 fallback WARN）
- plugin/test/inner-exec-mode-report.test.mjs（AC2/AC3 测试）
- tasks/gap-drive-sent-to-manager-pane-not-inner.md（交叉标注——同根：索引替代身份）
- tasks/gap-inner-serial-main-thread-not-dispatch.md（交叉标注——inner 主线程直改陷阱）
- tasks/gap-session-identity-index-vs-explicit.md（自身：勾 AC + 贴证据）

## Contract

measure   heuristic_hits_self = `node --no-warnings --experimental-strip-types plugin/scripts/inner-exec-mode-report.ts --root <repo>` 缺省跑的 session 归属
band      heuristic_hits_self = 显式身份或 WARN（不再静默命中 manager/outer 自己的会话）
invariant explicit_identity_preferred = 1（pane pid → session 优先）
invariant heuristic_fallback_warns = 1（启发式 fallback 报 WARN）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/inner-exec-mode-report.ts --root <repo>`（缺省跑贴回 session 归属 + WARN）
control   显式身份优先；启发式 fallback WARN；不命中自己
resume    显式身份优先 / 启发式 WARN 分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 更正——inner-exec-mode-report.ts 缺省 --session 自动检测最新 .jsonl 命中自己（b8dc91a6），与我 00:22 错读同源（索引/最新替代显式身份）。并成一条根因：显式身份优先 + 启发式 fallback WARN。实现归内层
