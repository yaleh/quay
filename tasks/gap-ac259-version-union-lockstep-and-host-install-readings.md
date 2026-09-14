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

- [x] AC1 当场重取前置读数并贴命令输出：9 个承载文件的当前字面版本、`grep -c GOAL-018 .quay/productization-verification.jsonl`、`git log --oneline -1`。
- [x] AC2 并集锁步：`grep -c "plugin/VERSION" scripts/version-consistency-check.ts` ≥ 1 且**贴前 3 条命中内容**（硬规则 2）；`node --experimental-strip-types scripts/version-consistency-check.ts` 在真实树 exit 0 且输出 **9 条**（贴末行 `All 9 files carry version …`）。
- [x] AC3 单测同步：`scripts/version-consistency-check.test.ts` 内不再有与条目集不符的硬编码条数（贴该断言的行号 + 实际值）；`node --test --experimental-strip-types scripts/version-consistency-check.test.ts` exit 0（贴 pass/fail 计数）。
- [x] AC4 mutation fixture 真跑：`plugin/scripts/checker-mutation-cases/version-consistency-check.sh` 为 `plugin/VERSION` 造了 `1.0.0`；真跑该 case（或 `plugin/test/checker-mutation-check.test.mjs`）并贴 exit code 与末 3 行 —— ⛔ 不接受「fixture 改了但没跑」。
- [x] AC5 负控制（并集判据可取假）：临时副本上改 9 文件任一 ⇒ exit 1 ∧ `--json` 的 `mode=="drift"`；改回 ⇒ exit 0。两次命令 + exit code + 关键输出都贴。
- [x] AC6 两条记录核对：贴载体里 `GOAL-018-AC-257` / `GOAL-018-AC-258` 两行的原样输出 + 「11 谓词 → 实际值 → 满足?」表；缺任一 ⇒ 记 `needs-human` 并写明阻断点。
- [x] AC7 独立真机读数：`ssh ad-arm1` 与 `ssh orangevps` 各贴**实际安装版本**的命令与输出（⛔ 不是复述记录字段），并与该台记录里的 `quay_version` 逐台对照成表。
- [x] AC8 AC-259 判据复跑：`criterion` 原文原样两次（满足前 exit 1 / 满足后 exit 0），贴两次 exit code 与 stderr，并指明满足前那次落在哪个失败分支（`repo version mismatch` 还是 `missing qualifying … record`）。
- [x] AC9 承接纪律：逐条列「途中发现的机制缺陷 → 另立的 `gap-*` 任务 id（或说明为何不阻断本 AC）」；无则明写「无」。

## DoD

真实落地 = ① `scripts/version-consistency-check.ts` 的**单一条目集**覆盖 9 文件并集，且在真实树上真跑 exit 0、输出 9 条（不是只加了一行没人跑）；② mutation case 真跑过（fixture 与新条目同源）；③ AC-259 判据在**真实树 + 真实载体**上由 exit 1 翻到 exit 0，前后两次读数都在；④ 两台真机的实际安装版本由本任务**独立 ssh 读到**并逐台与记录字段核对（⛔ 不是复述记录里的自报值）。

⛔ 只把 8 个文件改成 0.7.0、不动两个判据的并集差，不算达成 —— 那正是本任务存在的理由（并集里没有一个单一判据）。⛔ 只贴记录字段、不 ssh 读真机，不算达成（AC-259 的 `expect:` 逐字：把「版本已 bump」锚在真实安装点，不是只锚在一次文本替换）。

## Evidence

本节每条读数都是本任务**当场跑出来的**，⛔ 不是复述本任务正文的立案基线（该基线已过期 —— 见 AC1）。
实施在 `task/gap-ac259-version-union-lockstep-and-host-install-readings` 工作树内完成；
除 Step 2b 的 `merge develop` 外不触碰 develop。

### AC1 当场重取前置读数（与立案基线的差异如实登记）

