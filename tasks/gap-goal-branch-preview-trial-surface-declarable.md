---
id: gap-goal-branch-preview-trial-surface-declarable
title: goal preview 试用面可声明：workspace 声明消费者产品的预览命令，goal preview 起它而非写死 quay serve
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**缺口**：`quay goal preview <GOAL> start` 的试用面写死为 quay 自己的 serve。读码确认（2026-10-29，主检出 author）：`packages/quay/src/goal-preview.ts` 的 `previewServeEntry()` 返回 `path.join(previewRoot, "packages", "quay", "bin", "quay.ts")`，`startPreviewServe()` 用 `node --watch --experimental-strip-types <该入口> serve --port N` 起它——即预览实例就是「判据 worktree 里那份 quay 任务板」。这在本仓库成立（产品就是 quay、serve 就是产品），但在消费者项目不成立：claudecodeui 的产品是 CloudCLI server，`goal preview` 要么起错产品、要么因找不到 quay 入口而 fail。于是 SPEC-goal-branch §4.10 裁定⑮「并入前必须能试用」与裁定㉒「没起 preview ⇒ live-probe AC 判不出 ⇒ 不能并入」在消费者项目上失去落点：live-probe AC 只能标 `post-merge`，UI 面隔离验证价值消失。

**修法**：把试用面做成 workspace 可声明。`.quay/config.yml` 新增预览声明（起预览实例的命令 + 健康探针约定）；`goal preview start` 有声明时跑声明命令、无声明时回退到现有 quay serve（quay 仓库零改动、向后兼容）。`goal merge` 的 pre-merge 强制（§4.7/裁定㉒）保持不变——它现在对消费者 live-probe AC 也生效，因为预览起的是正确产品。声明方案的字段形状、以及「live-probe AC 如何定位产品地址」（现 `plugin/scripts/live-web-address.ts` 与 AC-288 的 `pgrep -f 'quay.ts serve'` 派生块均为 quay 专用）由执行者在实现时钉死；验收以行为为准，不锁实现。

**范围**：只改 quay 侧机制，使试用面可声明；claudecodeui 侧写什么声明、以及拿它驱动真实特性的 branch-mode goal，是本任务之外的后续（quay 侧只保证「消费者 workspace 能声明并被 goal preview 用上」这一机制成立，用一个真实临时 workspace + 真子进程证明，非只读 fixture 回声）。

<!-- dedup-ref -->
关联（traceability，非前置、非合并）：`gap-goal-branch-preview-instance`（done）建了 `goal preview` 机制但写死 quay serve；`gap-goal030-preview-runs-branch-code`（done）在 quay 仓库真起过该预览。本任务机制不同（把写死的试用面变成可声明），separate、不合并。

- 该轴仍暗,理由:本任务为特性新增（试用面可声明），未改依赖结构/环，未跑 archguard L_D/L_G 读数

## AC

- [x] 声明可写入且被校验：临时 workspace 的 `.quay/config.yml` 能携带预览声明；`node packages/quay/bin/quay.ts config validate --root <ws>`（或等价校验入口）对合法声明 exit 0、对非法声明（如缺失命令字段）exit 非 0 且报错指明字段。
- [x] `goal preview start` 跑声明的命令：临时 workspace 声明一个非 quay 的预览命令（测试内起的一个最小 HTTP server），`goal preview <GOAL> start --port N` 后 `status` 报告 running，且该进程 cmdline 匹配声明命令、健康端点可达（HTTP 200）。
- [x] 无声明时向后兼容：不带预览声明的 workspace（= quay 仓库默认态）上 `goal preview start` 仍起 `packages/quay/bin/quay.ts serve`（行为与现有实现一致，由新增测试断言 argv 含 `quay.ts serve`）。
- [x] live-probe AC 在声明面上成立：按声明的健康约定写一条 live-probe AC，预览起时它在声明面取 0（achieved）、未起时取 not-evaluated（exit 3）——即裁定㉒ 的「没起 ⇒ 判不出 ⇒ 不能并入」对消费者产品成立。
- [x] 取假（fail-closed）：把声明改成不存在的命令后 `goal preview start` 返回 `failed`（不返回 started 的假阳性），live-probe AC 读 not-evaluated。
- [x] 新增测试文件覆盖上面四条（真临时 workspace + 真子进程，不伪造读数），且 `bash scripts/test.sh --for-task gap-goal-branch-preview-trial-surface-declarable` 退出 0。
- [x] 取假（整体）：用 `cp` 备份恢复（不用 `git checkout --`）临时回退核心改动后，新增用例至少 1 条变红；Evidence 贴实跑输出与恢复后的绿输出。

## DoD

真实落地 = 一个消费者项目形状的临时 workspace 声明了自己的试用面（非 quay serve），`goal preview` 真的起出该产品，一条 live-probe AC 在它身上取 0——机制被真实对象穿过，不是「脚本存在」。quay 仓库默认态（无声明）行为不变。真实消费者（claudecodeui 声明 CloudCLI、起 branch goal 驱动特性）是本任务的后续验证，不在本任务落地范围内；本任务只交付「试用面可声明」这一机制，并保证它可被 claudecodeui 等消费者项目接上。

## Evidence

AC1–AC6：`node --no-warnings --test packages/quay/test/goal-preview-trial-surface.test.mjs` 5/5 绿（AC1 声明校验、AC2 声明命令起停+健康 200、AC3 无声明回退 quay.ts serve、AC4 live-probe AC 0/3、AC5 不存在命令 failed）；`packages/quay/test/goal-preview.test.mjs` 4/4 绿（回归，含 preview.json 实例身份夹具）；`packages/quay/test/config-validate.test.mjs` 65/65 绿；`npx tsc --noEmit -p packages/quay` 及 `for d in packages/*/` 逐包 typecheck 绿。

