---
id: gap-ac88-verification-mechanism-extend-deliver
title: "AC88 前置：扩展交付验证机制覆盖 quay-init + 冷启动（outer+inner）——现状只到装 tgz + 端口探活"
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：AC88 跨主机验证的前置缺口（manager 2026-08-16 实测指出，commit `71677c8f`；outer 2026-08-16
复核确认）。

**现状缺口（实测）**：`plugin/scripts/develop-deliver-tgz.sh`（DIR-123）只覆盖
「`npm install -g <quay.tgz> <quay-native.tgz>` → `quay serve --port <p>` → curl http_code==200」。
**`grep quay-init` 该脚本 = 0 命中**——无初始化步骤；③冷启动也没有（只有 quay serve 端口 HTTP 探活，
不是 AC88 要求的「outer/inner 冷启动」）。

**AC88 要求**（人 2026-08-06 裁定范围，2026-08-16 复核仍适用）：①正确安装 ②正确初始化（项目内
`quay-init`）③正确冷启动（outer + inner，不含 manager）。安装源 = 本机 `package.sh` 产出的 `.tgz`。

**缺口后果**：outer 直接驱动 B/C 会退化成「验证这次做到了」而非「机制可重复」——正是要避免的形态。
**必须先有机件**：一个可重复的脚本覆盖 安装→初始化→冷启动 三步。

## Plan

1. 扩展 `develop-deliver-tgz.sh`（或新增等价验证脚本），在现有「装 tgz + 端口探活」之后补：
   - ② 项目内 `quay-init`（在一个干净的空目录做项目初始化，验证 init 成功）
   - ③ 冷启动：outer + inner（不含 manager）——用 quay 自身 shipped 的 cold-start/loop 机制起双层，
     验证两层都活（直接量：git commit / 心跳 / 进程，非仅 HTTP 探活）
2. 机器形态处理：
   - **B=orangevps**：当前 `~/work/quay` 是 sync.sh 同步的 git 开发树（有 .git）⇒ 是 AC88「⛔ 非 git clone」
     排除的形态。**决策（outer 2026-08-16）：git 开发树不满足 AC88 判据**——验证必须在干净目录从 `.tgz`
     全新安装，不复用 dev 树。
   - **C=ad-arm1**：`~/work/` 下无 quay 主 checkout，只有历史 worktrees ⇒ 从零安装（机制需支持 fresh
     install）。
3. 判据能取假：脚本跑完，B/C 各机可核对的产物（安装目录 + quay-init 输出 + 双层冷启动证据），
   验证时间新于 AC85 产物时间。
4. 结果写回 AC89 记录（.quay/productization-verification.jsonl）。

## Acceptance Criteria

- [x] AC1: 机制（脚本）覆盖 ①安装 `.tgz` ②项目内 `quay-init` ③冷启动（outer+inner），三步顺序完整。
- [x] AC2: ③冷启动判据是「双层（outer+inner）活性」的直接量（git 提交/心跳/进程），不是仅 `quay serve`
      端口 HTTP 探活。
- [x] AC3: B=orangevps 验证在**干净目录全新 .tgz 安装**进行（不复用 sync.sh git 开发树——那是
      AC88「非 git clone」排除的形态）。
- [x] AC4: C=ad-arm1 支持从零全新安装（当前无主 checkout）。
- [x] AC5: 机制跑完产出可机械核对的证据——验证所用 tgz 由该次验证自己从 develop-tip 现 build，
      记录该 build 的 `git rev-parse HEAD`（commit sha）+ 产物 sha256；达成 = 该 sha 新于
      2026-08-16 阶段切换。⛔ 判据不得引用生命周期短于判据本身的对象（AC85 产物随 worktree 已消失）。

## Definition of Done

- [x] AC88 跨主机驱动有可重复的机制（安装→初始化→冷启动），B/C 两机的执行不再是手工一次性形态。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh（新增——AC88 三步交付验证机制，等价验证脚本）
- plugin/scripts/loop-shipping-exclusion-data.mjs（排除表——verify-deliver-coldstart.sh 条目所在，target-layout 类同 quay-init.sh）
- plugin/scripts/capability-catalog.sh（登记 verify-deliver-coldstart.sh 机件声明）
- plugin/test/verify-deliver-coldstart.test.mjs（新增——机制 hermetic 自检）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照 scripts 254→255）
- tasks/gap-ac88-verification-mechanism-extend-deliver.md（自身）

