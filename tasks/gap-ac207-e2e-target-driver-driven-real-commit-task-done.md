---
id: gap-ac207-e2e-target-driver-driven-real-commit-task-done
title: 端到端：目标项目自己的 *-drivers 驱动出真实开发提交且任务翻 done，落 ac=GOAL-009-AC-207 记录（AC-207）
status: todo
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-207
---
## Proposal

正本判据 `goals/AC-207-端到端-目标项目自己的-drivers-驱动出真实开发提交且任务翻-done.md`（goal=GOAL-009，2026-09-09 人裁定）：exit 0 = 载体 `.quay/productization-verification.jsonl` 存在 `ac="GOAL-009-AC-207"` 记录，且 host≠本机 ∧ project_root ∉ 本仓库 ∧ commit_sha/task_id 非空 ∧ task_status=done ∧ gate_events>0 ∧ produced_by_driver=true。exit 1 = 无（当前，从未发生）；exit 3 = 载体缺失。

**现状（实测，位置判定）**：2026-09-09 干跑 exit 1。载体无 AC-207 记录；字段 `produced_by_driver` / `gate_events` 全仓库零命中——无人写这条记录。

**修法**：把「端到端自证」接成 verify-deliver-coldstart.sh 的一段验证步骤 + 一条载体记录。硬顺序（GOAL-009 风险 1）：AC-202（done，机件进包）→ AC-203（ready，driver 真活）→ AC-207（本任务端到端组装）；AC-204/205/206 覆盖 init 只写启用、会话投递、goals+tasks 双载体，本任务在其上做端到端驱动。

**边界（照实说明，不假装机械）**：produced_by_driver 的最强可得直接量只到「提交出自 driver 建的任务 worktree ∧ gate 事件齐全 ∧ 时间线交错」，不能完全排除人在会话手敲——该半判据属人裁定口证，不冒充测量（AC-207 正文逐字）。证据必须外部可核：commit_sha 取第三方项目自身 git 历史（经共享裸仓库镜像可核），⛔ 不采信驱动方自述（硬规则 4b）。产品/夹具边界：允许 claude --bg / -p 作验证手段，但产品文档与 skill 文案不得因此声称 quay 会启动会话。

## Plan

1. **接线验证步骤**：`plugin/scripts/verify-deliver-coldstart.sh` 新增 AC-207 端到端段——在 host B/C 的第三方项目里，用已 shipped 的 `quay-init.sh` + goals+tasks 双载体创建一条真实任务，由其自身 promotion-driver → worker-driver 驱动：建任务 worktree → 产生实现提交（⛔ 排除 `chore(quay-init):` auto-commit，硬规则 4b）→ 记 gate 事件 → 翻 done。
2. **直接量读取**：`commit_sha` = 第三方项目 `git log`（任务 worktree 提交）；`task_id`/`task_status` = 目标项目 task store；`gate_events` = `.quay/gate-events.jsonl` 计数；`produced_by_driver` = 「提交出自 driver 建的任务 worktree ∧ gate 事件齐全 ∧ 时间线交错」；缺任一读数不写（fail-closed，硬规则 3b）。
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