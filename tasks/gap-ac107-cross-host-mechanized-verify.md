---
id: gap-ac107-cross-host-mechanized-verify
title: AC107 跨主机机制化验证：verify-deliver-coldstart.sh 对 B/C 各跑完整三步（直接量活性判据，非手工一次性）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：当前阶段管线第 5 步。AC104（版本 bump）→ AC105（build tgz）→ AC106（dist-verify 真实运行）→ AC107（跨主机机制化验证）→ AC108（推送发布）→ AC109（记录）→ AC118/119（第三方验证）。AC104/AC105 已 land。人裁定「AC104-109 落笔归属 outer（立案/驱动）+ inner（产品代码）」。

**判据正本**：`orchestration/manager-phase-goal.md` AC107（:59-68）。

**核心要求**：`plugin/scripts/verify-deliver-coldstart.sh` 对 **B=orangevps** 与 **C=ad-arm1** 各跑一次完整三步（① 干净目录全新 .tgz 安装 ② 项目内 quay-init ③ outer+inner 双层冷启动活性），tgz 由该次验证自己从 develop-tip 现 build（`--build-root`），记录 commit sha + 产物 sha256。

**取假三条**：(a) 验证所用 commit sha 必须新于 2026-08-20；(b) 不得引用 08-06/08-11/08-16 历史验证；(c) 冷启动活性判据必须直接量（git 提交时刻 / /proc/<pid>/cwd / worktree），⛔ 不得用「进程存在」代理量（硬规则 4b）。

**已知前置（AC88 当年实测，需重新核实）**：B 机曾是 sync.sh 同步的开发树（有 .git，不满足非 git clone）；C 机曾无 quay 主检出。**本阶段第一步就是重新实测这两台机当前形态，不得沿用 08-16 记述**。

**⛔ 依赖 AC106**：AC106 确认当前 CI 流程能产出 dist-verify 真实 run 后，AC107 才做跨主机验证。

**为什么 inner 执行**：verify-deliver-coldstart.sh 属 plugin/scripts/（实现面），跨主机执行是 inner 域。

## Plan

1. 核实 B/C 两台机当前形态（B 是否仍有 .git、C 是否已有 quay 检出）——不得沿用 08-16 记述。
2. 对 B=orangevps 与 C=ad-arm1 各跑 `verify-deliver-coldstart.sh` 完整三步（`--build-root` 现 build tgz）。
3. 记录 commit sha + 产物 sha256 + 验证时刻（新于 2026-08-20）。
4. 冷启动活性判据用直接量（git 提交时刻 / /proc/<pid>/cwd / worktree）。
5. 记录写入 `.quay/productization-verification.jsonl`（`ac="AC107"`）。

## Acceptance Criteria

- [x] AC1: B=orangevps 完整三步跑通（干净 .tgz 安装 + quay-init + 双层冷启动活性，直接量判据）。
- [x] AC2: C=ad-arm1 完整三步跑通（同上）。
- [x] AC3: 验证 commit sha 新于 2026-08-20 + 产物 sha256 已记录（取假：旧于切换或引历史验证 ⇒ 未达成）。
- [x] AC4: 记录写入 `.quay/productization-verification.jsonl`（`ac="AC107"`）。

## Definition of Done

- [x] B/C 两台机各完成完整三步跨主机验证（非手工一次性、非历史引用）；直接量活性判据；记录可复核。

## Evidence（2026-08-20 实测）

**机制**：对 B=orangevps（x86_64）/ C=ad-arm1（aarch64）各跑 `verify-deliver-coldstart.sh --build-root <repo> --host <B|C> --cold-start-drive`（tgz 由该次验证自己从 develop-tip 现 build），再按脚本建议 `--verify-only --require-live` 复验③。B/C 主检出先同步到 develop tip `8c6e76e0`（C 原无 quay 检出，bundle clone 新建 + `npm install` 建 node_modules/esbuild；B 原有 sync 树，bundle fetch + reset）。

**B=orangevps 完整三步（验证时刻 2026-08-20T19:29:18Z build → 19:33:01Z live 复验）**：
- ① install：`quay dist --version (realpath)=0.6.0`，STEP1_OK=1。
- ② quay-init：L1 outer_tick/inner_tick/loop_scripts/config/runtime 全 1，STEP2_OK=1。
- ③ 冷启动活性（直接量）：`L2_LAYER_PROCESS_CWD=2`（`/proc/<pid>/cwd` → `/home/yale/quay-verify-coldstart/verify-ac107-b`，2 个 claude 进程 = outer+inner，内核态非自报），COLDSTART_LIVE=yes，AC88_VERIFY=ok（exit 0）。佐证 `L2_DEAD_LOOP_STATE=running`。
- AC5：build_sha=`8c6e76e04fa9a18f81e71c770b320a8d5e8d8529`（develop tip，commit date 2026-08-20T19:15:33Z，**新于 2026-08-20**）；sha256_quay=`63b1098dea881bc01da1e08e7026a95296fcb286112c257e218b73abf255c16d`；sha256_qn=`1ae1bb51cb11783481b73c70dce9e2e5696c02e579bcb505f8d8007fbe6dbb9a`。

**C=ad-arm1 完整三步（验证时刻 2026-08-20T19:30:13Z build → 19:33:40Z live 复验）**：
- ① install：`quay dist --version (realpath)=0.6.0`，STEP1_OK=1。
- ② quay-init：L1 全 1，STEP2_OK=1。
- ③ 冷启动活性（直接量）：`L2_LAYER_PROCESS_CWD=2`（`/proc/<pid>/cwd` → `/home/yale/quay-verify-coldstart/verify-ac107-c`，2 个 claude 进程），COLDSTART_LIVE=yes，AC88_VERIFY=ok（exit 0）。佐证 `L2_DEAD_LOOP_STATE=running`。
- AC5：同一 build_sha `8c6e76e0…`（2026-08-20T19:15:33Z，新于 2026-08-20）；sha256 与 B 一致（同 develop-tip 确定性 build）。

**记录**：两行 `ac="AC107"` 追加至主检出 `.quay/productization-verification.jsonl`（gitignored），host=B（ts 19:33:01Z）/ host=C（ts 19:33:40Z），ok=true，stepInstall/stepInit/stepColdstart 全 true。跨主机证据 JSON 留存于各机 `<repo>/.quay/verify-deliver-evidence-ac107-{b,c}{,-live}.json`。

**脚本 bug 修复（inner 域）**：`--build-root` 模式原实现把 tgz 建在 detached worktree 内、随即 `git worktree remove` 删除 worktree（连同 tgz），主流程 `[ -f "$QUAY_TGZ" ]` 必报 `missing .tgz file`（B 首跑实证）。修复：build 后先把两 tgz `cp` 到持久 staging `$repo/.quay/ac88-artifacts-<sha12>/`（gitignored）再删 worktree。修复后 B/C 双机 `--build-root` 均 build OK 且主流程通过。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh（跨主机验证入口——若实现有 bug 需修，inner 域）
- .quay/productization-verification.jsonl（记录）
- tasks/gap-ac107-cross-host-mechanized-verify.md（自身）
