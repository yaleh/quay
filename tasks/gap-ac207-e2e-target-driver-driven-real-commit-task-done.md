---
id: gap-ac207-e2e-target-driver-driven-real-commit-task-done
title: 端到端：目标项目自己的 *-drivers 驱动出真实开发提交且任务翻 done，落 ac=GOAL-009-AC-207 记录（AC-207）
status: ready
needs_human_cause: unclassified
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
  needs_human_cause: 第 12 轮（2026-09-10 14:1xZ）新阻塞：e2e 机械 fan-in 的 ff 步因
    ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING 失败——worker-driver.ts
    resolveKernelSrcModule 把动态 import 的 ff-merge.ts/gate-event-store.ts 解析到
    node_modules 下的 .ts（shipped 打平布局），Node ≥23.7
    拒剥。位置判定：resolveKernelSrcModule(:3468) + 两调用点 :3716/:3491；orangevps Node
    v25.2.0 复现 exit。已立新任务
    gap-resolve-kernel-src-module-strip-types-node-modules（todo）。AC1/AC4 done
    不变；AC2/AC3/AC5 仍阻塞，待该任务落 develop + 第三方重装后复跑 e2e。
goal_ac: AC-207
depends_on:
  - gap-driver-resource-gate-path-anchored-at-root-third-party
  - gap-shipped-profiles-missing-worker-roles
  - gap-promotion-driver-ready-pool-check-path-third-party
  - gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync
  - gap-driver-fanin-hardcoded-test-sh-third-party
  - gap-fanin-gate-event-store-path-shipped-unsafe
  - gap-resolve-kernel-src-module-strip-types-node-modules
  - gap-third-party-evidence-no-transport-to-driving-repo-carrier
  - gap-ac207-e2e-producer-section-never-landed-on-develop
---
## Proposal

正本判据 `goals/AC-207-端到端-目标项目自己的-drivers-驱动出真实开发提交且任务翻-done.md`（goal=GOAL-009，2026-09-09 人裁定）：exit 0 = 载体 `.quay/productization-verification.jsonl` 存在 `ac="GOAL-009-AC-207"` 记录，且 host≠本机 ∧ project_root ∉ 本仓库 ∧ commit_sha/task_id 非空 ∧ task_status=done ∧ gate_events>0 ∧ produced_by_driver=true。exit 1 = 无（当前，从未发生）；exit 3 = 载体缺失。

**现状（实测，位置判定）**：2026-09-09 干跑 exit 1。载体无 AC-207 记录；字段 `produced_by_driver` / `gate_events` 全仓库零命中——无人写这条记录。

**修法**：把「端到端自证」接成 verify-deliver-coldstart.sh 的一段验证步骤 + 一条载体记录。硬顺序（GOAL-009 风险 1）：AC-202（done，机件进包）→ AC-203（ready，driver 真活）→ AC-207（本任务端到端组装）；AC-204/205/206 覆盖 init 只写启用、会话投递、goals+tasks 双载体，本任务在其上做端到端驱动。

**边界（照实说明，不假装机械）**：produced_by_driver 的最强可得直接量只到「提交出自 driver 建的任务 worktree ∧ gate 事件齐全 ∧ 时间线交错」，不能完全排除人在会话手敲——该半判据属人裁定口证，不冒充测量（AC-207 正文逐字）。证据必须外部可核：commit_sha 取第三方项目自身 git 历史（经共享裸仓库镜像可核），⛔ 不采信驱动方自述（硬规则 4b）。产品/夹具边界：允许 claude --bg / -p 作验证手段，但产品文档与 skill 文案不得因此声称 quay 会启动会话。

## Plan