```
$ # cwd = 工作树根
$ for f in packages/quay/package.json packages/quay-native/package.json \
           packages/quay-github/package.json packages/quay-backlog/package.json \
           .claude-plugin/marketplace.json plugin/.claude-plugin/marketplace.json \
           plugin/.claude-plugin/plugin.json plugin/vendor/quay/package.json; do
    printf '%-52s %s\n' "$f" "$(node -e "console.log(require('./$f').version)")"; done
packages/quay/package.json                           0.7.0
packages/quay-native/package.json                    0.7.0
packages/quay-github/package.json                    0.7.0
packages/quay-backlog/package.json                   0.7.0
.claude-plugin/marketplace.json                      undefined   ← 清单形（version 在 plugins[0]），见下行逐字值
plugin/.claude-plugin/marketplace.json               undefined   ← 同上
plugin/.claude-plugin/plugin.json                    0.7.0
plugin/vendor/quay/package.json                      0.7.0
$ cat plugin/VERSION
0.7.0
$ node -p "require('./.claude-plugin/marketplace.json').plugins[0].version"                     # → 0.7.0
$ node -p "require('./plugin/.claude-plugin/marketplace.json').plugins[0].version"              # → 0.7.0

$ grep -c GOAL-018 .quay/productization-verification.jsonl     # ⚠️ 载体 gitignored ⇒ 只在主检出，工作树内不存在
2
$ git log --oneline -1
eae289a44 tasks: gap-ac259-version-union-lockstep-and-host-install-readings todo→ready（promotion-driver 机械晋升）
```

**⚠️ 与立案基线的差异（如实登记，⛔ 不静默吸收）**：

1. 立案读数「9 文件全 `0.6.1`、载体 `GOAL-018` 命中 **0**」**在本任务立案后已被上游推进**：
   `713565ff7`（gap-ac257）已把版本 bump 到 `0.7.0`，两条 `GOAL-018` 记录也已落进载体。
   ⇒ 本任务的实质工作**不是** bump（那是 ac257 做的），而是**它自己声明的机制缺陷**：
   两个自称「单一真源」的清单**互不覆盖**。
2. **承载集计数真值随 develop 前进而漂移**：立案当轮 = `VERSION_ENTRIES`(8 项) ∪ AC-259 清单(8 项) = **9**；
   本轮 `VERSION_ENTRIES` 已含 `plugin/README.md`（`b15fc2e2c`，gap-ac169）⇒ 并集 = **10**。
   同形已被兄弟任务 `gap-ac257-ad-arm1-...md` 的 AC2 段逐字登记过（「9 → 10」）。
   **⛔ 判据本身不迁就计数** —— AC2 记真值 10 并说明来由，不改判据去凑 9。

### AC2 并集锁步（单一条目集覆盖并集）

```
$ grep -c "plugin/VERSION" scripts/version-consistency-check.ts
6
$ grep -n "plugin/VERSION" scripts/version-consistency-check.ts | head -3      # 硬规则 2：贴前 3 条命中
100:    // Plain-text version stamp (`plugin/VERSION` holds a bare semver and nothing else) — deliberately
104:    // `plugin/VERSION`-only drift reddened AC-259 while this checker stayed green. Precedent on the real
105:    // release path: `6bf000622` claimed to bump "all 8 version-bearing files" and left plugin/VERSION at
$ grep -n "label: 'plugin/VERSION'" -A3 scripts/version-consistency-check.ts | head -5    # 实质条目（非注释）
```

```
$ node --experimental-strip-types scripts/version-consistency-check.ts ; echo EXIT=$?
VERSION-CONSISTENCY: OK
  packages/quay                                           0.7.0
  packages/quay-native                                    0.7.0
  packages/quay-github                                    0.7.0
  packages/quay-backlog                                   0.7.0
  plugin/.claude-plugin/plugin.json                       0.7.0
  plugin/README.md                                        0.7.0
  plugin/.claude-plugin/marketplace.json (quay entry)     0.7.0
  .claude-plugin/marketplace.json (quay entry)            0.7.0
  plugin/vendor/quay/package.json                         0.7.0
  plugin/VERSION                                          0.7.0

All 10 files carry version 0.7.0
EXIT=0
```

