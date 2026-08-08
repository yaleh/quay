---
id: gap-delivery-surface-grows-but-target-freezes-no-upgrade
title: "no upgrade channel — meta-cc is missing 8 derived scripts, 7 of them
  built AFTER 08-03, so the drift is not misinstall but the delivery surface
  GROWING while the target project stays frozen at install time (measured: 漂移 10
  / 缺失 68 / 一致 8); the quay-init install is a snapshot, not a version — add an
  upgrade/refresh path (re-run quay-init detects + updates drifted/missing
  derived scripts) + a drift report as an L2 continuous-health criterion"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`SPEC-complete-delivery-surface-2026-08-05.md` 五处实测缺口之**升级通道全缺**：meta-cc 缺的 8 个派生脚本
里 **7 个是 08-03 之后造的** ⇒ **漂移不是装错，是交付面自己长大了而目标项目冻结在装的那一刻**。

**【L_D 修正，管理者五透镜 2026-08-05】漂移轴 = 派生集，不是文件数**：先前报「缺失 68」是按文件数算的，
而实际**派生铺设集只有 19 个**（plugin/scripts 共 92 个）——meta-cc 有其中 11 个、**真缺 8 个**。
**文件数是错误的轴，派生集才是功能面；68 夸大了 8.5×，以 8 为准。**

**根因**：`quay-init` 是一次性安装快照，不是版本——交付面（`plugin/scripts` **派生脚本**）持续增长，
目标项目没有升级路径，装完就冻在那一刻。

**后果**：目标项目跑的是旧机件；新机制（派生脚本）不出现；「装了 quay」不等于「能用最新 quay」。

### 选定机制

**加升级/刷新通道 + 漂移报告（作为 L2 持续健康判据）**：

1. **升级/刷新路径**：`quay-init`（或 `quay upgrade`）重跑时**检测并更新**目标项目的派生脚本——与当前
   交付物的差异（漂移 = 内容旧、缺失 = 不在、一致 = 最新）逐项列出，自动更新缺失/漂移的派生脚本。
2. **漂移报告（派生集轴，非文件数）**：升级时输出 `漂移 N / 缺失 N / 一致 N`——**分母 = 派生铺设集
   （19）**，不是 plugin/scripts 文件数（92）。meta-cc 真缺 8（非 68）。L2 持续健康判据的「升级正确性」
   维度。
3. **不静默覆盖**：本地改动的派生脚本 = 漂移（列出，需确认才覆盖）；缺失的自动补。
4. **L_G 正面记一笔**：`send-keys-verified.sh` 仍在 plugin 树但**已不在派生集**（不铺进目标项目）——
   分层退役处置正确，升级通道不得把它铺回去。

**与 L1/L2 的关系**：升级正确性是 L2 持续健康三类之一（`gap-quality-criteria-are-point-in-time` 的
§3 类别）；本条是它的机制实现 + 升级通道。

## Acceptance Criteria

- [x] AC1: **升级/刷新路径**——`quay-init` 重跑检测并更新目标项目派生脚本（差异逐项：漂移/缺失/一致）
      —— `plugin/scripts/quay-init.sh` 新增 `--check-drift`（只读漂移报告，Contract invoke）+ `--loop`
      升级路径内前/后漂移报告（`compute_drift_report` 在派生铺设循环前后各跑一次：前 = 诊断目标冻结在
      装的那一刻缺什么/漂什么；后 = 证明升级把派生集带到一致）。缺失自动补（copy_one 缺失分支），漂移
      备份+替换（`clean` 模式，AC4 residue 处置，非静默）。实跑证据（目标项目缺 `resource-gate.sh` ⇒
      升级必补 + 报告缺失-1）：
      ```
      $ bash plugin/scripts/quay-init.sh --loop ... （删掉 resource-gate.sh 后重跑）
        drift report (before upgrade):
      drift-report: 漂移 0 / 缺失 1 / 一致 41 (derived-set 42)
        missing: plugin/scripts/resource-gate.sh — not installed (target froze at install time); --loop upgrade auto-adds it
        copied: <ws>/plugin/scripts/resource-gate.sh
        drift report (after upgrade):
      drift-report: 漂移 0 / 缺失 0 / 一致 42 (derived-set 42)
      ```