1. **接线验证步骤**：`plugin/scripts/verify-deliver-coldstart.sh` 新增 AC-207 端到端段——在 host B/C 的第三方项目里，用已 shipped 的 `quay-init.sh` + goals+tasks 双载体创建一条真实任务，由其自身 promotion-driver → worker-driver 驱动：建任务 worktree → 产生实现提交（⛔ 排除 `chore(quay-init):` auto-commit，硬规则 4b）→ 记 gate 事件 → 翻 done。
2. **直接量读取**：`commit_sha` = 第三方项目 `git log`（任务 worktree 提交）；`task_id`/`task_status` = 目标项目 task store；`gate_events` = `.quay/gate-events.jsonl` 计数；`produced_by_driver` = 「提交出自 driver 建的任务 worktree ∧ gate 事件齐全 ∧ 时间线交错」；缺任一读数不写（fail-closed，硬规则 3b）。
2b. **（第 11 轮新增，必做第一步）先在本任务 worktree 执行 `git merge develop`**——理由、冲突面与解法见下方「结构性阻塞：验证脚本的两半分居两个分支」一节。⛔ 不做这一步的任何一次验证跑，用的都是缺一半的脚本。
3. **载体落账**：经 `ac89_append_goal009()` 落账（`build_sha`/`ts` 由 helper 统一补——AC-214 新鲜度锚只认 top-level `build_sha`），追加 `{"ac":"GOAL-009-AC-207","host","project_root","commit_sha","task_id","task_status","gate_events","produced_by_driver"}`；⛔ `commit_sha` 是异仓库 sha，不作新鲜度锚。
4. **生产复跑**（host B/C + 第三方项目）使判据 exit 1 → exit 0。

## Touches

- `tasks/gap-ac207-e2e-target-driver-driven-real-commit-task-done.md`

## Acceptance Criteria

- [x] AC1 机制接线：`grep -c 'GOAL-009-AC-207' plugin/scripts/verify-deliver-coldstart.sh` ≥ 1，且 `produced_by_driver`、`gate_events` 两字段名在脚本内各 ≥ 1 命中；贴前 3 条命中（硬规则②）。
- [ ] AC2 直接量：贴出读 commit_sha/task_id/task_status/gate_events/produced_by_driver 的命令与命中行——commit_sha 出自第三方 git log（非驱动方自述），gate_events 出自 .quay/gate-events.jsonl 计数。
- [ ] AC3 载体落账：生产载体出现 `ac="GOAL-009-AC-207"` 记录，host≠本机 ∧ project_root∉本仓库 ∧ commit_sha/task_id 非空 ∧ task_status=done ∧ gate_events>0 ∧ produced_by_driver=true（逐字段满足 criterion 过滤）。
- [x] AC4 负控制（能取假）：注入一条 produced_by_driver=false 或 host=本机 或 gate_events=0 的记录 ⇒ criterion 仍 exit 1；验证后移除、不污染生产载体。
- [ ] AC5 判据翻转：AC-207 criterion 干跑从 exit 1 → exit 0（贴出干跑输出）。

## Definition of Done

AC1–AC5 全绿；`scripts/test.sh` 全量绿（含 `plugin/test/verify-deliver-coldstart.test.mjs`）。AC-207 criterion exit 0：宿主为 B/C 之一，project_root 为第三方项目（∉ 本仓库），commit_sha 外部可核（第三方 git 历史 / 共享裸仓库镜像），task_status=done、gate_events>0、produced_by_driver=true。⛔ 产品文档与 skill 文案不得因本任务声称 quay 会启动会话（SPEC-tmux-retirement-2026-09-03 原样保留）。

## Evidence

AC1 ✅ 机制接线（merge develop 后复验）：`grep -c 'GOAL-009-AC-207'`≥1、`produced_by_driver`/`gate_events` 两字段名各 ≥1 命中；`--selfcheck` exit 0 且含 ac207-record 正/负控制（valid wrote=1 fields_ok=1 / produced_by_driver=false refused=1 / gate_events=0 refused=1），与 develop 侧 AC-203/201/206/204/205 控制一并 PASS。`plugin/test/verify-deliver-coldstart.test.mjs` 11/11 绿。

AC4 ✅ 负控制：向生产载体注入 produced_by_driver=false 与 host=本机 各一条 ⇒ AC-207 criterion 仍 exit 1（判据能取假）；载体已字节级还原。selfcheck 内 hermetic 负控制（ac207-record produced_by_driver=false / gate_events=0 各 refused=1）已覆盖。

