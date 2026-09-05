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

- [x] AC1 读生产载体：新增 `plugin/scripts/quay-init-closure-ratchet.ts`，对**一次真实 `quay-init --loop` 落地**的产物清单计数（⛔ 不读 `derive_loop_scripts` 的静态推导、⛔ 不读 fixture——SPEC AC4 的反例判据：把注入 seam 关掉后仍能通过才算测量）。
- [x] AC2 基线与方向：基线 = 本任务**实测**得到的当前落地文件数与字节数（写死并把读数贴进任务体，与 §2.9 的 142/7.1MB 对照）；**只许降不许升**；把基线调高 1 必须变红，该负控制读数入任务体。
- [x] AC3 三态输出（硬规则 3b 镜像）：真实 laydown 跑不起来时输出**可区分**的 `NOT-EVALUATED`（`evaluated:false`），⛔ 不得与「合格」同形——否则一个读不懂输入的检查器会伪装成通过。
- [x] AC4 接线并绿：接进套件静态检查注册表（CODE-CLASS，`plugin/scripts/runner-static-gate.ts` 的 `run_static_checks`），本任务落地轮**实际执行且绿**（基线取自实测 ⇒ 当轮应绿）。

## 基线读数（2026-09-05 实测，两条基线 + 三个负控制）

**全量 laydown**（`quay-init --all --loop --manager`，含生成态 `.quay/`，与 §2.9 同口径）：
`136 文件 / 6,886,001 字节`（主检出实测）。**与 §2.9 的 142/7.1MB 对照**：更低，因为 §2.9（2026-09-04）之后机制层脚本有退役（observer 机制 09-03 退役等），脚本数 117–131 → 111。

**棘轮基线**（判据实际用的量，`⛔ 排除 .quay/`）：
`130 文件 / 3,820,122 字节`。**为什么排除 `.quay/`**：它是 quay 自己的生成态命名空间——`config.yml` 内嵌随机 target 绝对路径（mcp_entry/repo_root/worktree_root）、`quay-init-state.json` 内嵌 `laidAt` 时间戳 + runtime sha256、`.quay/runtime/` 是 gitignored 生成 dist（字节随构建环境变）。**含它们则字节基线在主检出与全新 worktree 间不可复现**（本任务实测：主检出 dist 重建后 worktree 再建，dist 差 ~13KB ⇒ 全量字节 6,886,001 → 6,899,047 假红）。排除后**连续两次 laydown 字节逐字节一致**（3,820,122 == 3,820,122），跨环境可复现——棘轮锁的是「逐字节复制的稳定拷贝集」（pollution footprint），不是生成态。

**负控制读数（两个方向各实测一次，入任务体）**：
- `checkClosureRatchet({files:130,bytes:3820122}, {files:129,bytes:3820122})` ⇒ `ok:false`（基线降 1 必红，证明真在数生产产物）——单测 `基线降 1 必须红` 钉住。
- `checkClosureRatchet({files:130,bytes:3820122}, {files:131,bytes:3820122})` ⇒ `ok:true`（基线升 1 必绿，证明棘轮方向正确、只许降不许升）——单测 `基线升 1 必须绿` 钉住。
- 落地量涨 1（fake laydown 3 文件 vs 基线 2）⇒ checker 必红——mutation case `checker-mutation-cases/quay-init-closure-ratchet.sh` 实测 `exit 0`（绿→红→绿 三态全证）。
- 真实 laydown 跑不起来（无 `quay-init.sh`）⇒ `evaluated:false`、exit 3 `NOT-EVALUATED`——单测 `hard rule 3b` 钉住。

**本任务落地轮实测**：`node quay-init-closure-ratchet.ts --gate --root <worktree> --json` ⇒ `{"evaluated":true,"files":130,"bytes":3820122,"ok":true,...}`（绿）；`checker-mutation-check --list` ⇒ `checkers_total:60 checkers_with_mutation:60 uncovered:none`（新 checker 已覆盖）；catalog `--summary` ⇒ `311 scripts | 311 declared | 0 unclassified`。

## DoD

一次**真实 laydown** 的产物清单被机器读到并与基线比对通过，且**两个方向各实测一次**并留读数：
把基线降 1 必须红（说明它真的在数生产产物）、把基线升 1 必须绿（说明棘轮方向正确）。
⛔ 仅新增脚本与单测不算达成；⛔ 只用 fixture 满足的通过不算达成——那是 SPEC 自己点名的失败形态。

## Touches

- plugin/scripts/quay-init-closure-ratchet.ts（新，读真实 laydown 产物的棘轮判据）
- plugin/scripts/checker-mutation-cases/quay-init-closure-ratchet.sh（新，checker-mutation-check 必配的 mutation case：绿→红→绿 三态）
- plugin/scripts/capability-catalog.sh（新脚本六表注册）
- plugin/scripts/runner-static-gate.ts（CODE-CLASS 静态检查注册表接线）
- plugin/test/quay-init-closure-ratchet.test.mjs（新，含基线升降双向负控制与 NOT-EVALUATED 三态断言）
- tasks/gap-quay-init-closure-assertion-first.md（自身）
