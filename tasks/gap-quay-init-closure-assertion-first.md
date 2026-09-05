---
id: gap-quay-init-closure-assertion-first
title: quay-init 落地量（142 文件/7.1MB，含 117-131 个机制层脚本）没有任何恒定判据在盯——先落 AC168 的棘轮判据，收缩本体留 W3
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

人 2026-09-02 裁定①：「**quay-init 复制 Claude Code 的各种扩展文件的行为应当废弃，这是非常糟糕的实践。**」
裁定⑥：「quay-init 过程应进一步简化，其主要操作应当是创建符合 quay 要求的项目文件，**而不应该复制这些扩展或脚本**。」
`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` AC168 据此要求安装写入收缩到 §6 闭集，
其判据（SPEC 不变式 AC3 + AC4）是「读一次**真实 laydown** 的产物清单 ⊆ §6 闭集」，且**⛔ 不接受 fixture 自证**
（硬规则 4 推论三：一个只能被注入数据满足的判据不是测量）。

**本任务只落判据、不做收缩本身**——收缩是 W3 的瘦身任务，体量在 `quay-init.sh` 2443 行与约 25 个 `quay-init*.test.mjs` 上。
**判据先行的理由**：2026-09-04 的端到端实测（`docs/proposals/archguard-generation-era-primitives.md` §2.9）
测得落地 **142 文件 / 7.1MB**，核心是 **117–131 个机制层脚本（3.49–3.6MB）逐字节复制进目标项目自己的 git 历史**；
**而没有任何恒定判据在盯这个数**——它此前只在一次性实验里被测过，实验一结束就无人观测。

⚠️ **判据形态取棘轮（ratchet），不取直接断言闭集**：直接断言「⊆ §6 闭集」今天必红，
会把套件弄红并挡住在飞任务。这不是一律 fail-closed 的场合（硬规则 3b 的分寸：
"说实话"零代价，fail-closed 留到判据真正具备输入之后）。
棘轮基线取本任务**实测**的当前值，**只许降不许升**；AC168 落地时把基线一路降到 §6 闭集。
⇒ 今天它绿，但**方向被锁死**：任何让 quay-init 多铺一个文件的改动会当场变红。

## AC

- [ ] AC1 读生产载体：新增 `plugin/scripts/quay-init-closure-ratchet.ts`，对**一次真实 `quay-init --loop` 落地**的产物清单计数（⛔ 不读 `derive_loop_scripts` 的静态推导、⛔ 不读 fixture——SPEC AC4 的反例判据：把注入 seam 关掉后仍能通过才算测量）。
- [ ] AC2 基线与方向：基线 = 本任务**实测**得到的当前落地文件数与字节数（写死并把读数贴进任务体，与 §2.9 的 142/7.1MB 对照）；**只许降不许升**；把基线调高 1 必须变红，该负控制读数入任务体。
- [ ] AC3 三态输出（硬规则 3b 镜像）：真实 laydown 跑不起来时输出**可区分**的 `NOT-EVALUATED`（`evaluated:false`），⛔ 不得与「合格」同形——否则一个读不懂输入的检查器会伪装成通过。
- [ ] AC4 接线并绿：接进套件静态检查注册表（CODE-CLASS，`plugin/scripts/runner-static-gate.ts` 的 `run_static_checks`），本任务落地轮**实际执行且绿**（基线取自实测 ⇒ 当轮应绿）。

## DoD

一次**真实 laydown** 的产物清单被机器读到并与基线比对通过，且**两个方向各实测一次**并留读数：
把基线降 1 必须红（说明它真的在数生产产物）、把基线升 1 必须绿（说明棘轮方向正确）。
⛔ 仅新增脚本与单测不算达成；⛔ 只用 fixture 满足的通过不算达成——那是 SPEC 自己点名的失败形态。

## Touches

- plugin/scripts/quay-init-closure-ratchet.ts（新，读真实 laydown 产物的棘轮判据）
- plugin/scripts/capability-catalog.sh（新脚本六表注册）
- plugin/scripts/runner-static-gate.ts（CODE-CLASS 静态检查注册表接线）
- plugin/test/quay-init-closure-ratchet.test.mjs（新，含基线升降双向负控制与 NOT-EVALUATED 三态断言）
- tasks/gap-quay-init-closure-assertion-first.md（自身）