## Test-Files

- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/test/capability-catalog.test.mjs
- plugin/test/verify-delivery-surface.test.mjs

## Evidence

- AC1（三步顺序完整）：`verify-deliver-coldstart.sh` 主流程按 ①`step1_install`（隔离 npm 前缀全新 .tgz 安装，断言 quay/quay-native 可运行）→ ②`step2_init`（项目内 shipped quay-init --loop，L1 铺到位检查：outer tick doc + inner tick doc + session-liveness.sh + .quay/config.yml + .quay/runtime/bin/quay.js）→ ③`step3_coldstart`（双层直接量活性）顺序调用。复算：`bash plugin/scripts/verify-deliver-coldstart.sh --help`（三步形态写在 header）+ `--selfcheck`（exit 0）。
- AC2（冷启动判据 = 双层活性直接量）：`probe_direct_measures`/`coldstart_verdict` 用 git 提交时间戳（且排除 `chore(quay-init):` auto-commit）+/proc/<pid>/cwd + git worktree 在飞任务数，不用层自己的心跳自报、不是 `quay serve` HTTP 探活。复算：`--selfcheck` 正/负控制——仅 chore(quay-init) 提交 ⇒ COLDSTART_LIVE=no（能取假），真实循环提交 ⇒ yes。
- AC3（B=orangevps 干净目录全新安装）：`step1_install` 用 `npm install -g --prefix <隔离前缀>`，`step2_init` 用全新空项目目录，绝不复用 sync.sh git 开发树；驱动时以 `--build-root` 自 build + `--prefix`/`--root` 指干净路径。
- AC4（C=ad-arm1 从零全新安装）：脚本对空宿主无前提——①从 .tgz 全新装（或 --build-root 现 build）→②空项目 init →③冷启动；不依赖任何既有 checkout/worktree。
- AC5（证据可机械核对，锚定 commit sha + sha256）：`ac5_evaluate` 计算两 tgz 的 sha256 + 记录 build_sha/build_date（--build-root 时本脚本自取 develop-tip 的 `git rev-parse HEAD` 与其提交时间）；达成 = build_sha 为 40-hex 且 build_date ≥ 2026-08-16T00:00:00Z（阶段切换日）。⛔ 判据只锚定 commit sha / 内容 sha256 / ISO 提交时间——不引用 AC85 产物路径（生命周期短于判据，随 worktree 已消失）。复算：`--selfcheck` AC5 三态控制——recent-build ⇒ ok=1、old-build ⇒ ok=0、no-sha ⇒ evaluated=0（可区分「未评估」≠「不合格」，硬规则 3b）。

## 标注（gap-fan-in-delta-scope-inventory-annotate）

> **⚠️ 落地未经全量轮验证**（runId `fm-gap-fan-in-delta-scope-inventory-annotate-1787312000000-inv`，2026-08-21）
> 父任务 gap-fan-in-delta-scope-doc-only-skip AC1 枚举：本任务 fan-in 记录 `fullSuiteRan=false` ∧ `skipReason=doc-only-delta`，但实际 diff 含非 doc 文件，落地当时未被全量轮覆盖：
> ```
>     docs/proposals/quay-product-outline.md
>     plugin/scripts/capability-catalog.sh
>     plugin/scripts/loop-shipping-exclusion-data.mjs
>     plugin/scripts/verify-deliver-coldstart.sh
>     plugin/test/outer-cron-registry.test.mjs
>     plugin/test/verify-deliver-coldstart.test.mjs
> ```
> **补跑判定（AC2）：不需补跑全量轮** —— 落地（merge `5e51bb35a6359bc5dbef1bf166ce70c6ddadf16b` @ `2026-08-16T09:30:59+00:00`）后 develop 已有 **187** 轮 `fullSuiteRan=true` 全量轮运行（green **184** 轮，最后 gap-docs-t3-webui-doc-and-screenshots @ 2026-08-21T13:12:56.151Z）覆盖其改动。
