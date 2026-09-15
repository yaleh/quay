---
id: gap-ac264-quay-fleet-project-scope-plugin-only-deployment
title: quay-fleet 以 project scope + marketplace 渠道纯 plugin 部署并由自己的 driver
  把一条真任务驱到 done（AC-264 收口）
status: ready
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: v1
depends_on:
  - gap-dist-plugin-invoker-rewrite-emits-unresolvable-plugin-paths
  - gap-ac261-plugin-bin-shim-missing-so-cli-needs-npm-global
  - gap-ac262-goal-meta-driver-spawn-core-src-absent-from-plugin-cache
  - gap-ac263-marketplace-channel-has-no-dist-closure-gate
goal_ac: AC-264
---
**type:** execution

## Proposal

**这是 GOAL-019 的收口条**：在 `/home/yale/work/quay-fleet` 以 **project scope**、**marketplace 渠道**部署修好后的交付面（不依赖 npm 全局安装、不依赖 `QUAY_PLUGIN_ROOT`、不依赖 quay 开发检出），由 quay-fleet **自己的 driver** 把一条真实任务从 `todo` 驱到 `done` 并留下**非记账**代码提交，然后往 `.quay/productization-verification.jsonl` 追加一条 `ac: "GOAL-019-AC-264"` 的记录。

**记录必须含的字段（AC-264 判据逐字检查这些）**：`project_root: "/home/yale/work/quay-fleet"`、`install_scope: "project"`、`install_channel: "marketplace"`、`npm_global_used: false`、`quay_plugin_root_unset: true`、`goal_ring_ok: true`、`task_status: "done"`、`commit_sha`（非空）、`produced_by_driver: true`、`plugin_cache_path`（非空且不含 `verify-` / `probe` / `/tmp/`）。

**判据还会自己核两个文件系统直接量（不信自报字段）**：`/home/yale/work/quay-fleet/.claude/settings.json` 的 `enabledPlugins` 含 `quay@*` 键 ∧ `/home/yale/work/quay-fleet/.quay/config.yml` 的绑定行含 `.claude/plugins/cache/` 路径**且不再指向 quay 开发检出**（`/home/yale/work/quay/plugin` 或 `/home/yale/work/quay/packages`）。

**现状（2026-09-15 实测，这是起点不是终点）**：quay-fleet 的 `.claude/settings.json` 已有 `enabledPlugins {"quay@quay": true}`，但 `.quay/config.yml` 的 `providers.native.path` 与 `mcp_entry` **仍直接指向 `/home/yale/work/quay/plugin/vendor/quay-native/...` 开发检出** ⇒ 声明了 project scope 而实际消费的是 dev 树。**本任务必须改写该 config 的绑定。**

**⚠️ 已知陷阱（写进任务体，别靠记得）**：① `.quay/config.yml` 是 gitignored，且 `refresh-worktree-quay` 会覆盖 worktree 里的那份 —— **主检出只有一份真副本**；② quay-fleet 的 config 里 `QUAY_NATIVE_ADR_DIR` / `GOAL_DIR` / `META_DIR` 三个 env 是**必须保留**的（没有它们，该项目的 goals/ADR/meta 会静默读写 quay 自己的 store，已有既存 gap 记录此事）。

**Touches 的处理（按 `ready-pool-check.ts` 的真实要求判断）**：`type:execution` 任务的 `## Touches` 若存在就必须**非空且每条一条具体路径**（`checkTouches` 的 `touches-empty` / `touches-overbroad`），且晋升闸另有两条硬要求 —— `selfTouchCheck` 要求声明自己的 `tasks/<id>.md`（不带 `(new)`），`touchesResolve` 要求非 `(new)` 条目在盘上真实存在。quay-fleet 不在本仓内，故本条只声明本仓内真实会动的两个文件：自身任务体 + 证据载体 `.quay/productization-verification.jsonl`（已实测存在于主检出，非通配、是精确路径 ⇒ 不触 overbroad）。⇒ **不需要人裁定一个「空 Touches」写法**。

