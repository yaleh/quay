---
id: gap-scoped-runs-pay-full-static-check-overhead
title: "scoped runs pay the full ~16s run_static_checks fixed overhead per task (13s is checker-mutation-check; for 13 of 22 sub-3s scoped runs the overhead is >5x the tests) — add a change-relevant-only static-check tier for scoped mode, keeping the COMPLETE gate in the outer full-suite verification-round (spawn tests stay, 3-min target dropped, outer async full-suite stays — this is not about cutting tests)"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者实测【2】（人已裁定：spawn 型测试必要、整套件 3 分钟目标不合适、outer 异步跑全量是现在正确
安排——本条**不是**要砍测试、不是要削弱闸门）。

**实测**：inner 每任务只跑 scoped 测试（派发词明写 SCOPED ONLY），但 22 次 scoped 运行分布极度两极——
**13 次在 3 秒以内，6 次超过 1 分钟**，最慢 fanin-ri 251 秒（比它省下的全量还长）。慢的全是
tmux/监视器族（ls/lf/ri）——**那是 spawn 型测试的固有成本，人已接受，不在本条范围**。

**真正的收益面**：每次 scoped 运行都要付一遍**完整 `run_static_checks` 固定开销**（各检查 0.4-0.8 秒 +
`checker-mutation-check` 13 秒 ≈ **16 秒**）⇒ 对那 13 个 3 秒以内的 scoped 运行，**固定开销是测试本身的
5 倍以上**。这条的收益面是**每个任务、不是每批一次**。

**杠杆点补充（管理者实测）**：17 次 scoped 调用**全部只跑 1-2 个测试文件**（12 次 1 文件、5 次 2 文件，
无超过 2 的；配对都合理：实现+消费者，如 ruling-required-wiring+inner-blocked-signal、
session-liveness+monitor-mount-check）。既然每次只跑 1-2 个文件，~16 秒静态检查固定开销占比极极端——
**13 个快 scoped 里有 7 个，90%+ 的时间花在静态检查上而非测试本身**（fanin-ss 测试仅 0.2s、fanin-d
0.3s、fanin-pc/rpd 0.8s、fanin-ov 0.9s、fanin-rs 1.2s、fanin-de 1.6s、fanin-a 1.7s）。反过来慢的那几个
（ri 251s、ls/ls2 119-129s）固定开销可忽略，它们慢是 spawn 密集本身，人已裁定这类必要、不动。

**⇒ 这是两个不同问题**：**快测试被固定开销压着（该动静态检查粒度）**；**慢测试是 spawn 成本（不动）**。
本条只动前者的杠杆。

### 选定机制（外层裁定：值得做，且不削弱闸门）

**scoped 加一个「改动相关」静态检查档位；全量套件保持完整不动。**

1. **全量套件（外层 verification-round gate）不变**：完整静态检查 + checker-mutation-check 每次都跑——
   闸门不削弱。scoped 跳过的东西全量必查，延迟发现而非丢弃。
2. **scoped 模式跑「改动相关」子集**：只跑**其检查对象与本次改动 touches 相交**的静态检查 + 总是相关
   的便宜检查（如 contract-consumer 对**被触碰的任务文件**——正是它早前抓到我 7 处 Contract 违规）。
   跳过：`checker-mutation-check`（13s 元检查：验证检查器本身，与本次改动无关；新检查器的自检由该
   任务的 scoped 测试承载）+ 与本次改动无关的仓库级 ratchet 检查（延迟到全量 gate）。
3. **触摸→静态检查相关性映射是机械的**（扩展现有 `select-tests-for-touches` / `--list-files` 机制），
   不是手工维护清单。
4. **权衡写进文档**：scoped = 对改动的快反馈；全量 = 完整闸门。改动相关违规（touched 任务）scoped
   必抓；无关仓库级违规延迟到外层 verification-round 抓——延迟发现，不静默丢弃。

**与三条既定裁定的关系**：spawn 测试保留（人裁定）、3 分钟目标不追求（人裁定）、outer 异步全量不变
（人裁定）——本条只在 scoped 侧省固定开销。

## Acceptance Criteria

- [ ] AC1: scoped 模式跑「改动相关」静态检查子集——对象与 touches 相交 + 总是相关的便宜检查
      （contract-consumer 对被触碰任务）；跳过 `checker-mutation-check` 与无关仓库级检查
- [ ] AC2: **全量套件模式不变**——完整静态检查 + mutation check 每次都跑，静态检查覆盖与今天一致
      （外层 verification-round gate 不削弱；全量跑出的检查集合 == 今天全集）
- [ ] AC3: 触摸→静态检查相关性映射**机械**（扩展现有 select-tests-for-touches / --list-files 机制），
      非手工清单
- [ ] AC4: **双向负控制**——(i) 被触碰任务的 Contract 违规 ⇒ scoped 必抓（改动相关检查在跑）；
      (ii) 与改动无关的仓库级 ratchet 违规 ⇒ scoped 不抓、全量必抓（延迟而非静默丢弃，文档化）
- [ ] AC5: **实测**——快速任务（1-2 文件 scoped）固定开销下降（~16s → 目标 ≤5s，与测试本身同量级，
      即 fanin-ss 0.2s 类任务的 scoped 运行从 ~16s 降到 ~2-5s），before/after 数据贴任务体
- [ ] AC6: 权衡文档化——scoped 快反馈 / 全量完整闸门；延迟发现语义写进 test.sh 头或 CLAUDE.md
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC4/AC5 实跑输出贴任务体
- [ ] 全量套件静态检查覆盖与今日一致（AC2 机械证明：同一全量跑，检查集合不缩水）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- scripts/test.sh（scoped 静态检查档位）
- plugin/scripts/（触摸→静态检查相关性映射，扩展现有 touch 选择机制）
- plugin/test/（AC4 负控制 + 档位测试）
- CLAUDE.md（AC6 权衡文档）

## Contract

measure   scoped_static_overhead = `time scripts/test.sh --scoped <单文件>` 中 run_static_checks 段的秒数
band      scoped_static_overhead = 8（目标上限，秒；从 ~16s 降，与测试本身同量级）
invariant full_gate_unchanged = 1（全量套件静态检查覆盖与今日一致）
invoke    `scripts/test.sh --scoped <被触碰的单测试文件>`
control   被触碰任务的 Contract 违规 ⇒ scoped 必抓（AC4-i）；无关仓库级 ratchet 违规 ⇒ 全量必抓（AC4-ii）
resume    档位实现与全量不变证明分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T03:1xZ
changed: 外层受管理者实测【2】裁定立案（【1】趋势人已接受，只记录不立案）。四处收紧：
(1) **不削弱闸门**——全量套件（外层 verification-round gate）静态检查覆盖与今日一致（AC2 机械证明），
    scoped 跳过的东西全量必查，延迟发现而非丢弃；
(2) **收益面是每任务**——13 个 <3s 的 scoped 运行固定开销 >5× 测试本身；慢的 tmux 族（ls/lf/ri）是
    spawn 固有成本，不在本条范围；
(3) **改动相关映射机械化**——扩展现有 touch 选择机制，非手工清单；
(4) **双向负控制**——touched 任务违规 scoped 必抓、无关仓库级违规全量必抓。
status: todo——优化项，排当前 verification-round 链后；不阻塞。