**⛔ 「9 条」是立案基线的陈旧字面量，真值是 10 条**（并集 = AC-259 清单 8 ∪ 本轮 `VERSION_ENTRIES` 9，
后者已含 `plugin/README.md`）。10 ⊃ 立案所述的 9 ⇒ 覆盖是**超集**，未缩水。

**提取器（⛔ 不套 `JSON.parse`，⛔ 不动 7 个 JSON 条目既有的提取方式）**：

```ts
{
  label: 'plugin/VERSION',
  path: 'plugin/VERSION',
  extract: (raw: string) => {
    const v = raw.trim();
    if (!/^\d+\.\d+\.\d+/.test(v)) {
      throw new Error('no bare semver in plugin/VERSION (cannot evaluate — not a pass)');
    }
    return v;
  },
},
```

不可读的戳记落 `mode:'error'`（不是「与合格同形」—— 硬规则 3b）；该分割由 AC3 的第三条新单测钉住。

### AC3 单测同步

```
$ grep -n "entries.length" scripts/version-consistency-check.test.ts
67:  assert.equal(entries.length, 10);      # readVersions returns 10 entries for the real tree
230:  assert.equal(parsed.entries.length, 10);   # CLI --json
$ node --test --experimental-strip-types scripts/version-consistency-check.test.ts ; echo EXIT=$?
✔ readVersions returns 10 entries for the real tree
✔ readVersions returns errors for missing files
✔ check returns all-equal on the real tree post-unification (GREEN)
✔ check returns all-equal for a unified fixture (GREEN)
✔ check detects single-entry drift (RED after one drift)
✔ check detects drift when ONLY plugin/README.md moves (RED)
✔ check returns mode=error (NOT all-equal) when README has no parseable version line
✔ check detects drift when ONLY plugin/VERSION moves (RED)              ← 新增（逐对象负控制）
✔ check returns mode=error (NOT all-equal) when plugin/VERSION holds no semver  ← 新增
✔ check handles marketplace.json with { plugins: [...] } wrapper
✔ CLI --json exits 0 with JSON output even on drift
✔ CLI exits 0 on the real tree (post-unification GREEN)
✔ CLI exits 0 on a unified fixture
ℹ tests 13   ℹ pass 13   ℹ fail 0
EXIT=0
```

新增两条**逐对象**用例的理由（硬规则 4）：没有它们，「`plugin/VERSION` 进了 `VERSION_ENTRIES`」
与「`plugin/VERSION` 真的参与判定」**不可区分**。`makeFixture` 同步加了 `plugin/VERSION` 分支
（写 `${v}\n`）—— 否则该条目在夹具里落 `mode:'error'`，会把**每一条 GREEN 断言变成假红**。

**⚠️ 如实登记（不阻断 AC3）**：`scripts/*.test.ts` **不在套件 glob 内**（`scripts/test.sh:867`），
故本文件（含新增两条）**只在被显式调用时执行** —— AC3 判据给的正是那个显式命令。
套件内的活守卫是另一条：`plugin/test/checker-mutation-check.test.mjs` 的 AC3（见 AC4，已在 glob 内、已真跑）。
详见 AC9 第 5 条（该状态已被 `runtime-usage-inventory` 分类为 `never-runs-test`）。

### AC4 mutation fixture 真跑

```
$ WD=$(mktemp -d); bash plugin/scripts/checker-mutation-cases/version-consistency-check.sh "$WD" ; echo EXIT=$?
EXIT=0                                    # 退出 0 本身即证：三条注入全部把 checker 打红（否则会 exit 3 STAYED-GREEN）
$ rm -rf "$WD"

# 证伪控制（负控制，证明 fixture 与新条目同源）：
# 同上脚本删掉 `printf '1.0.0\n' > "${workdir}/plugin/VERSION"` 一行后真跑
baseline RED on a consistent store (checker always-red?)
EXIT=4                                    # 正是本任务 Plan §1 预言的失败形态（fixture 缺该文件 ⇒ 假「case 坏了」）

$ node --test --test-name-pattern="AC2|AC3" plugin/test/checker-mutation-check.test.mjs
✔ AC2: every registered checker has a mutation case (checkers_with_mutation === checkers_total)
✔ AC3: mutations_that_stayed_green is 0 (no checker stays green under its injected defect)
ℹ tests 2   ℹ pass 2   ℹ fail 0
```