**查重（按机制）**：全店搜 `install_channel` 命中 0；`gap-ac161-user-level-marketplace-only`（done）是 quay 自己仓库的 enabledPlugins scope 迁移，不是第三方项目的 plugin-only 部署验证；`gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root` 及其同族三条修的是解析面（其 DoD 的「真项目复跑」半条正是本条要完成的那种端到端验证），⛔ 但它们都不含 marketplace project-scope 部署 + driver 驱任务到 done 这一整条链。

## Contract

measure ac264_record_fields = `grep 'GOAL-019-AC-264' .quay/productization-verification.jsonl | tail -n 1` 取到的那条记录的十个字段读数：project_root / install_scope / install_channel / npm_global_used / quay_plugin_root_unset / goal_ring_ok / task_status / commit_sha / produced_by_driver / plugin_cache_path
band n/a: 字段存在性与取值判据，无数值区间
invariant fleet_config_not_bound_to_dev_checkout = quay-fleet 的 .quay/config.yml 绑定行含 .claude/plugins/cache/ 且不含 /home/yale/work/quay/plugin 与 /home/yale/work/quay/packages
invoke `node --experimental-strip-types plugin/scripts/goal-driver.ts --root /home/yale/work/quay-fleet`
control 把 quay-fleet 的 config 绑定改回开发检出 ⇒ AC-264 判据必须翻假（判据自核文件系统直接量，不信自报字段）
resume 重新读 quay-fleet 的 .claude/settings.json 与 .quay/config.yml 两个直接量，再补一条载体记录

## Acceptance Criteria

- [x] AC1：quay-fleet 以 **project scope + marketplace 渠道**部署修好后的交付面——`/home/yale/work/quay-fleet/.claude/settings.json` 的 `enabledPlugins` 含 `quay@*` 键（真实文件系统直接量，⛔ 不是自报字段）。→ 实测 `enabledPlugins = {"quay@quay": true}`，同文件另有 `extraKnownMarketplaces.quay = {source: directory, path: /home/yale/work/quay-plugin-dist}`（project scope 注册的 marketplace 源）。
- [x] AC2：`/home/yale/work/quay-fleet/.quay/config.yml` 的绑定行含 `.claude/plugins/cache/` 路径，且对 `/home/yale/work/quay/plugin` 与 `/home/yale/work/quay/packages` 的命中数为 0；同时 `QUAY_NATIVE_ADR_DIR` / `GOAL_DIR` / `META_DIR` 三个 env **仍在**（⛔ 删掉它们会让该项目的 goals/ADR/meta 静默读写 quay 自己的 store）。→ 绑定行两条，均指向 `~/.claude/plugins/cache/quay/quay/0.7.0/vendor/quay-native…`；开发检出命中 0；三个 env 逐字保留。
- [x] AC3：由 quay-fleet **自己的 driver** 把一条真实任务从 `todo` 驱到 `done`，并留下**非记账**代码提交——`commit_sha` 取自 quay-fleet 仓库的真实提交、`produced_by_driver` 为 true（生产读数；⛔ 手工模拟或纯记账提交不算）。→ 新任务 `fleet-agent-session-file-content-read`：promotion-outcome 记 `action=promote, result={ok:true, detail:"todo->ready"}`（06:09:16Z）；worker-outcome 记 `final_state="completed"`, `worker_pid=3794666`, `run_id="wk-prod-anchor"`，`mechanical_fan_in={outcome:"landed", landedSha:"068fe5c…"}`；代码提交 `a371a7ab76b30e18fcc05ef108338a3c2e53cdf0`（3 文件 +414 行，`packages/agent-core/src/session-files.mjs` / `fleet-agent.mjs` / `test/agent-session-file-content.test.mjs`），已是 quay-fleet develop 的祖先。
- [x] AC4：往 `.quay/productization-verification.jsonl` 追加一条 `ac: "GOAL-019-AC-264"` 记录，十个字段齐备且取值如 Proposal 所列（`plugin_cache_path` 非空且不含 `verify-` / `probe` / `/tmp/`）——生产载体读数，非 fixture。→ 已追加一条，十字段齐备；`plugin_cache_path = /home/yale/.claude/plugins/cache/quay/quay/0.7.0`。追加脚本对每个字段先取真实读数并在写盘前断言（anchor pid / `/proc/<pid>/environ` / `which quay` / git ancestry / 绑定行），⛔ 不是把自报值抄一遍。
- [x] AC5：全程未用 npm 全局、未设 `QUAY_PLUGIN_ROOT`——验证 shell 用 `env -u QUAY_PLUGIN_ROOT`，并核 quay-fleet driver 进程的真实 `/proc/<pid>/environ` 与 cmdline 不含 `QUAY_PLUGIN_ROOT`、不指向开发检出（直接量；⛔ 自报字段 `npm_global_used: false` 本身不算证据）。→ 迁移前实测旧 driver 进程 environ 里确有 `QUAY_PLUGIN_ROOT=/home/yale/work/quay/plugin`（见 Evidence）；新 anchor pid 2917008 的 environ `QUAY_PLUGIN_ROOT` 命中 0、cmdline/environ 对 `/home/yale/work/quay/plugin|packages` 命中 0，且在其自身 PATH 下 `command -v quay` = `<cache>/bin/quay`。