AC2/AC3/AC5 ⛔ 阻塞（第 4 轮，2026-09-09T22:39Z）：原阻塞（resource-gate 锚 opts.root ⇒ 第三方 exit 127）已解除——`gap-driver-resource-gate-path-anchored-at-root-third-party` 已 done 落 develop（6acf9e8a2）。本轮实测两个【新】阻塞，均在本任务 Touches 之外：

① **shipped `plugin/.quay/profiles.yml` 缺 worker roles（产品缺陷）**：quay-init 模板 verbatim 铺进第三方项目的 profiles.yml 其 `roles:` 只有 `manager`/`outer`；worker-driver 派发走 `launchArgv("task-worker", …)` → `profile-policy.ts:140` `resolveRole` 抛 `role not found: "task-worker"`。已复现：`resolveRole(readProfilesConfig("<repo>/plugin"), 'task-worker')` THROW，而 dev-tree 根 `.quay/profiles.yml` 有 task-worker/selector/fix-worker/pool-judge/meta-driver 七个 role ⇒ 第三方项目 worker 永不 spawn。

② **host B/C 的 claude OAuth 过期（环境缺陷）**：host B=orangevps（claude 2.1.261）与 host C=vhs（claude 2.1.229）`claude -p` 均返回 `Failed to authenticate: OAuth session expired and could not be refreshed`；shipped worker-default launcher=claude + auth=key 需 ANTHROPIC_API_KEY（第三方项目未设）⇒ 即便 ① 修好，bare claude 无凭据也 spawn 不出 worker。

AC2/AC3/AC5 ⛔ 阻塞复核（CONTINUE 第 5 轮，2026-09-09T23:01Z）：两阻塞仍未解除——① shipped `plugin/.quay/profiles.yml` 仍只有 manager/outer 两 role（`git show develop:plugin/.quay/profiles.yml` 确认 task-worker 未落 develop；修复任务 `gap-shipped-profiles-missing-worker-roles` 已 ready、AC1/AC2 已勾、AC3 全量 suite 待外部）；② host B/C claude OAuth 未恢复。生产载体 `.quay/productization-verification.jsonl` 仍 0 条 `ac="GOAL-009-AC-207"`（`grep -c` = 0）。AC1/AC4 实现已 done 不变；AC2/AC3/AC5 需外部 e2e 方可验 ⇒ 本任务翻 needs-human 停派，待两阻塞解除后由人翻回 ready 续做。

**两阻塞解除记录（人 2026-09-09 授权，retreat→ready 续验 AC2/AC3/AC5）**：

① **shipped profiles.yml worker roles**——修复任务 `gap-shipped-profiles-missing-worker-roles` 已 done 并落 develop：`develop` HEAD `5c12f9c9` 逐字含该提交主题（`git log develop` 可核）；即修复已在 develop 权威基线上生效，第三方项目重新按当前 develop tip 现 build 的安装物即会带上完整 worker roles。

② **host B/C claude OAuth 过期**——人已授权用第三方 Anthropic-compatible endpoint wrapper `claude-fjdac`（走 `ANTHROPIC_AUTH_TOKEN` 而非 OAuth）绕开认证阻塞：已把该 wrapper + key 文件部署到 orangevps 与 ad-arm1 两台机器，逐台实测 `claude-fjdac -p` 认证成功、正常返回。orangevps 上第三方验证项目 `/home/yale/work/ac207-third-party` 的 `.quay/profiles.yml` 已改为 `worker-default.launcher=claude-fjdac` + `model=deepseek-v4-pro-anthropic` + `auth=token`，与本仓库根 `.quay/profiles.yml` 逐字一致。

**同时**：orangevps 该第三方项目此前装的旧安装物携带 resource-gate.sh 路径锚死 bug（同样已在 develop 修复），已从 develop tip（`5c12f9c9d193cf5e2b5aff11ad3eaee064fc58c6`）现 build `quay-0.6.1.tgz` + `quay-native-0.6.1.tgz`，重装进该项目 npm prefix，重启 promotion+worker driver；实测 promotion round 的资源闸已回 `"go":true,"reason":"=> GO: 资源充足，可以跑"`（此前恒 `resource-gate WAIT exit 127`）。