`INJECT 3` 只 bump `plugin/VERSION`（1.0.0 → 1.0.1）⇒ 必须 exit 1；RESTORE ⇒ exit 0。
**⛔ 不接受「fixture 改了但没跑」** —— 上面三条读数都是真跑。

### AC5 负控制（并集判据可取假）

临时副本 root（`--root`），10 个文件逐字拷贝自工作树；⛔ 不动真实树：

```
$ node --experimental-strip-types scripts/version-consistency-check.ts --root $R ; echo EXIT=$?
All 10 files carry version 0.7.0
EXIT=0
$ printf '0.7.1\n' > $R/plugin/VERSION                     # 只改 9 并集文件之一（新加入的那个）
$ node --experimental-strip-types scripts/version-consistency-check.ts --root $R ; echo EXIT=$?
  plugin/VERSION                                          0.7.1
2 different versions across 10 files
EXIT=1
$ node --experimental-strip-types scripts/version-consistency-check.ts --root $R --json | node -e '...'
mode=drift ok=false unique=["0.7.0","0.7.1"]
$ printf '0.7.0\n' > $R/plugin/VERSION                     # 改回
$ node --experimental-strip-types scripts/version-consistency-check.ts --root $R ; echo EXIT=$?
All 10 files carry version 0.7.0
EXIT=0
$ # 控制：改并集的另一个成员（plugin/vendor/quay/package.json）⇒
2 different versions across 10 files
EXIT=1
```

**本任务存在的理由的直接证据（同一 root、同一漂移，改前/改后对照）**：

```
$ node --experimental-strip-types /tmp/ac259-pre/version-consistency-check.ts --root $R ; echo EXIT=$?
#   ↑ 该文件 = `git show develop:scripts/version-consistency-check.ts`（develop @ eae289a44），即改前那份
All 9 files carry version 0.7.0
EXIT=0        ← ★ 缺口：plugin/VERSION 漂到 0.7.1，改前 checker 仍打印 GREEN
$ node --experimental-strip-types scripts/version-consistency-check.ts --root $R ; echo EXIT=$?
2 different versions across 10 files
EXIT=1        ← 改后：同一漂移被打红
```

这就是 `6bf000622` 在真实发布路径上兑现过的形态：提交信息自称「all 8 version-bearing files」，
而 `plugin/VERSION` 停在 `0.5.0`、checker 绿 —— 必须靠 `bd466ce2a` 补第二个提交。

### AC6 两条记录核对（11 谓词，载体 = 主检出 `.quay/productization-verification.jsonl`）

载体原样输出（2 行）：

```json
{"build_sha":"70908487e5a7ab1236df779203affea25b3e51e1","ts":"2026-09-14T07:47:21Z","ac":"GOAL-018-AC-257","host":"ad-arm1","project_root":"/home/yale/work/archguard","install_scope":"project","quay_version":"0.7.0","quay_init_rerun":true,"merge_preserved":true,"marketplace_path":"/home/yale/.local/opt/quay/0.7.0/lib/node_modules/quay/plugin","provider_path":"/home/yale/.local/opt/quay/0.7.0/lib/node_modules/quay/plugin/vendor/quay-native","task_status":"done","commit_sha":"3b67cf7f5a4470a51f50add83a264aaaf3c38ce9","produced_by_driver":true}
{"build_sha":"31633afe7a6f15e081898e2f641a6c75b7107ac8","ts":"2026-09-14T16:52:20Z","ac":"GOAL-018-AC-258","host":"orangevps","project_root":"/home/yale/work/meta-cc","install_scope":"user","quay_version":"0.7.0","quay_init_rerun":true,"merge_preserved":true,"marketplace_path":"/home/yale/.local/opt/quay/0.7.0/lib/node_modules/quay/plugin","provider_path":"/home/yale/.local/opt/quay/0.7.0/lib/node_modules/quay/plugin/vendor/quay-native","task_status":"done","commit_sha":"9189243fa8d24c1ec613040d72c94f951563d9e0","produced_by_driver":true}
```