## Definition of Done

- [x] AC1–AC5 全勾，且 AC-264 判据在生产上真的翻 pass（读 `.quay/goal-round.jsonl` 里该 AC 的 verdict），不是只有本任务体自称满足——inherited-core 的标准 DoD：REAL LANDING 是门槛，artifacts 不是。→ `.quay/goal-round.jsonl` round 35（`ts=2026-09-15T07:12:30.766Z`）`AC-264: {"verdict":"pass","reason":"acceptance passed (exit 0)"}`；`quay goal gate AC-264` 也当场返回 `verdict=pass` 并留下 GateEvent `fdce8bd9-…`。
- [x] 四条前置（AC-260 / AC-261 / AC-262 / AC-263）都已落地并重新发布过交付面；⛔ 在旧交付面上做的部署验证不算（同「落地后不重启 = 改动不生效」那一族）。→ 在本任务 worktree（= develop）上跑 `bash plugin/scripts/publish-dist-branch.sh`，产出 `dist-plugin` @ `578187b0efab6eeb4497e5610e8e8752b6bea52d`（built from `2b47315d7`），其中 AC-263 的闭包闸打印 `dist-closure gate OK (directory): 95 referenced dist bundles all present`；产物落 `/home/yale/work/quay-plugin-dist`（含 `bin/quay` = AC-261 shim，93 个 `scripts/dist/*.js`），fleet 的 marketplace 即指它。旧 cache（无 `bin/`）已删除后重装。
- [x] 负控制做过并留档：把 quay-fleet 的 config 绑定改回开发检出 ⇒ 判据翻假；改回 plugin cache ⇒ 翻真。→ dev-bound 版（md5 `bc3897c8…`）⇒ 判据 exit 1，理由逐字为 `binds to no .claude/plugins/cache/ path (binding lines: ['path: /home/yale/work/quay/plugin/vendor/quay-native', …])`；cache-bound 版（md5 `663bce57…`）⇒ exit 0。留档 `/home/yale/work/ac264-evidence/03-negative-control.txt`。
- [x] scoped 门 `bash scripts/test.sh --for-task gap-ac264-quay-fleet-project-scope-plugin-only-deployment` 绿；全量由 fan-in 机械跑。→ 见本轮收尾读数（已绿后写入 scoped-gate cache，fan-in 跳过重复跑）。

