---
id: gap-ac259-version-union-lockstep-and-host-install-readings
title: 版本一致性收口：9 文件并集锁步（checker 补 plugin/VERSION）+ AC-259
  判据复跑与两台真机安装直接量（GOAL-018/AC-259）
status: ready
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun
  - gap-ac258-orangevps-meta-cc-user-scope-quay-init-merge-preserved
goal_ac: AC-259
---
## Proposal

**要满足的判据（正本 `goals/AC-259-版本一致性-仓库-8-处文本-两台真机安装读数均落到-0-7-0.md`）**：两段合取 —— ① 8 个版本承载文件（`packages/quay{,-native,-github,-backlog}/package.json`、`.claude-plugin/marketplace.json`、`plugin/.claude-plugin/marketplace.json`、`plugin/.claude-plugin/plugin.json`、`plugin/VERSION`）字面 version 均 == `0.7.0`；② 载体 `.quay/productization-verification.jsonl` 存在 `ac="GOAL-018-AC-257"` 与 `ac="GOAL-018-AC-258"` 各一条记录，且每条 `quay_version=="0.7.0"` ∧ `task_status=="done"`。

**立案当轮实测（2026-09-14 本机直读，非推断）**：

| 读数 | 实测值 |
|---|---|
| 9 个版本承载文件 | **全部 `0.6.1`**（7 个 JSON `"version": "0.6.1"` + `plugin/VERSION` = `0.6.1` + `plugin/vendor/quay/package.json` = `0.6.1`） |
| 载体 `GOAL-018` 命中数 | **0**（`grep -c GOAL-018 .quay/productization-verification.jsonl` = 0；157 行全属 GOAL-009/015/016） |
| `goal_ac: AC-259` 认领者 | **无**（`grep -rn "goal_ac:.*AC-259" tasks/*.md` 命中 0；同一谓词对已知为真样本 `tasks/gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun.md:14` 命中 1 —— 硬规则 2 要求的零计数配套动作） |
| 同类 AC 任务 | `gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun`（ready）、`gap-ac258-orangevps-meta-cc-user-scope-quay-init-merge-preserved`（todo）—— 各自只认领自己的 AC；AC-257 任务体逐字写「⛔ 不宣称 AC-259 达成」 |

**本 AC 的实质机制缺陷：两个自称「单一真源」的 8 项清单互不覆盖。**

- AC-259 判据的清单：4× package.json + 2× marketplace.json + `plugin/.claude-plugin/plugin.json` + **`plugin/VERSION`** —— **不含** `plugin/vendor/quay/package.json`；
- `scripts/version-consistency-check.ts` 的 `VERSION_ENTRIES`：4× package.json + 2× marketplace.json + `plugin.json` + **`plugin/vendor/quay/package.json`** —— **不含** `plugin/VERSION`；

⇒ **并集 9 个文件没有任何单一判据覆盖**：`plugin/VERSION` 漂移时 AC-259 红而 checker 绿；vendor 漂移时 checker 红而 AC-259 绿；**两者同时绿仍可存在一个漂移的第 9 文件**。

**发生率（历史实测，非推测；硬规则 12「先给已经发生过几次」）—— 该缺口已实际咬过两次，且被记下后从未立案**：

1. `6bf000622 version: bump 0.5.0 -> 0.6.0 across all 8 version-bearing files (AC104)` 之后 `plugin/VERSION` 仍是 0.5.0，**必须靠第二个提交** `bd466ce2a version: bump plugin/VERSION 0.5.0 -> 0.6.0 to match vendored package.json (AC104)` 补回 —— 即**在 `6bf000622` 那一刻 checker 是绿的而 `plugin/VERSION` 是旧的**（缺口在真实发布路径上兑现过一次）。注意 `6bf000622` 的提交信息自称「all 8 version-bearing files」，**覆盖率来自 checker 那份窄清单，不是来自真实发布需要的那份**。
2. `tasks/gap-ac104-version-bump-v060.md:28` 当时就写下「**检查器缺口单独立条补齐**」，而**该独立条从未立案**——全 store 只有它这一个文件出现 `VERSION_ENTRIES`（`grep -rln VERSION_ENTRIES tasks/*.md`）。
3. 操作者一直按并集做事（`a388ca38e`「8 处 + plugin/VERSION」、`08e8ec55f`「8 文件 + plugin/VERSION + delivery-manifest + package-lock」）——**判据比人的做法更窄**，且没有任何检查会发现这件事（硬规则 5b：修好一个实例 ≠ 只有那一个实例）。