⇒ 两个此前阻塞 AC2/AC3/AC5 的成因均已解除并留有外部可核证据（develop commit / claude-fjdac 实测认证 / promotion gate GO 读数）。任务由人授权 retreat 回 ready，续做 AC2/AC3/AC5（第三方项目 e2e 驱动、直接量读取、载体落账、判据干跑翻转）。

AC2/AC3/AC5 ⛔ 阻塞（CONTINUE 第 6 轮，2026-09-09T23:4xZ）：前两阻塞虽已解除，但 e2e 仍未驱动起来——**第三个阻塞（产品缺陷，同族于已 done 的 `gap-driver-resource-gate-path-anchored-at-root-third-party`，且是 `gap-plugin-root-resolution-remaining-callsites` 遗漏的调用点）**：`promotion-driver.ts` `defaultPromotionCheckArgv`（develop :120-126）仍把 ready-pool-check 锚在 `path.join(root, "plugin", "scripts", "ready-pool-check.ts")`——root 是第三方项目根，而 quay-init 布下的第三方项目无 plugin/（裁定 6 不复制脚本）、shipped 包只有 dist/*.js 无 .ts。实测：orangevps 第三方项目 promotion-round.jsonl 每轮 `error="ready-pool-check exited 1"`（round 8–13）；复现 `node --experimental-strip-types <third-party>/plugin/scripts/ready-pool-check.ts` → `Cannot find module` exit 1。对照 Layer 0 `driver-runtime.ts` `resolveKernelSibling("ready-pool-check.ts")` 已正确解析到 shipped `scripts/dist/ready-pool-check.js`（含 .ts→dist/.js 回退）。同层 worker-driver.ts 有同形锚点（:1175/:1201/:3531）。⇒ 已立新任务 `gap-promotion-driver-ready-pool-check-path-third-party`（本任务 Touches 之外）；AC1/AC4 实现已 done 不变；AC2/AC3/AC5 仍阻塞，待该任务落 develop + 第三方重装后复跑 e2e。

AC2/AC3/AC5 ⛔ 阻塞复核（CONTINUE 第 7 轮，2026-09-09T23:5xZ）：第三阻塞 `gap-promotion-driver-ready-pool-check-path-third-party` 仍未落 develop（其 status=todo，AC1–AC4 全未勾）。位置判定复核（非关键词）：`git show develop:plugin/scripts/promotion-driver.ts` :123 仍是 `path.join(root, "plugin", "scripts", "ready-pool-check.ts")`；`git show develop:plugin/scripts/worker-driver.ts` :1175/:1201/:3531 仍是 `path.join(root, "plugin", "scripts", …)` ⇒ shipped 驱动锚死 bug 未修。orangevps 第三方项目 `/home/yale/work/ac207-third-party` 的 `.quay/promotion-round.jsonl` 每轮仍 `error="ready-pool-check exited 1"`（最新 round 43 @2026-09-09T23:45Z；gate GO、liveness running 但 pool=null ⇒ 永不晋升、worker 不派发）。生产载体 `.quay/productization-verification.jsonl` 仍 0 条 `ac="GOAL-009-AC-207"`；criterion 干跑仍 exit 1（本机 host=boheidc）。AC1/AC4 实现已 done 不变；AC2/AC3/AC5 需外部 e2e 方可验，e2e 被该第三阻塞卡死 ⇒ 本任务翻 needs-human 停派，待 `gap-promotion-driver-ready-pool-check-path-third-party` 落 develop + 第三方重装后由人翻回 ready 续做。

**第三阻塞解除记录（人 2026-09-10 授权，retreat todo→ready 续验 AC2/AC3/AC5）**：`gap-promotion-driver-ready-pool-check-path-third-party` 已 done 并落 develop。续后发现该修复漏了 `worker-driver.ts` 另外 3 处 + `cap-from-gate.ts` 1 处同族锚点，已另立 `gap-plugin-root-resolution-remaining-callsites-round2`，该任务同样已 done 并落 develop（develop HEAD `fa8dfaf897f53d142c5473ca0298cd06bfb1139a`；`git show develop:plugin/scripts/worker-driver.ts`/`cap-from-gate.ts`/`promotion-driver.ts` 三文件 `grep -c 'plugin", "scripts"'` 逐一核实为 0 或仅剩与第三方项目无关的 dev-tree 自检/死代码引用）。orangevps 已从 develop tip `fa8dfaf897f53d142c5473ca0298cd06bfb1139a` 现 build 新 tgz，重装进 `/home/yale/work/ac207-third-party`，重启 promotion+worker driver（新 supervisor pid 2824641/2824789）。⇒ 第三阻塞（round2 覆盖的 worker-driver.ts/cap-from-gate.ts 剩余锚点）已解除并落 develop，人 2026-09-10 授权续验 AC2/AC3/AC5。

**AC2/AC3/AC5 ⛔ 阻塞复核（CONTINUE 第 8 轮，2026-09-10）**：前三个阻塞（profiles worker roles / OAuth→claude-fjdac / promotion+worker+cap-from-gate 路径锚）均已解除并落 develop。续做实测发现**第四个阻塞（产品缺陷，同族）**：**doc→develop 同步硬编码 `DOC_BRANCH = "author"`，而 fresh 第三方项目的 doc 工作分支是 git 默认 `main`（verify-deliver-coldstart.sh step2_init 的 `git init -b main`），`author` 只存在于本仓库（gap-branch-rename-manager-doc-to-author 改名而来）、quay-init 不创建 author 分支。**

位置判定（非关键词）：
- 第三方项目 `git branch` ⇒ 仅 `develop`+`main`，无 `author`/`integration`。
- `driver-filters.ts:438` `DOC_BRANCH="author"` 硬编码；`syncDocDevelopBidirectional`(:557) `revParse(root,"author")`=null ⇒ return "no-refs"；`syncDevelopToDoc`(:475) `cur!=="author"` ⇒ "not-doc"。
- 实测 `.quay/doc-develop-sync.jsonl` 每轮 `doc-develop-sync-branch-mismatch cur:main expected:author`（gap-sync-develop-to-doc-not-doc-silent-noop 补的落痕，恰好暴露它当时只修了「静默」没修「硬编码」）。
- 后果：promotion-driver 每 30s 把 e2e-verify-207 todo→ready 翻转（promotion-outcome detail=todo->ready）但提交只落 main（git log af37560「todo→ready」），`git show develop:tasks/e2e-verify-207.md` 仍 status:todo ⇒ ready-pool-check/worker-driver 读 develop ⇒ `pool:0 ready:[] excluded:[]`、worker-round `stop_reason:"pool-empty"` ⇒ 永不派发 ⇒ e2e 永不完成。

AC1/AC4 实现已 done 不变；AC2/AC3/AC5 仍阻塞，需修该缺陷（新任务 gap-doc-branch-hardcoded-author-breaks-fresh-project）后重跑 e2e ⇒ 本任务翻 needs-human 停派。

**AC2/AC3/AC5 ⛔ 阻塞复核（CONTINUE 第 9 轮，2026-09-10）**：第四阻塞 `gap-doc-branch-hardcoded-author-breaks-fresh-project` 仍未解除——且其状态已从 round 8 的 todo 变为 **needs-human（`3a86b79a6`「todo→needs-human（重试上限机械翻转）」：连续修满 3 次仍不合格，闸在重验证后仍判不合格，成因类 human-adjudication）**。位置判定复核（非关键词）：`git show develop:plugin/scripts/driver-filters.ts` :438 仍是 `export const DOC_BRANCH = "author";`，且 :457 `docBranchForkedFromDevelop(docBranch = DOC_BRANCH)`、:475 `syncDevelopToDoc(docBranch = DOC_BRANCH)`、:558 `syncDocDevelopBidirectional` 内 `revParse(root, DOC_BRANCH)` 三处仍引用该硬编码常量（动态 `currentBranchName` 修复未落 develop）。同期 develop 另立两任务 `gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync`（ready）与 `gap-third-party-fixture-smoke-test-driver-family`（ready），均未 done ⇒ 缺陷仍在解决中。⇒ 第三方项目 doc 分支 `main` ≠ `author` ⇒ promotion 翻转提交仍到不了 develop ⇒ worker 读 develop pool=0 永不派发 ⇒ e2e 无法驱动 ⇒ AC2/AC3/AC5 仍阻塞。AC1/AC4 实现已 done 不变；本任务翻 needs-human 停派，待 doc→develop 硬编码缺陷落 develop（fix 任务 human-adjudication 或新任务）后由人翻回 ready 续验。

**第四阻塞解除记录（人 2026-09-10 授权 retreat needs-human→todo→ready，续验 AC2/AC3/AC5）**：第四阻塞（`DOC_BRANCH = "author"` 硬编码未落 develop）已解除，位置判定逐字核实（非关键词）：`git show develop:plugin/scripts/driver-filters.ts` :442 `export function resolveDocBranch(root)`，且三处此前引用硬编码常量的签名全部改为运行时派生——:463 `docBranchForkedFromDevelop(root, docBranch = resolveDocBranch(root))`、:482 `syncDevelopToDoc(..., docBranch = resolveDocBranch(root))`、:565 `syncDocDevelopBidirectional(..., docBranch = resolveDocBranch(root))`；修复任务 `gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync` 已 **done**。同期另一阻塞（fan-in 三步硬编码 `scripts/test.sh`）亦已解除：`git show develop:plugin/scripts/worker-driver.ts` :1174/:1185/:1205/:1211 已按 `.quay/config.yml` 的 `loop.test_command` 退化，修复任务 `gap-driver-fanin-hardcoded-test-sh-third-party` 已 **done**；架构性任务 `gap-third-party-fixture-smoke-test-driver-family` 亦已 **done**。承载这三条的 **GOAL-012 已 achieved**（5 条 AC 全 achieved，五条判据经独立重跑全部 exit 0 复核）。⇒ 本任务由 needs-human retreat 回 ready 续做 AC2/AC3/AC5（第三方项目 e2e 驱动、直接量读取、载体落账、判据干跑翻转）。⛔ AC2/AC3/AC5 未勾——仍须真实 e2e 复跑方可验证，本次仅解除阻塞、不预先勾选。

**AC2/AC3/AC5 ⛔ 阻塞复核（CONTINUE 第 10 轮，2026-09-10）**：e2e 首次真正 landed（进步），但 `append-complete-gate-event` 步骤失败 ⇒ gate_events=0 + 安装物陈旧 ⇒ 仍两缺陷，均在本任务 Touches 之外。

① e2e 已 landed：orangevps 第三方项目 e2e-verify-207 已由其自身 worker-driver 机械 fan-in 翻 done 落地（`worker-outcome.jsonl` `final_state:"completed"`、`mechanical_fan_in.outcome:"landed"`、`landedSha:a319990759...`；`git show develop:tasks/e2e-verify-207.md` = `status: done`；`git log --all` 有真实实现提交，非 `chore(quay-init):`）。

② 缺陷 A（新）——gate_events=0：第三方项目 `.quay/gate-events.jsonl` 不存在。fan-in step-trace 末条 `{"step":"append-complete-gate-event","exit":1,"ok":false,"reason":"Cannot find module '/home/yale/work/ac207-third-party/packages/quay/src/gate/gate-event-store.ts' ..."}`。根因：`worker-driver.ts` `appendCompleteGateEvent` 动态 import `path.join(repoRoot(), "packages", "quay", "src", "gate", "gate-event-store.ts")`，shipped 包把 `packages/quay/` 打平到包根（`src/gate/gate-event-store.ts` 在、`packages/` 不在）⇒ MODULE_NOT_FOUND 被吞 ⇒ gate-events 永不写 ⇒ criterion `gate_events>0` 恒不满足。已立新任务 `gap-fanin-gate-event-store-path-shipped-unsafe`。

③ 缺陷 B（残留）——安装物陈旧：安装物 worker-driver.js `resolveDocBranch` = 0 命中（doc-branch 修复落 develop 未重装）；`.quay/doc-develop-sync.jsonl` 仍 `cur:main expected:author` ⇒ main=needs-human vs develop=done 分叉 ⇒ criterion task_status 读数（工作树=main）≠ done。

⇒ AC2 直接量已读但 gate_events=0、task_status 不一致；AC3 生产载体 `.quay/productization-verification.jsonl` 仍 0 条 `ac="GOAL-009-AC-207"`；AC5 判据干跑仍 exit 1。AC1/AC4 已 done 不变。两缺陷均需外部修复（缺陷 A 新任务 + 缺陷 B 重装）⇒ 本任务翻 needs-human 停派。

---

**第 10 轮两阻塞解除记录 + 续做现场说明（人 2026-09-10 授权 retreat needs-human→todo→ready，续验 AC2/AC3/AC5）**

**解除证据（全部按位置实测核实，非采信自述）**：

- **缺陷 A（gate_events=0）已修并已装**：修复任务 `gap-fanin-gate-event-store-path-shipped-unsafe` 已 **done** 并落 develop。develop 上 `worker-driver.ts` 已引入 `resolveKernelSrcModule(base, rel)`——双布局解析（源树 `packages/quay/src/**` / shipped 包根 `src/**`）；`appendCompleteGateEvent` 与 `ffMergeModule` 两处锚点均已改走它。残留的 1 处 `"packages","quay","src"` 字面量位于该解析器**内部**（是它必须认识的源树分支），合法、非遗漏。
- **缺陷 B（安装物陈旧 + 分支分叉）已解除**：已从 develop tip `efa0bd33e38039895185d5166ae119d5574bdf78` 现 build 并重装 orangevps 的 `/tmp/ac207-prefix`，逐项核实新装物含四层修复——`resolveKernelSrcModule` 4 处 / `resolveDocBranch` 4 处 / `test_command` 退化 3 处 / resource-gate 锚 pluginRoot 1 处。两个 driver 已用新装物重启（supervisor pid 3066484 / 3066670）。分支分叉已自愈：`git rev-list --count develop..main` = **0**，工作树上 `e2e-verify-207` 现读 `done`，同步事件逐字 `{"event":"doc-develop-sync-bidirectional","docToDevelop":"true"}`。

**⚠️ 续做时必须知道的两个现场事实（执行者先读这两条再动手）**：

1. **`gate-events.jsonl` 目前不存在，且不会自行出现**——写它的 `appendCompleteGateEvent` **只在 fan-in 期间执行**，而 orangevps 现有第三方项目 `/home/yale/work/ac207-third-party` 的唯一任务 `e2e-verify-207` **已 done**，不会再触发 fan-in。⇒ 要拿到 `gate_events > 0`，**必须再驱动一个任务走一遍修好后的 fan-in**，不能等它自己出现。
2. **重跑必须指向一个全新的第三方项目目录（新的 `--root`）**——⛔ **不要复用 `/home/yale/work/ac207-third-party`**：`verify-deliver-coldstart.sh` 的 `step5_e2e` 会 `task create e2e-verify-207`，而该 id 在旧项目里**已存在且已 done**，create 会失败并使该步 fail-closed 返回。全新目录可让 install→quay-init→建任务→自驱→落账整条链在**修好后的产物**上完整跑一遍。

**⚠️ 证据取回纪律（AC-207 的 goal 记录 body 已逐字写入「执行说明：跑成功之后必须把证据取回家」）**：远端（host B/C）产出的记录**不会自动回到本机载体**——必须**显式取回**本机 `.quay/productization-verification.jsonl` 并**复跑判据确认**（AC5 干跑 exit 1 → exit 0）。⛔ 不得手写/注入记录；⛔ 不得搬运出自坏构建的记录（安装物必须是当前 develop tip 现 build 的那一份）。

⛔ **本次 retreat 不勾选任何 AC**——AC2/AC3/AC5 仍须真实 e2e 复跑验证后方可勾选；本段仅记录阻塞解除与现场事实。

---

## 结构性阻塞：验证脚本的两半分居两个分支（第 11 轮，人 2026-09-10 授权 retreat needs-human→todo→ready）

**六层阻塞现已全部修复并落 develop**（逐层，均按位置实测核实）：① resource-gate 路径锚死 ② shipped `profiles.yml` 缺 worker roles ③ `ready-pool-check` + `worker-driver` + `cap-from-gate` 路径锚点 ④ `DOC_BRANCH` 硬编码 ⑤ fan-in 三步硬编码 `scripts/test.sh` ⑥ gate-event-store 跨包锚点（`resolveKernelSrcModule`）。此外 `gap-verify-coldstart-does-not-configure-target-profiles` **亦已 done 并落 develop**——新增 `--target-launcher` / `--target-model` / `--target-auth` 三个 flag，缺省由**驱动方仓库**的 `.quay/profiles.yml` 派生。

**⚠️ 但本轮识别出一个新的、结构性的阻塞——它不是某个具体缺陷，而是 AC-207 长期无法收敛的机制原因：**

**验证脚本 `plugin/scripts/verify-deliver-coldstart.sh` 的两个必需部分分别在两个分支上，哪一边都不全。** 实测计数（按位置，非关键词）：

| 读法 | `--ac207-e2e` | `--target-launcher` |
|---|---|---|
| `git show develop:plugin/scripts/verify-deliver-coldstart.sh` | **0 处** | **8 处** |
| 本任务 worktree 的同一文件 | **5 处** | **0 处** |

且**本任务 worktree 落后 develop 306 个提交**。

**根因**：本任务**从未 fan-in 过**（长期在 ready ↔ needs-human 之间循环），所以 `--ac207-e2e` 段从未落 develop；而 develop 上的六层修复也从未进本 worktree。⇒ **每一次验证跑用的脚本都缺另一半**——要么有 e2e 段但驱动全是坏的，要么驱动修好了但根本没有 e2e 段可跑。**这是机制原因，不是某个具体缺陷；不先合并，第 11 轮会与前 10 轮同形失败。**

### 执行者第一步必须做的事（Plan 步骤 2b）

**先在本任务 worktree 执行 `git merge develop`。** 合并面已预先探过（探完即 `git merge --abort` 还原；worktree 现为**干净**、`HEAD = b62557cd3`）：

- **只有 `plugin/scripts/verify-deliver-coldstart.sh` 一个文件冲突**，共 **4 处**；
- **4 处全部是「两边各加各的功能」的纯并集**，**无意图冲突**：
  1. **用法行**——两组 flag，两组都保留；
  2. **帮助文本**——两段，两段都保留；
  3. **两段独立注释块**——各自保留；
  4. **selfcheck 条件列表**——须保留 develop 侧新增的 `&& [ "$tp_ok" = "1" ]`（这一处最容易漏，务必逐字核对）。
- **合并后脚本两者兼有**（预探实测：`--ac207-e2e` 5 处 + `--target-launcher` 8 处）。
- 解完冲突**建议跑 `--help` 与 `--selfcheck`** 验证语法与语义。

### 重跑时的现场约束（重申，此前已写进任务体）

- 用**全新 `--root`** 与**全新 `--prefix`**：旧项目 `/home/yale/work/ac207-third-party` 与 `/home/yale/work/ac207-e2e-verify` 中 `e2e-verify-207` **已存在**，`task create` 会失败并使该步 fail-closed。
- 跑完必须**把证据取回本机载体** `.quay/productization-verification.jsonl` 并**复跑判据确认**（AC5 干跑 exit 1 → exit 0）。
- ⛔ 不得手写/注入记录；⛔ 不得搬运出自坏构建的记录（安装物必须是当前 develop tip 现 build 的那一份）。

⛔ **本次 retreat 同样不勾选任何 AC**——AC2/AC3/AC5 仍须真实 e2e 复跑验证后方可勾选。

## Needs-Human

**执行 2026-09-10T09:42:15.042Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 成因类：unclassified
- 失败步/判词：AC 未全勾（checked 2/5，剩余未勾 3）——续做只需验证并勾选 AC
- run_id：wk-prod-1788972473
- session_id：1cbac9f1-899e-4faf-adac-f9b9c7a29354

（⚠️ 该 needs-human 记录已由人 2026-09-10 授权解除 → 本任务已 retreat 回 ready，见上一节「结构性阻塞：验证脚本的两半分居两个分支」。）