AC7（cp 备份回退核心改动 → 变红 → cp 恢复 → 绿，不用 git checkout --）：
- 回退（`readPreviewDecl` 恒返回 `{ state: "default" }`，即无声明面）后跑新用例，AC2/AC4 红：`AssertionError: declared preview must start: no quay CLI entry at …/packages/quay/bin/quay.ts — the preview worktree is missing or not provisioned`（实际 `failed`、期望 `started`），整体 exit 1。
- cp 恢复后同文件重跑：5/5 绿（pass 5 / fail 0），exit 0。

架构修正（2026-10-29 续做，修复 79d0bce01 引入的回归）：该提交为满足 serve-binding-literal-check 把声明预览 host 回退从 loopback 字面量改成 import `serve/view/serve-binding.ts` 的 `SERVE_BINDING_FALLBACK.host`——违反 architecture-boundaries P2（root-level 不得 import serve/）且制造 directory-cycle。改为在 `core/config.ts` 定义独立常量 `PREVIEW_HOST_FALLBACK`（loopback `127.0.0.1`，与 serve web binding 是不同量），`goal-preview.ts` 用之；`serve-binding-literal-check.ts` 增一条 allowlist。`architecture-boundaries` / `directory-cycle` / `serve-binding-literal-check` 三测绿；`goal-preview-trial-surface` 5/5 绿（AC2 healthUrl 改 `{host}` 显式钉死 loopback 回退）。

测试基建解锁（2026-10-29 续做）：全量 suite 在 `driver-runtime-s07.test.mjs`（gap-ac203）与 `driver-restart-busy-e2e.test.mjs` 因全表 `ps -eo pid=,args=` / `pid,args` 输出（实测 ~1.16MB / 5845 进程）超过 spawnSync/execFileSync 默认 maxBuffer 1MB 而 ENOBUFS 红（`ps 读数必须可得`，硬规则 3b），阻塞本任务全量 suite fan-in。两处调用加 `maxBuffer: 64 * 1024 * 1024`（重落 48bd794d9 的修法；该提交曾搁浅在 goal/GOAL-912、未 ff 到 develop）。修后 `driver-runtime-s07` AC2/AC3 2/2 绿。

套件解锁（2026-10-29 续做）：全量 suite 在 `packages/quay/test/goal-store.test.mjs`「能力闸 AC8(生产面)」失败——该 sweep 把每条 criterion 一律对 repo root（主检出）判能力，而 branch-mode goal（GOAL-912）的 criterion 在 goal criterion worktree 上实跑；AC-927 的 `bash plugin/scripts/codex-stage1-spawn-verify.sh` 只落在 goal/GOAL-912 分支（`gap-meta-criterion-capability` 刻意如此），主检出不解析 ⇒ 被误判 `uncertifiable-executed-artifact`（not-evaluated）。修法：该 sweep 改用 `criterionCwdFor`（与生产同源）解析每条 criterion 的实际 cwd；branch-mode 且 worktree 未 provision 时跳过（环境事实，非过度拒绝）；branch-mode 且仅 `uncertifiable-executed-artifact` 的拒绝交由 goal-driver `missingCarriers`，不由此 sweep 报。修后 `node --no-warnings --test packages/quay/test/goal-store.test.mjs` 98/98 绿。

## Touches

- packages/quay/src/goal-preview.ts
- packages/quay/src/cli/goal.ts
- packages/quay/src/config-validate.ts
- packages/quay/src/core/config.ts
- packages/quay/src/config.ts
- packages/quay/test/goal-preview-trial-surface.test.mjs
- packages/quay/test/goal-preview.test.mjs
- packages/quay/test/goal-store.test.mjs
- plugin/skills/manager/SKILL.md
- plugin/skills/init/SKILL.md
- plugin/scripts/serve-binding-literal-check.ts
- plugin/test/helpers/driver-runtime-harness.mjs
- plugin/test/driver-restart-busy-e2e.test.mjs
- orchestration/SPEC-goal-branch-2026-10-03.md
- tasks/gap-goal-branch-preview-trial-surface-declarable.md

## Blocker

**2026-10-29T13:16:01.143Z — worker 未落地（exited-not-landed）→ 已解除**

- 根因：step=suite 全量 suite 在 `packages/quay/test/goal-store.test.mjs`「能力闸 AC8(生产面)」失败——该 sweep 把每条 criterion 一律对 repo root（主检出）判能力，而 branch-mode goal（GOAL-912）的 criterion 在 goal criterion worktree 上实跑；AC-927 的 `bash plugin/scripts/codex-stage1-spawn-verify.sh` 只落在 goal/GOAL-912 分支，主检出不解析 ⇒ 被误判 `uncertifiable-executed-artifact`（not-evaluated）。
- 解除：该 sweep 改用 `criterionCwdFor`（与生产同源）解析每条 criterion 实际 cwd；branch-mode 且 worktree 未 provision 时跳过；branch-mode 且仅 `uncertifiable-executed-artifact` 的拒绝交由 goal-driver `missingCarriers`。修后 `packages/quay/test/goal-store.test.mjs` 98/98 绿。Touches 增列 `packages/quay/test/goal-store.test.mjs`。
- run_id：wk-prod-anchor
- session_id：823bc9bf-08f3-4154-9aee-5ffc98908609