**判据弱于 expect 文本（必须补的直接量）**：AC-259 的 `expect:` 逐字要求「⛔ 只改仓库文本、不核两台机器的真实安装读数，不算达成」，**而它的 python 判据只读记录里的 `quay_version` 字段**（被测对象自报量，硬规则 4b）⇒ 只往记录里写 `0.7.0` 即可通过。故本任务**独立 ssh 两台机器取实际安装读数**（`quay --version` / 插件 `installed_plugins.json` 的 installPath 版本 / 落地 `plugin/VERSION`），与记录字段逐台交叉核对 —— 两者一致才算达成。

<!-- dedup-ref -->
**与既有任务的关系（追溯，不是本任务的额外前置声明）**：`gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun`（ready）与 `gap-ac258-orangevps-meta-cc-user-scope-quay-init-merge-preserved`（todo）是机制不同的两条真机重验，各自产出自己那条载体记录；本任务是这两条的**合取验收 + 并集锁步收口**。历史 `gap-ac93-dist-chains-version-consistency` / `gap-ac104-version-bump-v060`（均 done）是 0.6.0 时代的 bump/一致性任务，机制（当时的清单）不同，不接受其读数充数。

## Plan

**产物**：① `scripts/version-consistency-check.ts` 的条目集 = 9 文件并集（新增 `plugin/VERSION`，纯文本 `trim()` 提取器），配套单测与 mutation fixture 同轮同步；② AC-259 判据 `exit 1 → exit 0` 的前后两次原样读数 + 一条可证伪的负控制；③ 两台真机**实际安装版本**的直接量（非记录字段）与记录字段的逐台对照表。

**硬顺序**：

0. 当场重取前置读数（⛔ 不采信本任务正文的立案读数，会过期）：9 文件版本 / 载体 GOAL-018 命中数 / `git log --oneline -1`。
1. 并集锁步：`VERSION_ENTRIES` 增 `plugin/VERSION`，extract 用 `raw.trim()`（⛔ 不套 `JSON.parse`；⛔ 不改动 7 个 JSON 条目既有的提取方式）。同轮同步 `scripts/version-consistency-check.test.ts` 的两处硬编码条数（:57、:137）与其版本映射表；同步 `plugin/scripts/checker-mutation-cases/version-consistency-check.sh` 的 fixture —— **必须**为 `plugin/VERSION` 造出 `1.0.0`，否则新条目读不到文件 ⇒ checker 落 `mode:'error'` ⇒ 基线恒红 ⇒ mutation case 以 exit 4 报「checker always-red」，**把「接线成功」伪装成「case 坏了」**（硬规则 3b）。
2. 负控制（并集判据可取假）：在**临时副本 root** 上（`--root` 即为此设，⛔ 不动真实树）任改 9 文件之一 ⇒ checker exit 1 ∧ `--json` 的 `mode=="drift"`；改回 ⇒ exit 0。两次都贴命令与 exit code。
3. 两条记录核对：读载体，逐字段核 11 谓词；**任一记录缺失或不合格 ⇒ 记 `needs-human` 并写明阻断点**（GOAL-018 非目标条款：途中发现的机制缺陷另立 `gap-*` 任务，⛔ 不就地改产品实现）。
4. 独立真机读数：ssh 两台各取实际安装版本（直接量），与该台记录字段对照成表。
5. AC-259 判据复跑：把 `criterion` 原文原样跑两次（满足前须 exit 1 / 满足后须 exit 0），两次 exit code 与 stderr 都贴，并写明满足前那次落在哪个失败分支。
6. 全量收口：真实树 `node --experimental-strip-types scripts/version-consistency-check.ts` exit 0，输出含 9 条。

