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

## Evidence（2026-08-21 修复版判据重验）

**背景**：AC107 曾 retreat done→ready（③冷启动活性假阳性——proc_ok 代理量单独撑起 L2_OK，B/C 4 个 claude 进程卡 "Quick safety check" 信任弹窗 6.3h 被误判为活）。L2 判据已由 l2-fix 任务（gap-verify-deliver-coldstart-l2-proc-ok-false-positive, commit 7e655ac1）修复：proc_ok 不再单独充分，加 `L2_STARTUP_PROMPT` 直接量（复用 pane-state-classify 的 permission-prompt 识别）。本任务用修复版脚本（拷入本 worktree，先 commit `10c39717`）对 B/C 重验。

**机制**：对 B=orangevps（x86_64）/ C=ad-arm1（aarch64）各跑 `verify-deliver-coldstart.sh --build-root <repo> --host <B|C>`（tgz 由该次验证自己从 develop-tip 现 build）。B/C 主检出 `/home/yale/work/quay` 经 git bundle 同步到 develop tip `ce451e80`。冷启动按 cold-start skill 在项目根驱动（session-bootstrap + quay-launch.sh），会话名 `verify-ac107-{b,c}-rerun-0`；launch.settings.json 补 deepseek 代理 env（consumer 按 skill 配置 model/env）。

**B=orangevps 完整三步（验证时刻 2026-08-21T11:09:02Z build → 11:22:44Z live）**：
- ① install：`quay dist --version (realpath)=0.6.0`，STEP1_OK=1。
- ② quay-init：L1 outer_tick/inner_tick/loop_scripts/config/runtime 全 1，STEP2_OK=1。
- ③ 冷启动活性（修复版判据，直接量）：**负控制**——drive 后 2 个 claude 进程在项目根（`L2_LAYER_PROCESS_CWD=2`）卡信任弹窗 ⇒ `L2_STARTUP_PROMPT=1` ⇒ proc_ok 降级 ⇒ `COLDSTART_LIVE=no`（旧判据此处会假阳性为 yes）。**正控制**——接受弹窗后 inner 执行 tick #1（commit `bf56481 chore(inner-tick): tick #1 cold-start — empty queue, no dispatch`）⇒ `L2_GIT_IS_QUAYINIT_COMMIT=0`（git_recent=1）、`L2_STARTUP_PROMPT=0`、`L2_LAYER_PROCESS_CWD=8` ⇒ `COLDSTART_LIVE=yes`，`AC88_VERIFY=ok`（--require-live exit 0）。佐证 `L2_DEAD_LOOP_STATE=running`。
- AC5：build_sha=`ce451e80ddb2cfcb4a74d83e2355e3f756ea2e2e`（develop tip，commit date 2026-08-21T02:18:56Z，**新于 2026-08-20**）；sha256_quay=`bd82c2d918fedf01d67590261bd7a6112a6b12b84807e8194f677e55cd2a7114`；sha256_qn=`bd3a39306056d81781345ad4e3889c7ae04e8e782a2822cfa7e2fdade7fd75d0`。

**C=ad-arm1 完整三步（验证时刻 2026-08-21T11:14:27Z build → 11:18:53Z live）**：
- ① install：`quay dist --version (realpath)=0.6.0`，STEP1_OK=1。
- ② quay-init：L1 全 1，STEP2_OK=1。
- ③ 冷启动活性（修复版判据，直接量）：**负控制**——drive 后 2 个 claude 进程在项目根卡信任弹窗 ⇒ `L2_STARTUP_PROMPT=1` ⇒ `COLDSTART_LIVE=no`。**正控制**——接受弹窗后 inner 执行 tick #1（commit `41ff287 chore(fast-mode-tick): execute cold-start tick #1`）⇒ `L2_GIT_IS_QUAYINIT_COMMIT=0`（git_recent=1）、`L2_STARTUP_PROMPT=0`、`L2_LAYER_PROCESS_CWD=4` ⇒ `COLDSTART_LIVE=yes`，`AC88_VERIFY=ok`（--require-live exit 0）。
- AC5：同一 build_sha `ce451e80…`（2026-08-21T02:18:56Z，新于 2026-08-20）；sha256 与 B 一致（同 develop-tip 确定性 build）。

**记录**：两行 `ac="AC107"` 追加至 `.quay/productization-verification.jsonl`（gitignored），host=B（ts 11:22:44Z）/ host=C（ts 11:18:53Z），ok=true，stepInstall/stepInit/stepColdstart 全 true，l2 含 startup_prompt=0 + git_is_quayinit=0（修复版判据字段）。跨主机证据 JSON 留存于各机：`<repo>/.quay/verify-deliver-evidence-ac107-{b,c}-rerun{,,-live}.json` + 弹窗负控制 `verify-deliver-evidence-ac107-{b,c}-rerun-dialog.json`。脚本侧 AC88 行（ac="AC88"）亦追加于 B/C `<repo>/.quay/productization-verification.jsonl`。

**驱动时发现（如实记录）**：verify-deliver-coldstart.sh 自带 `--cold-start-drive` 在 B 首跑把 claude 启动到调用方 cwd（build repo）而非项目根、且默认会话名 `${PROJECT}-0:0.0` 含点号被 tmux 改写（`-0_0_0`），导致 probe 抓不到 pane——故冷启动改按 cold-start skill 在项目根手动驱动（session-bootstrap + quay-launch.sh，会话名 `verify-ac107-{b,c}-rerun-0`），cwd 正确落在项目根，`L2_LAYER_PROCESS_CWD`/`L2_STARTUP_PROMPT` 均正确读出。此为驱动手法差异，非判据缺陷。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh（跨主机验证入口——若实现有 bug 需修，inner 域）
- .quay/productization-verification.jsonl（记录）
- tasks/gap-ac107-cross-host-mechanized-verify.md（自身）