| # | 谓词 | AC-257 实际值 | 满足? | AC-258 实际值 | 满足? |
|---|---|---|---|---|---|
| 1 | 行存在且解析为 JSON 对象 | 是 | ✅ | 是 | ✅ |
| 2 | `ac` == 期望 id | `GOAL-018-AC-257` | ✅ | `GOAL-018-AC-258` | ✅ |
| 3 | `quay_version` == `0.7.0` | `0.7.0` | ✅ | `0.7.0` | ✅ |
| 4 | `task_status` == `done` | `done` | ✅ | `done` | ✅ |
| 5 | `host` == 期望主机 | `ad-arm1` | ✅ | `orangevps` | ✅ |
| 6 | `install_scope` ∈ {project,user} | `project` | ✅ | `user` | ✅ |
| 7 | `project_root` 绝对且非空 | `/home/yale/work/archguard` | ✅ | `/home/yale/work/meta-cc` | ✅ |
| 8 | `marketplace_path` 含 `0.7.0` | `…/opt/quay/0.7.0/…/plugin` | ✅ | 同左 | ✅ |
| 9 | `provider_path` 含 `0.7.0` | `…/0.7.0/…/vendor/quay-native` | ✅ | 同左 | ✅ |
| 10 | `quay_init_rerun` ∧ `merge_preserved` 均 true | `true`/`true` | ✅ | `true`/`true` | ✅ |
| 11 | `build_sha` ∧ `commit_sha` 均 40-hex | `70908487…`/`3b67cf7f…` | ✅ | `31633afe…`/`9189243f…` | ✅ |

**22/22 全通过 ⇒ ⛔ 不记 `needs-human`**（两条记录都在且都合格）。

### AC7 独立真机读数（⛔ 直接量，不是复述记录字段）

命令一律经 `ssh <host> bash -s` 送脚本原文；readings 来自**目标机文件系统**，⛔ 不采信记录里的自报值。

| 直接量（命令） | ad-arm1 | orangevps |
|---|---|---|
| `node -p "require('<B>/package.json').version"`（B=`/home/yale/.local/opt/quay/<v>/lib/node_modules/quay`） | `0.7.0` | `0.7.0` |
| `cat <B>/plugin/VERSION`（落地戳记） | `0.7.0` | `0.7.0` |
| `node -p "require('<B>/plugin/.claude-plugin/plugin.json').version"` | `0.7.0` | `0.7.0` |
| `node -p "require('<B>/plugin/vendor/quay/package.json').version"` | `0.7.0` | `0.7.0` |
| Claude Code 插件缓存 `<cache>/VERSION` + `.claude-plugin/plugin.json` | `0.7.0` / `0.7.0` | `0.7.0` / `0.7.0` |
| `installed_plugins.json` 的 `quay@quay[].installPath` / `.version` | `…/cache/quay/quay/0.7.0` / `0.7.0`（user + project 两个 scope） | 同左（user + project 两个 scope） |
| `ls /home/yale/.local/opt/quay/`（是否另有陈旧版本树） | `0.7.0`（仅此一个） | `0.7.0`（仅此一个） |
| 记录里 `quay_version` 字段 | `0.7.0` | `0.7.0` |
| **逐台对照** | **一致** | **一致** |

⇒ **两台真机的实际安装点都是 `0.7.0`，与记录字段逐台一致**（⛔ 不是只锚在一次文本替换）。

**同时如实记下的两条观察（⛔ 不静默吸收；均不阻断本 AC，见 AC9）**：

- `quay --version` **在两台上都不可用** —— `B/bin/` 不存在（`gap-shipped-entry-files-not-runnable` 的
  已知形态：`bin/` 被排除出 `files`）。故本 AC 的直接量取的是**安装产物的版本戳记与注册表**
  （比 CLI 自报更贴近「实际安装点」）。发生率 = 2/2 台。