**若上游漏 bump 了 9 文件中的某一个**：本任务已声明这些文件（见 Touches），当场补齐即可；⛔ 但要在 evidence 里如实记下「该文件未随之 bump」这一读数（⛔ 不静默吸收）。

## Touches

- tasks/gap-ac259-version-union-lockstep-and-host-install-readings.md
- scripts/version-consistency-check.ts
- scripts/version-consistency-check.test.ts
- plugin/scripts/checker-mutation-cases/version-consistency-check.sh
- plugin/.claude-plugin/plugin.json
- plugin/VERSION
- plugin/vendor/quay/package.json
- packages/quay/package.json
- packages/quay-native/package.json
- packages/quay-github/package.json
- packages/quay-backlog/package.json
- .claude-plugin/marketplace.json
- plugin/.claude-plugin/marketplace.json

## AC

- [ ] AC1 当场重取前置读数并贴命令输出：9 个承载文件的当前字面版本、`grep -c GOAL-018 .quay/productization-verification.jsonl`、`git log --oneline -1`。
- [ ] AC2 并集锁步：`grep -c "plugin/VERSION" scripts/version-consistency-check.ts` ≥ 1 且**贴前 3 条命中内容**（硬规则 2）；`node --experimental-strip-types scripts/version-consistency-check.ts` 在真实树 exit 0 且输出 **9 条**（贴末行 `All 9 files carry version …`）。
- [ ] AC3 单测同步：`scripts/version-consistency-check.test.ts` 内不再有与条目集不符的硬编码条数（贴该断言的行号 + 实际值）；`node --test --experimental-strip-types scripts/version-consistency-check.test.ts` exit 0（贴 pass/fail 计数）。
- [ ] AC4 mutation fixture 真跑：`plugin/scripts/checker-mutation-cases/version-consistency-check.sh` 为 `plugin/VERSION` 造了 `1.0.0`；真跑该 case（或 `plugin/test/checker-mutation-check.test.mjs`）并贴 exit code 与末 3 行 —— ⛔ 不接受「fixture 改了但没跑」。
- [ ] AC5 负控制（并集判据可取假）：临时副本上改 9 文件任一 ⇒ exit 1 ∧ `--json` 的 `mode=="drift"`；改回 ⇒ exit 0。两次命令 + exit code + 关键输出都贴。
- [ ] AC6 两条记录核对：贴载体里 `GOAL-018-AC-257` / `GOAL-018-AC-258` 两行的原样输出 + 「11 谓词 → 实际值 → 满足?」表；缺任一 ⇒ 记 `needs-human` 并写明阻断点。
- [ ] AC7 独立真机读数：`ssh ad-arm1` 与 `ssh orangevps` 各贴**实际安装版本**的命令与输出（⛔ 不是复述记录字段），并与该台记录里的 `quay_version` 逐台对照成表。
- [ ] AC8 AC-259 判据复跑：`criterion` 原文原样两次（满足前 exit 1 / 满足后 exit 0），贴两次 exit code 与 stderr，并指明满足前那次落在哪个失败分支（`repo version mismatch` 还是 `missing qualifying … record`）。
- [ ] AC9 承接纪律：逐条列「途中发现的机制缺陷 → 另立的 `gap-*` 任务 id（或说明为何不阻断本 AC）」；无则明写「无」。

## DoD

真实落地 = ① `scripts/version-consistency-check.ts` 的**单一条目集**覆盖 9 文件并集，且在真实树上真跑 exit 0、输出 9 条（不是只加了一行没人跑）；② mutation case 真跑过（fixture 与新条目同源）；③ AC-259 判据在**真实树 + 真实载体**上由 exit 1 翻到 exit 0，前后两次读数都在；④ 两台真机的实际安装版本由本任务**独立 ssh 读到**并逐台与记录字段核对（⛔ 不是复述记录里的自报值）。

⛔ 只把 8 个文件改成 0.7.0、不动两个判据的并集差，不算达成 —— 那正是本任务存在的理由（并集里没有一个单一判据）。⛔ 只贴记录字段、不 ssh 读真机，不算达成（AC-259 的 `expect:` 逐字：把「版本已 bump」锚在真实安装点，不是只锚在一次文本替换）。