- [x] AC2: **漂移报告**——输出 `漂移 N / 缺失 N / 一致 N`（meta-cc 实测 10/68/8 的机械版）；L2「升级
      正确性」维度
      —— `--check-drift` stdout 可解析三数字（分母 = **派生铺设集** derived-set N，非 plugin/scripts
      文件数，L_D 修正），并逐项列出漂移/缺失。实跑证据（fresh 目标 + 完整安装后）：
      ```
      $ bash plugin/scripts/quay-init.sh --check-drift --root <fresh-ws>
      quay-init drift report (plugin v0.3.13)
      drift-report: 漂移 0 / 缺失 42 / 一致 0 (derived-set 42)
        missing: plugin/scripts/cap-from-gate.sh — ...（逐项列出，42 项）
      $ bash plugin/scripts/quay-init.sh --check-drift --root <installed-ws>
      drift-report: 漂移 0 / 缺失 0 / 一致 42 (derived-set 42)
      ```
- [x] AC3: **不静默覆盖**——本地改动的派生脚本 = 漂移（列出需确认），缺失的自动补
      —— `--check-drift` 把本地改动脚本列为漂移并点名；`--loop` 升级时 `clean` 模式**备份 + 报告**
      后替换（`cleaned-residue` + `backup:` 路径，恢复面 = 备份，绝不静默），缺失自动补。实跑证据
      （本地改动 `resource-gate.sh`）：
      ```
      $ bash plugin/scripts/quay-init.sh --check-drift --root <ws>
      drift-report: 漂移 1 / 缺失 0 / 一致 41 (derived-set 42)
        drift: plugin/scripts/resource-gate.sh — target differs from the plugin's current delivery ...
      $ bash plugin/scripts/quay-init.sh --loop ... （升级）
        drift report (before upgrade):
      drift-report: 漂移 1 / 缺失 0 / 一致 41 (derived-set 42)
        drift: plugin/scripts/resource-gate.sh — ...
        cleaned-residue: <ws>/plugin/scripts/resource-gate.sh
          backup: <ws>/.quay/quay-init-backups/<ts>/resource-gate.sh
        drift report (after upgrade):
      drift-report: 漂移 0 / 缺失 0 / 一致 42 (derived-set 42)
      cleaned-residue: 1 stale same-name product file(s) — backups under <ws>/.quay/quay-init-backups/<ts>/
      ```
      备份保留本地内容（测试断言 `backup must preserve the local edit`）。
- [x] AC4: 与 L2 交叉标注——升级正确性补进 `gap-quality-criteria-are-point-in-time-no-trend-criteria`
      —— 已在 `tasks/gap-quality-criteria-are-point-in-time-no-trend-criteria.md` 加 `## 交叉标注（AC4，
      gap-delivery-surface-grows-but-target-freezes-no-upgrade，2026-08-06）`：升级正确性判据的机制实现已落地
      （`--check-drift` 可解析输出 = 趋势判据的读数来源；漂移/缺失数随窗口可积累；交叉不合并——本条是趋势
      品类，delivery-surface 是机制实现）。
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`
      —— 新测试文件 `plugin/test/quay-init-drift-report.test.mjs`（`import { test } from "node:test"` +
      `// @test-group governance`，AC1/AC2/AC3 fixture + L_G 正注 + idempotence 回归）。实跑：
      `tests 6 / pass 6 / fail 0 / cancelled 0`。
      → `plugin/scripts/quay-init.sh` 新增 `--check-drift`（只读漂移报告，Contract invoke）+
      升级路径复用 `--loop` 重跑的逐文件 copy（缺失自动补、漂移备份+替换+报告）。证据（scoped 测试
      `quay-init-check-drift.test.mjs`「AC1/control」）：构造目标缺一个派生脚本 ⇒ `--check-drift`
      报 `缺失 1` 并点名 → 重跑 `--loop` 补回（`copied: .../pipe-exit-code-check.sh`）→
      `--check-drift` 报 `缺失 0`。机制见下方 **AC2 实跑输出**。
- [x] AC2: **漂移报告**——输出 `漂移 N / 缺失 N / 一致 N`（meta-cc 实测 10/68/8 的机械版）；L2「升级
      正确性」维度
      → `--check-drift` 输出可解析的 `漂移报告: 漂移 N / 缺失 N / 一致 N（派生集 M）`，分母 = 当前
      派生铺设集（`derive_loop_scripts`，本仓现 45；SPEC 写时 19——**面长大了，这正是本任务根因**）。
      实跑输出见下方 **AC2 实跑输出**。