- orangevps 的插件缓存里**另有一个陈旧的 `0.3.20` 目录**（`plugin.json` = `0.3.20`，无 `VERSION` 文件），
  但 `installed_plugins.json` 注册的 installPath 只有 `0.7.0` ⇒ 陈旧目录不生效。发生率 = 1/2 台（ad-arm1 无）。

### AC8 AC-259 判据复跑（`criterion` 原文原样；两次都真跑）

`criterion` **原文**经真实解析器取出（`packages/quay/src/goal-store.ts` 的 `createGoalStore(goalsDir).get('AC-259')`，
⛔ 不是手抄 YAML 折迭块）：`chars=1496`、`md5=c4f7bd9c282547590190394ddc8169ca`，落 `/tmp/ac259-criterion.sh`。

**「满足前」两次（两条失败分支各一次；读数是重建态 —— 真实的「满足前」态已不存在于盘上，
重建法逐字说明如下）**：

- 版本文件取自 `git show <sha>:<path>`，`sha` 为 bump 前提交 `c1cea6663`（= `713565ff7^`）；
- 载体 = **真实载体去掉两行 `GOAL-018`**（`grep -v GOAL-018`，176 → 174 行，`GOAL-018` 命中 0）
  —— 这正是本任务立案当轮实测到的载体态（立案读数：命中 0）；
- cwd = 重建 root，`criterion` 原文 `bash /tmp/ac259-criterion.sh`。

```
######## BEFORE-A：0.6.1 版本文件 + 0 条 GOAL-018 记录 ########
AC-259: repo version mismatch (want 0.7.0): [('packages/quay/package.json', '0.6.1'), ('packages/quay-native/package.json', '0.6.1'), ('packages/quay-github/package.json', '0.6.1'), ('packages/quay-backlog/package.json', '0.6.1'), ('.claude-plugin/marketplace.json', '0.6.1'), ('plugin/.claude-plugin/marketplace.json', '0.6.1'), ('plugin/.claude-plugin/plugin.json', '0.6.1'), ('plugin/VERSION', '0.6.1')]
EXIT=1                       ← 分支 ①「repo version mismatch」

######## BEFORE-B：0.7.0 版本文件 + 0 条 GOAL-018 记录 ########
AC-259: missing qualifying quay_version=0.7.0 done-record for ['GOAL-018-AC-257', 'GOAL-018-AC-258']
EXIT=1                       ← 分支 ②「missing qualifying … record」

######## AFTER：真实树 + 真实载体（cwd = /home/yale/work/quay）########
EXIT=0
```

**满足前那次落在哪个分支**：两条分支**都**被真跑出来过，且 stderr 与 criterion 源码里的两条
`sys.stderr.write` **逐字相符** ⇒ 判据的两条失败路径都是活的（⛔ 不是「只验证了它通过」）。
本任务落地时刻的真实态是 AFTER（exit 0），因为 bump 与两条记录已由上游 `713565ff7` / 两个 AC 任务完成。

### AC9 承接纪律

