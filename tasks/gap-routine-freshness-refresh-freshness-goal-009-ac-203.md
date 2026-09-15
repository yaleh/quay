---
id: gap-routine-freshness-refresh-freshness-goal-009-ac-203
title: "freshness-refresh: delivery-face evidence for AC-203 (build_sha
  f19397c6, 2026-09-14T14:25:05Z) is d=190 commits behind the develop tip; only
  10 commits of margin remain against th"
status: ready
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
delivery-face evidence for AC-203 (build_sha f19397c6, 2026-09-14T14:25:05Z) is d=190 commits behind the develop tip; only 10 commits of margin remain against the 42.12 commits (2.34h) a coldstart-face run plus one observation interval needs to land inside K=200.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1789490129772` · ts `2026-09-15T16:35:29.772Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`coldstart-face`、`develop-deliver-tgz.sh`
- 涉及文件：
- `plugin/freshness-producers.json:31`
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on hosts B C (bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root <main-checkout>)

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-goal-009-ac-203`（routine `freshness-refresh`，runId `freshness-refresh-1789490129772`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【已修掉】（⛔ 不是观察项）。判据能取假，三处独立读数互相印证：**

| 量 | 立案时（finding ts `16:35:29Z`） | 本次复核（`2026-09-15T21:5xZ`） |
|---|---|---|
| 主体最新载体记录的 `build_sha` | `f19397c6` | `5c55ada8b391ecc45e250076baeb3f332caff04d` |
| `d`（交付面提交距离，K=200） | **190** | **9** |
| `margin = K − d` | **10** | **191** |
| 探针阈值 `(W+I)×R` = (0.34+2.0)×~18 | 42.12 | 42.12 |
| AC-214 判据退出码 | （~19:0xZ 转红） | **0（pass）** |

**① 判据本体逐字跑**（从 `goals/AC-214-交付证据必须新鲜-…md` frontmatter 的折叠块 `criterion:` 取出后
`bash -c` 执行，⛔ 不是引述；stdout 逐字，stderr 空）：

```
freshness GOAL-009-AC-201: 9/200 (margin 191)
freshness GOAL-009-AC-232: 9/200 (margin 191)
freshness GOAL-009-AC-205: 9/200 (margin 191)
freshness GOAL-009-AC-207: 9/200 (margin 191)
freshness GOAL-009-AC-203: 9/200 (margin 191)   ← 本 finding 的主体
freshness GOAL-009-AC-238: 132/200 (margin 68)
freshness GOAL-009-AC-239: 132/200 (margin 68)
EXIT=0
```

同判据经 CLI：`node --experimental-strip-types packages/quay/src/goal-store.ts gate AC-214 --dry-run`
⇒ `{"verdict":"pass","reason":"acceptance passed (exit 0)"}`。

**② 独立重算 `d`**（⛔ 不采信快照自报值）：交付面路径按判据同一规则机械推导
（`packages/quay/package.json` 的 `files` 映射 + `plugin` + `packages/quay-native/src`，⛔ 不手写清单），
`git rev-list --count 5c55ada8b391..develop -- <paths>` = **7**（21:49Z；随后 tip 前进，判据读到 9）。
零计数的对照动作：同一谓词对 pre-fix 的 `f19397c6` 干跑 ⇒ **208**（远 > K）⇒ 谓词能取假，不是恒绿。

**③ 产出者确实跨机跑过**（⛔ 不靠「记录存在」反推）：`.quay/verify-coldstart-remote-B-{c529e425,5c55ada8}.log`
与 `…-C-…` 两份远端日志，**两机均 `VERIFY-RC 0`**、均 `E2E_CLOSURE_AC203_WRITTEN_THIS_RUN=1`
（AC-203 与 AC-207 由**同一次运行**对**同一** `project_root` 写出 ⇒ 闭环自证）。载体侧 AC-203 新增 8 条记录，
host 覆盖 `orangevps`（B）与 `instance-20221019-1509`（C），`build_sha` = `c529e425` / `5c55ada8`。

**谁修的（⛔ 不是本任务）**：本任务**没有**跑产出者 —— 修复由**派发链**完成，执行者是
`gap-ac214-fifth-crossing-routine-detects-but-nothing-acts` 的 worker，三次运行
（`2026-09-15` 19:17:34Z / 19:36:00Z / 20:05:19Z），命令逐字
`bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root /home/yale/work/quay`。
⇒ **本 finding 所描述的陈旧，在它被处置之前就已由另一条路径关闭**（产出者首跑 19:17:34Z 早于本任务立案 19:30:42Z）。

**「失败在哪一步」（结论是「已修掉」也必须写明，否则读者无法判断该机制还灵不灵）**：
例程的**检测**半边是灵的 —— 16:35:29Z 与 18:35:40Z 两轮都把本 finding 追加进了 `.quay/routine-findings.jsonl`。
**不灵的是【立案】半边**：把 finding 变成任务的机械立案步（`routine-file-gate.ts` 接进 `probe-routine.ts`）
在 **19:26:58Z** 才落地（commit `4c7e5c230`），本任务 **19:30:42Z** 才被它立案（commit `d845ef5e2`）——
**晚于 AC-214 判据转红的 ~19:0xZ，也晚于产出者重跑的 19:17:34Z**。该缺口正是
`gap-ac214-fifth-crossing-routine-detects-but-nothing-acts`（status: done）的主题，本条不改它。

**该路径现已活的正面读数（⛔ 不是「应该会好」）**：`21:20:11Z` 的 scan-round 独立复核了快照
（`5c55ada8b391 -> face-distance 4`），对五个冷启动面主体的结论是
`margin/K=0.980 vs threshold (0.34+2.0)*25/200=0.2925 - comfortably inside` ⇒ **正确地没有立案**。
这是一条负控制：立案步**不是**无条件开火（恒有输出与「在工作」同形，硬规则 3b）。

**本任务自身未做的事（⛔ 逐条，不以沉默代替）**：
⛔ 未重跑产出者 —— `d` 已 9、判据已绿，重跑是零边际收益的跨机动作（且按 DoD 第 2 条，产出者重跑归派发链，
而派发链已经跑过）；⛔ 未改 `plugin/freshness-producers.json` —— 映射经复核**正确**
（主体归属 `coldstart-face`；`wallclock_hours: 0.34` 与本次实测 ~20min 端到端相符 ⇒ 无需变更；
且把运行史写进该文件本身就是它头注释禁止的「第二份拷贝」/单源漂移）；⛔ 未改 K、未改 `criterion`、
未动 `.quay/routine-findings.jsonl`、未改 `files:`/`symbols:` 观测面。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-203.md`