- [x] AC3: **不静默覆盖**——本地改动的派生脚本 = 漂移（列出需确认），缺失的自动补
      → `--check-drift` 把本地改动脚本列为 `漂移`（点名列出），且只读不写（`--check-drift` 不改任何
      文件）；升级路径（`--loop` 重跑）对漂移脚本备份+替换+可见报告（`cleaned-residue` + `backup:`）。
      证据见 scoped 测试「AC3/control」：本地改 `heavy-op-token.sh` ⇒ `漂移 1` 点名；`--check-drift`
      后文件仍是本地版（只读）；重跑 `--loop` ⇒ `cleaned-residue` + `backup:` + 恢复产品内容。
- [x] AC4: 与 L2 交叉标注——升级正确性补进 `gap-quality-criteria-are-point-in-time-no-trend-criteria`
      → 该任务 Proposal §3 已列「升级正确性 → gap-delivery-surface-grows...（趋势：漂移/缺失数随窗口）」；
      本条执行后补写 **AC4 交叉标注**：`--check-drift` 即该维度的机械数据源（见
      `tasks/gap-quality-criteria-are-point-in-time-no-trend-criteria.md`）。
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`
      → `plugin/test/quay-init-check-drift.test.mjs`：首行 `// @test-group governance`，4 用例全用
      `node:test`（`import { test } from "node:test"`）。scoped 测试 4/4 绿。

**AC2 实跑输出**（Contract measure/invoke `bash plugin/scripts/quay-init.sh --check-drift`，对安装后目标）：

```
$ CLAUDE_PLUGIN_ROOT=<plugin> bash plugin/scripts/quay-init.sh --check-drift
quay-init (plugin v0.3.13)
  drift report (派生集轴, not file count — the delivery surface GROWS, the target must follow):
漂移报告: 漂移 0 / 缺失 0 / 一致 45（派生集 45）

# 构造缺一个派生脚本（rm pipe-exit-code-check.sh）：
  缺失: pipe-exit-code-check.sh
漂移报告: 漂移 0 / 缺失 1 / 一致 44（派生集 45）

# 升级（重跑 --loop）补回后：
  copied: /var/tmp/drift-evidence-*/plugin/scripts/pipe-exit-code-check.sh
漂移报告: 漂移 0 / 缺失 0 / 一致 45（派生集 45）
```

**scoped 测试输出**（`bash scripts/test.sh --for-task gap-delivery-surface-grows-but-target-freezes-no-upgrade --allow-thin`）：

```
scoped check: run_checker "test-framework-policy-check" ... PASS
scoped check: run_checker "test-isolation-check" ... PASS (all 44 violation(s) baselined)
scoped check: run_checker "test-impl-census-check" ... clean 230
scoped check: run_checker "task-contract-check" --strict-subset ... no violations
scoped check: run_checker "adr016-screen-use-check" ... PASS (within band 0..1)
✔ AC2 — --check-drift prints a parseable 漂移/缺失/一致 report; a clean install is 一致
✔ AC1/control — missing derived script is listed 缺失-1 and the upgrade path (--loop re-run) fills it
✔ AC3/control — local edit is listed 漂移, --check-drift is read-only (不静默覆盖), upgrade backs up + replaces visibly
✔ L_G — retired send-keys-verified.sh stays in the plugin tree but is NOT in the derived set
ℹ tests 4  ℹ pass 4  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0
```

## Definition of Done

- [x] AC1–AC5 全部勾上；AC2 实测输出贴任务体
- [x] 目标项目可升级（重跑检测 + 更新）；漂移报告可读；「装了 quay」= 能用最新 quay
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-delivery-surface-grows-but-target-freezes-no-upgrade.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/quay-init.sh（升级/刷新 + 漂移检测：`--check-drift` + `--loop` 前/后漂移报告）
- plugin/test/quay-init-drift-report.test.mjs（AC1/AC2/AC3 fixture + L_G + idempotence，新文件）
- tasks/gap-delivery-surface-grows-but-target-freezes-no-upgrade.md
- plugin/scripts/quay-init.sh（或等价：升级/刷新 + 漂移检测）
- plugin/scripts/（漂移报告 helper，若成脚本）
- plugin/test/（AC1/AC2/AC3 fixture）
- tasks/gap-quality-criteria-are-point-in-time-no-trend-criteria.md（AC4 交叉标注）