| # | 途中发现的机制缺陷 / 观察 | 另立 `gap-*`? | 为何（不）阻断本 AC |
|---|---|---|---|
| 1 | AC2 的「9 条」计数在 develop 前进后真值为 10（`plugin/README.md` 由 `b15fc2e2c` 加入 `VERSION_ENTRIES`） | ⛔ 不另立 —— 兄弟任务 `gap-ac257-…` 已逐字登记同一漂移 | 不阻断：10 ⊃ 9，覆盖是超集；本 AC 记真值并说明来由 |
| 2 | 两条记录的 `provider_path` 指向 `plugin/vendor/quay-native/`，该目录**存在但无 `package.json`**（只有 `dist/` + `provider.yml`）；承载版本的 vendored 拷贝是 `plugin/vendor/quay/package.json` | ⛔ 不另立 | 不阻断：谓词 9 要求的是「路径含 `0.7.0`」，两者都满足；`provider_path` 语义上就是「native provider 所在处」，不是版本字面量。发生率 = 2/2 台同一形态（同一 producer 的同一写法）⇒ 属**记录字段语义**而非缺陷，无 ≥2 次独立发作 |
| 3 | 两台机器上 `quay --version` 均不可用（`B/bin/` 不存在） | ⛔ 不另立 | 不阻断：`gap-shipped-entry-files-not-runnable` 已 done 且正是排除 `bin/` 的决定；本 AC 的直接量改取安装产物戳记 + 注册表（更贴近安装点）。发生率 = 2/2 台 |
| 4 | orangevps 插件缓存残留 `0.3.20` 目录 | ⛔ 不另立 | 不阻断：`installed_plugins.json` 只注册 `0.7.0`，陈旧目录不生效。发生率 = **1/2 台** ⇒ 按硬规则 12，给不出「已发生 ≥2 次」⇒ 记为**观察项**，不作阻塞、不立条 |
| 5 | `scripts/version-consistency-check.test.ts`（含本轮新增的两条逐对象负控制）**不在套件 glob 内 ⇒ 全量套件从不跑它** —— 套件 glob = `packages/*/test/*.test.mjs` + `plugin/test/*.test.mjs` + `experiments/quay-perpetual-stream/test/*.test.mjs`（`scripts/test.sh:867`）；scoped 选择器因此选 0 个测试文件 | ⛔ 不另立 | 不阻断：这是**已知且被分类**的状态，不是未发现的缺口 —— `runtime-usage-inventory.ts:24/:828` 有 `never-runs-test` 一等分类，`docs/analysis/runtime-usage-inventory.json` 的 `summary.neverRunsTest` 已列本文件，`plugin/test/runtime-usage-inventory.test.mjs:211-223` 还逐字钉住「`scripts/*.test.ts` 不在 test glob」这一读数。**本任务的负控制在套件内仍有活的守卫**：`plugin/test/checker-mutation-check.test.mjs`（在 glob 内）的 AC3「mutations_that_stayed_green === 0」本轮已真跑通过；CI 每 push 直跑 checker 本体（`.github/workflows/ci.yml:136`）。⇒ 属已知取舍，发生率成类（`scripts/` 下 2 个），非本任务缺陷 |

**⛔ 本 AC 内未就地改产品实现**：本任务的产品侧改动只有一处 —— `scripts/version-consistency-check.ts`
的条目集（+ `plugin/VERSION`），这正是本任务自己的产出路径（`## Touches` 内），不属于「途中发现的
他人缺陷」。

### 规则 5b 扫描（修好一个实例 ≠ 只有那一个实例）

```
$ grep -rn "VERSION_ENTRIES" --include=*.ts --include=*.mjs --include=*.sh . | grep -v node_modules
scripts/version-consistency-check.ts:26,116            ← 唯一定义/消费点
plugin/scripts/checker-mutation-cases/version-consistency-check.sh:9   ← 注释引用（已同步为 10）
（无第二份拷贝：`plugin/scripts/version-consistency-check.ts` 不存在）
$ grep -rln "version-consistency" --include=*.ts --include=*.mjs --include=*.js --include=*.sh .
.github/workflows/ci.yml:136        ← CI 每 push 直跑该 checker（本次改动在 CI 路径上）
plugin/test/checker-mutation-check.test.mjs         ← 登记清单（AC2 断言：每个 checker 都有 mutation case）
plugin/test/archive-exclusion-wiring.test.mjs       ← 只 import isArchivedPath（未受影响）
plugin/test/plugin-packaging.test.mjs               ← 只引用「跨产物一致」的语义（未受影响）
plugin/scripts/runtime-usage-inventory.ts:192       ← archive 排除的注释引用（未受影响）
plugin/scripts/direct-to-develop-bypass-check.ts:309 ← **历史豁免理由串**里引了
   'All 8 files carry version 0.6.1'（sha `a388ca38` 的 ruled 记录）—— 那是当时为真的**历史记录**，
   ⛔ 不是活判据、不应按今天的状态改写（改了才是伪造历史）。**刻意不动。**
```

⇒ 除上述四处已核实「不判定版本条目集」的消费者外，**无第二个需要同步的判据**。
`All 9 files carry version`（旧串）在非归档、非历史记录的文件中：0 处。