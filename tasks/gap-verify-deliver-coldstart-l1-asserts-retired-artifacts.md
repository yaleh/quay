---
id: gap-verify-deliver-coldstart-l1-asserts-retired-artifacts
title: verify-deliver-coldstart 的 L1 断言锚在已退役物（outer/inner tick
  文档）——今天验错对象，AC-168 落地后恒红
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  deliveryCriticalSource: adhoc
goal_ac: AC-168
---
## Proposal

**实测（2026-09-08）**：`plugin/scripts/verify-deliver-coldstart.sh:414-418` 的 L1 五项断言里，两项指向**已退役对象**：

| 断言行 | 断言的文件 | 现状 |
|---|---|---|
| `:414` | `orchestration/orchestrator-loop-tick.md` | outer 作为独立会话角色 **2026-09-04 退役**（`gap-retire-outer-tmux-window-logic` done，`orchestration/SPEC-tmux-retirement-2026-09-03.md` §8） |
| `:415` | `docs/analysis/fast-mode-loop-tick.md` | inner(fast-mode) 已由 worker-driver 取代（CLAUDE.md 三层表逐字） |
| `:416` | `plugin/scripts/loop-driver-check.sh` | 在 |
| `:417` `:418` | `.quay/config.yml` / `.quay/runtime/bin/quay.js` | 在 |

脚本头注释 `:19-20` 还把 `session-liveness.sh` 写成 L1 的「loop 脚本」，而该文件已于 2026-09-03 随 `gap-retire-session-liveness` 删除（实测 `ls plugin/scripts/session-liveness.sh` 不存在），`:173/:174/:183/:190/:195` 仍多处引用它。

**双向失效，两个方向都与「合格」同形**：
- **今天**：跨主机验证跑绿，证明的是「目标项目成功收到了两份退役文档」——**验错对象**。`quay-init.sh:2275-2276` 至今仍铺这两份文档，所以断言恒真。
- **AC-168 落地后**：SPEC §6 闭集明写 ⛔ 不再写入 `orchestration/` tick 文档 ⇒ `L1_OUTER_TICK`/`L1_INNER_TICK` 恒 0 ⇒ `L1_OK`=0 ⇒ `COLDSTART_LIVE` 恒 no ⇒ 验证器从「验错」变「恒红」。

**⊢ 硬规则 4c 实例**：判据点名的量锚在一个**生命周期短于判据本身**的对象上；且两种失败形态（恒真 / 恒假）都出现了。

**修法**：L1 改为断言 `orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` §6 的闭集，**且直接解析该 SPEC 里的 `QUAY-INIT-CLOSED-SET:BEGIN/END` 标记块**（它已经是机器可读的）。⛔ **不在脚本里复制一份闭集清单**——CLAUDE.md 开篇纪律：「在这里复制一份就是制造漂移」，而本任务修的正是一次漂移。

**与既有任务的边界（非重复）**：`gap-quay-init-closure-shrink-body`（todo）是**收缩本体**（改 `quay-init.sh` 的写入面）；本任务是它的**验证器侧对偶**（改 `verify-deliver-coldstart.sh` 的读取面）。两者 Touches 完全 disjoint——那条不碰 `verify-deliver-coldstart.sh`，本条不碰 `quay-init.sh`。本任务**不依赖**收缩落地即可完成：闭集是 SPEC 里已定稿的契约，验证器可以先对齐契约，收缩落地后判据自然转真。

## AC

- [x] AC1: L1 断言集合由 SPEC 的 `QUAY-INIT-CLOSED-SET:BEGIN/END` 块解析得出；`grep -n 'orchestrator-loop-tick\|fast-mode-loop-tick' plugin/scripts/verify-deliver-coldstart.sh` 在**断言位置**（非注释/历史说明行）命中数为 0 —— 引用该计数前先打印命中的前 3 条实际内容（硬规则 2）。
- [x] AC2: 闭集来源单一（负控制，能取假）：在 SPEC 的标记块内临时增删一行，重跑脚本的 L1 判定随之变化 ⇒ 证明真读了 SPEC；若判定不变则说明仍是硬编码副本，AC2 判失败。
- [x] AC3: 标记块读不到时输出 `L1_NOT_EVALUATED=1` 且 `L1_OK` 不取 1——「未评估」与「合格」必须是可区分的两个取值（硬规则 3b）；`--selfcheck` 覆盖该分支并断言其正负控制。
- [x] AC4: 头注释 `:19-20` 及 `:173/:174/:183/:190/:195` 对 `session-liveness.sh` 与两份 tick 文档的描述同步更正——该文件已删，描述与实现不得继续分叉。
- [x] AC5: `bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` exit 0，且 AC2/AC3 两个新分支在 `plugin/test/verify-deliver-coldstart.test.mjs` 有直接覆盖（非仅靠 selfcheck 自证）。
- [x] AC6: 用重锚后的脚本在 **B=orangevps 与 C=ad-arm1 各真跑一次**完整三步（`--build-root` 从当前 develop-tip 现 build），记录追加至 `.quay/productization-verification.jsonl`，含 commit sha + 产物 sha256 + ISO 时刻。

## DoD

重锚后的判据在 B/C 两台机上、对一个**当前 develop-tip 现 build 的产物**各跑出一次可复核记录，且该记录里的 L1 成员逐条 ∈ SPEC §6 闭集。

⛔ **只改脚本与测试、不做 B/C 真实跑，不算达成**——本任务的全部价值就在「验证器验的是当前契约」这一点上，而 A 机自带 `plugin/`，SPEC §6b 已逐字论证该类缺陷「在本仓库永远复现不出来」（硬规则 4：在这里绿是结构上不可能取假的量）。判据必须落在无本地 `plugin/` 的宿主上。

## Evidence

**AC6 B/C 真跑（2026-09-08）**：重锚后的 `verify-deliver-coldstart.sh` 在 B=orangevps（x86_64）与 C=ad-arm1（aarch64）各真跑完整三步（`--build-root /home/yale/work/quay` 从 develop-tip `adea4c8d9` 现 build），两行记录已追加至 `.quay/productization-verification.jsonl`：

- B（ts `2026-09-08T13:24:19Z`）：`build_sha=adea4c8d99f90b4919893054d4f33045f60463ee` `sha256_quay=ecae763daa8c0c4a3835bd46db692b8e9835618d46a53112cf7e3b88283a76e7` `sha256_qn=e8c2b94664cfdd0416c5d543e5b26abb73c36afa0cce90d5a8eb78435c36f8cd`；L1 成员 6 条逐条 ∈ SPEC §6 闭集，`present=5/6`（`missing=.claude/settings.json`——收缩 `gap-quay-init-closure-shrink-body` 未落地，验证器如实报当前契约未满）。
- C（ts `2026-09-08T13:24:29Z`）：`build_sha=adea4c8d99f90b4919893054d4f33045f60463ee` `sha256_quay=fef4e20555042e1a0fb14b368847a74ce62110b1dbd20aae2ad7a356dd1794ed` `sha256_qn=216f6395b4fbd99b7b6ce5192ffa77a80cdd39934cfa5e22aa545d3b0b6e59c2`；L1 成员同 6 条 ∈ 闭集，`present=5/6`。

两机 `L1_NOT_EVALUATED=0`（真读到 SPEC），`L1_CLOSED_SET=.quay/config.yml .quay/profiles.yml tasks/ .gitignore .claude/launch.settings.json .claude/settings.json`——全部解析自 SPEC §6 标记块，非硬编码副本。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-verify-deliver-coldstart-l1-asserts-retired-artifacts.md