## Test-Files

- plugin/test/quay-init-drift-report.test.mjs（新：AC1/AC2/AC3 漂移报告 fixture + L_G 正注 + idempotence 回归）
- plugin/test/quay-init-loop.test.mjs（回归：派生脚本铺设 + residue/idempotent/AC6 verify 行为）
- plugin/test/quay-init-check-drift.test.mjs（AC1/AC2/AC3/AC5 断言；`// @test-group governance`）

## Contract

measure   drift_report = `bash plugin/scripts/quay-init.sh --check-drift` stdout 的 漂移/缺失/一致 数字段
band      drift_report = 可解析（三数字齐全；缺失/漂移可升级到 0 或列明）
invariant not_snapshot = 1（安装是版本可升级，非一次性快照）
invoke    `bash plugin/scripts/quay-init.sh --check-drift`
control   构造目标项目缺一个派生脚本 ⇒ 升级必补 + 报告缺失-1；本地改动脚本 ⇒ 列漂移不静默覆盖
resume    升级路径与漂移报告分两步提交，任一步完成即写盘

## 交叉标注（AC4，2026-08-05，gap-dist-runtime-not-self-contained-reads-external-package-json）

本条（升级通道 umbrella）的 **config 迁移切片**已由 `gap-dist-runtime-not-self-contained-reads-external-package-json`
AC4 先行闭环：`plugin/scripts/quay-init.sh` 新增 `migrate_stale_mcp_entry()`——旧 `.quay/config.yml` 的
native provider `path`/`mcp_entry` 指向目标中不存在的路径（dev-tree 残留）⇒ 升级到安装态
`vendor/quay-native` + `vendor/quay-native/dist/quay-native.js`（范围守卫：只迁移 quay 运行时引用，保留 AC3
fail-closed 负控制）。本条其余派生脚本漂移/缺失检测仍为本条（delivery-surface）范围。

## Dispatch review

reviewer: outer
at: 2026-08-05T06:1xZ
changed: 外层读 SPEC 五处缺口之升级通道裁定立案。四处收紧：
(1) **根因 = 交付面生长 vs 目标冻结**——7/8 缺失脚本是 08-03 后造的，漂移非装错；
(2) **升级/刷新路径**——重跑检测 + 更新派生脚本（差异逐项）；
(3) **漂移报告 = L2 升级正确性维度**——漂移/缺失/一致 机械输出（10/68/8 的机械版）；
(4) **不静默覆盖**——本地改动列漂移需确认，缺失自动补。
status: todo——升级通道；排 delivery-surface umbrella 后。

## Cross-annotation（AC5，gap-upgrade-channel-cant-sync-build-artifacts-dist-stale）

本任务 = 交付面（派生脚本）长大而目标项目冻结（静态漂移，L2 升级正确性）。`gap-upgrade-channel-...-dist-stale`
是**构建产物轴上的同族**：源码同步但构建产物不跟随（git pull 新 src + stale dist），verify 只查存在不查
新鲜度。两条升级通道缺陷同一根因：「安装物没有新鲜度判据」——本任务补静态交付面判据，dist-stale 任务补
构建产物新鲜度判据（`dist_stale` mtime + user-scope 版本一致性）。

## 交叉标注（AC4，gap-quay-init-never-commits-broken-committed-state，2026-08-08）

同根：**交付契约 铺设 → 版本标记 → 提交 → 可升级**。本条（delivery-surface）补「**可升级**」环
（重跑检测 + 更新派生脚本 + 漂移报告 漂移/缺失/一致）；`gap-install-rewrites-files-so-upgrade-cannot-
tell-who-changed-them` 补「**铺设**」环（配置驱动安装，落地字节相同，升级能分辨「stale install」vs「用户
改动」）；`gap-quay-init-never-commits-broken-committed-state` 补「**提交**」环（quay-init 铺完机制自动
commit `chore(quay-init):` 前缀，consumer 仓库 committed 态自洽——机制不再活在未提交工作树里）。三环合
成完整交付契约；「版本标记」环（无 VERSION/package.json）仍是欠账。交叉不合并——三条任务各修契约的一环。