## Evidence

**交付面（本任务 worktree 上重发布）**

```
bash plugin/scripts/publish-dist-branch.sh
[publish-dist-branch] orphan commit ready: 578187b0efab6eeb4497e5610e8e8752b6bea52d
[publish-dist-branch] verifying dist reference closure in the assembled publish tree ...
dist-closure gate OK (directory): 95 referenced dist bundles all present
→ git archive dist-plugin → /home/yale/work/quay-plugin-dist  (VERSION 0.7.0, bin/quay 存在)
```

**部署（project scope + marketplace）**

```
(cd /home/yale/work/quay-fleet && claude plugin marketplace add /home/yale/work/quay-plugin-dist --scope project)
  → Successfully added marketplace: quay (declared in project settings)
(cd /home/yale/work/quay-fleet && claude plugin install quay@quay --scope project -y)
  → installed_plugins[quay@quay] scope=project projectPath=/home/yale/work/quay-fleet
    installPath=/home/yale/.claude/plugins/cache/quay/quay/0.7.0
```

配置文件改写后提交在 quay-fleet `9009b43`（`.claude/settings.json` + `.quay/config.yml`；两者在 quay-fleet 里是**被跟踪**的文件）。⚠️ 第一次机械 fan-in 正是栽在这里：`ff` 步骤报 `working tree not clean in /home/yale/work/quay-fleet` ⇒ 部署改动必须落成提交，不能只留在工作树。

**driver 迁移（AC5 的直接量，迁移前后对照）**

```
BEFORE  pid 513070/624519/628384/632566/643120
        cmdline: node --experimental-strip-types /home/yale/.local-quay-plugin-builds/0.6.3-local/scripts/dist/driver-runtime.js __supervise --kind <k> …
        /proc/628384/environ  QUAY_PLUGIN_ROOT=/home/yale/work/quay/plugin   ← 命中 1
AFTER   pid 2917008  node <cache>/scripts/dist/driver-anchor.js __anchor --root /home/yale/work/quay-fleet
        environ QUAY_PLUGIN_ROOT 命中 0 / CLAUDE_PLUGIN_ROOT 命中 0
        cmdline+environ 对 /home/yale/work/quay/plugin|packages|.local-quay-plugin-builds 命中 0
        PATH=<cache>/bin:…（⛔ 已剔除继承自本会话的 /home/yale/work/quay/plugin/bin）
        PATH 下 command -v quay = <cache>/bin/quay
```

**被驱动的真实任务（quay-fleet 自己的 driver）**

```
06:09:16Z  promotion  action=promote  result={"ok":true,"detail":"todo->ready"}  gate.eligible=true
06:30:51Z→06:58:50Z  worker pid=3794666 run_id=wk-prod-anchor  final_state="completed"
fan-in: typecheck ✓ doc-check ✓ scoped-gate ✓ ac-precheck ✓ suite ✓ anti-drift-land ✓ ac-gate ✓ ff ✓
        {outcome:"landed", landedSha:"068fe5c76914e2e42d4376e5c35b85c632018395", lockHoldSecs:491}
code:   a371a7a  "fleet-agent: GET /sessions/:id/file?path=<rel> — @-mention content read"
        3 files changed, 414 insertions(+), 1 deletion(-)
```

**留档**：`/home/yale/work/ac264-evidence/`（`00-before.txt`、`01-after-anchor-env.txt`、`02-fleet-done.txt`、`03-negative-control.txt`、`ac264-criterion.py`、`append-carrier.py`、`config.yml.before` / `.after-cache`）。

## Dispatch review

reviewer: human
at: 2026-09-15
changed: 立案当轮修正 Contract 的 measure 命令拼写（载体扩展名 .jsonl），其余按人给定原样落盘

## Touches

- .quay/productization-verification.jsonl
- tasks/gap-ac264-quay-fleet-project-scope-plugin-only-deployment.md
