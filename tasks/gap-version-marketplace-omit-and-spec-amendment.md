---
id: gap-version-marketplace-omit-and-spec-amendment
title: marketplace.json 省略 version 字段的真实安装实测 + 修订 SPEC §4.3/发布流程（去掉「去 -dev 的 bump 提交」）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-version-stamp-generator-and-build-wiring
---
## Proposal

前置：`gap-version-stamp-generator-and-build-wiring`（生成器与 build 模式盖章已落地）。

**问题**：① 根 `.claude-plugin/marketplace.json` 的 `plugins[].version` 由 Claude Code 直接从 git 读、没有构建步骤可盖章，仍是一处必须手写的提交字面量；它是否可以整个省略、改由 `plugin.json` 的 version 决定，**没有被实测过**（SPEC §4.3 只实测过「接受 `-dev` 后缀」，§10 残留 1）。② `orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §4.3 的落实口径、§4.1 的 release 规程、§9 迁移表仍写「release 分支上一个提交去 `-dev`、合回后 bump 到下一个 `-dev`」，与新机制（单一来源 + build 模式解析）不符。

**人的裁定（2026-09-20，逐字）**：「版本号应有唯一来源，由 git 跟踪。可以在 build 过程中，监测分支并加后缀，如 -dev。」「tag 提交不再自描述。」——此处即对 SPEC §4.3「选项 ii」（2026-09-15 人裁定：`-dev` 后缀）的落实机制修订：`-dev` 语义不变，变的是「谁写后缀」。

**做法**：
1. 实测：隔离的 `CLAUDE_CONFIG_DIR` 下，用「根 marketplace.json 的 quay 条目不含 `version`」的构建，真实 `claude plugin marketplace add` + `claude plugin install quay@quay -s user --json`，回读 `claude plugin list --json` 的 `version` 与 `installPath`（缓存目录键）。读数写入任务体。
2. 若实测通过：从两个 `marketplace.json`（根与 `plugin/.claude-plugin/`）删除 quay 条目的 `version`，并从 `stamp-version`/`version-consistency-check` 的载体表移除这两条；若实测不通过：保持字段，记录读数与失败形态，本任务只做第 3 步并把该字段留在载体表（这是一个可取假的分支，不许因为「方案里写了要删」就删）。
3. 修订 SPEC：§4.3 落实口径、§4.1 release 规程、§9 迁移表第 3 行与 §10 残留 1，改为「`VERSION` 单一来源 + `resolveVersion` build 模式 + 生成器」，明确 tag 提交的提交载体为 `X.Y.Z-dev`（不自描述）、发布产物版本由 build 模式决定；`release-branch-finish.sh` 不再要求存在「去 -dev 的 bump 提交」（如其判据依赖该提交，同步改并留测试）。

## AC

- [x] 隔离 `CLAUDE_CONFIG_DIR` 的真实安装读数已写入任务体：`claude plugin install quay@quay -s user --json` 的 outcome、`claude plugin list --json` 的 `version` 与 `installPath`（含省略 `version` 与保留 `version` 两组对照，硬规则 4 推论四：给出「若假设为假则读数不同」的对照）。
- [x] 按实测结论：通过 ⇒ `grep -c '"version"' .claude-plugin/marketplace.json` 中 quay 条目无 version（用 `node -p` 读 `plugins[0].version === undefined` 为 true），且 `node --experimental-strip-types scripts/version-consistency-check.ts` exit 0；不通过 ⇒ 任务体记录失败读数，字段保留，checker 仍 exit 0。
- [x] `grep -n "去 -dev\|去后缀\|-dev.*bump\|bump.*-dev" orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` 的每个命中（打印命中条数与前 3 条）都已改写或明确标注为历史记录；SPEC 新增一节记录本次修订、人的逐字裁定与日期。
- [x] `bash plugin/scripts/release-branch-finish.sh --help` 与其测试在不含「去 -dev bump 提交」的 release 分支上 exit 0（若该脚本原判据依赖该提交）；相关测试 `scripts/test.sh --for-task gap-version-marketplace-omit-and-spec-amendment` exit 0。

## DoD

真实安装读数决定了 marketplace 字段的去留，且 SPEC 与实现一致：从 `VERSION` 改一处开始，走完「develop 常态 -dev → release 分支/tag 产物无后缀 → 合回后仅改 VERSION 一行」整条发布链，无人工去后缀提交。证据是真实安装与真实分支上的读数，不是 fixture。

## Evidence

### AC1 — 隔离 `CLAUDE_CONFIG_DIR` 的真实安装读数（**结论：字段从未被读**）

两组方言 × 省略/保留，外加一条**决定性对照**（专门用来把「被忽略」与「恰好一致」区分开）。
每条都是全新隔离目录（`rm -rf` 后 `mkdir`），真实 `claude` CLI 2.1.278：

```
$ CLAUDE_CONFIG_DIR=<isolated> claude plugin marketplace add <dir> --scope user
✔ Successfully added marketplace: quay (declared in user settings)   → exit 0（四种情形一致）

$ CLAUDE_CONFIG_DIR=<isolated> claude plugin install quay@quay -s user --json
{"command":"install","outcome":"ok","plugin":"quay@quay","pluginId":"quay@quay","scope":"user",
 "message":"Successfully installed plugin: quay@quay (scope: user)"}  → exit 0（四种情形一致）

$ CLAUDE_CONFIG_DIR=<isolated> claude plugin list --json      ← 本表就是这一条的读数
```

| 方言 | 条目 `version` | `install` outcome | `list --json` `version` / `installPath` 键 |
|---|---|---|---|
| 根（github source, ref `dist-plugin`） | `0.10.0-dev` | `ok` | `0.10.0` / `…/cfg-A/plugins/cache/quay/quay/0.10.0` |
| 根（github source） | **省略** | `ok` | `0.10.0` / `…/cfg-B/plugins/cache/quay/quay/0.10.0` |
| `plugin/`（`source: "."`） | `0.10.0-dev` | `ok` | `0.10.0-dev` / `…/cfg-P-with/plugins/cache/quay/quay/0.10.0-dev` |
| `plugin/`（`source: "."`） | **省略** | `ok` | `0.10.0-dev` / `…/cfg-P-no/plugins/cache/quay/quay/0.10.0-dev` |
| `plugin/`（`source: "."`） | **`9.9.9`**（故意发散） | `ok` | `0.10.0-dev` / `…/cfg-P-divergent/plugins/cache/quay/quay/0.10.0-dev` |

**⊢ 对照的作用（硬规则 4 推论四）**：前四行只证明「省略能装上」；它们**不能**排除「字段被读、只是恰好都一致」。
第 1 行已经是一个对照（条目 `0.10.0-dev` vs 回读 `0.10.0` ⇒ 若字段被读，读数会不同），第 5 行是更强的一条
（条目 `9.9.9` vs manifest `0.10.0-dev`，回读仍是 `0.10.0-dev`）⇒ **假设「CLI 读该字段」为假时读数会不同，而它没有不同。**
⇒ 结论：安装缓存按**拉到的插件自己的 `plugin.json` version** 键控，marketplace 条目的 `version` **不进入任何读数**。
（第 1/2 行回读 `0.10.0` 而非 `0.10.0-dev`，是因为 `dist-plugin` 分支上那份 `plugin.json` 是 `0.10.0`；
`git show origin/dist-plugin:.claude-plugin/plugin.json` = `{"version":"0.10.0"}`，与本仓库主检出那份 `0.10.0-dev` 不同——
这恰好又一次说明回读的是**拉到的插件**那一侧。）

### AC2 — 删除字段 + checker 仍 exit 0（走的是「通过 ⇒ 删」分支）

```
$ grep -c '"version"' .claude-plugin/marketplace.json
0
$ node -p "require('./.claude-plugin/marketplace.json').plugins[0].version === undefined"
true
$ node -p "require('./plugin/.claude-plugin/marketplace.json').plugins[0].version === undefined"
true
$ node --experimental-strip-types scripts/version-consistency-check.ts ; echo EXIT=$?
VERSION-CONSISTENCY: OK
  source: VERSION = 0.10.0
  expected: every carrier == resolveVersion(VERSION,'tracked') == 0.10.0-dev
  …（13 行载体）…
All 13 carriers == resolveVersion(VERSION,'tracked') == 0.10.0-dev (over 10 files; suffix policy: all-suffixed)
EXIT=0
```

**同时修改的载体表**：`scripts/version-carriers.ts` 删掉两个 `marketplaceQuayEntry` 条目，随之删掉只服务它们的
私有函数与锚点正则（否则是 dead code）。表由 15 条目 / 11 文件 → **13 条目 / 10 文件**；`stamp-version.ts` 的
`buildCarriers('plugin')` 投影由 5 → 4 条。判官与生成器共用该表，故两侧同时收敛。

**⚠️ 一处主动加的可执行断言**（不属于 AC 的字面要求，说明理由）：字段一旦离开载体表，**再没有任何机件会因它回归而变红**
——它既不被判官读、也不被生成器写，重新加回来会是一个「无人读、只等人手改」的字面量（硬规则 9：可见性 ⊂ 执行）。
故在 `plugin/test/plugin-packaging.test.mjs`（该文件本来就在断言两个 `marketplace.json`）新增一条：两个文件的
quay 条目**不得**带 `version`。这不是新判据、不改任何 AC；它只是把本次裁定变成一个能取假的读数。

### AC3 — SPEC 修订（命中 11 条，逐条归类）

```
$ grep -c "去 -dev\|去后缀\|-dev.*bump\|bump.*-dev" orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md
11
$ grep -n "…" … | head -3
27:…｜②develop 携带 `X.Y.Z-dev`，release 分支去后缀〔⚠️ **落实机制已于 2026-09-20
29:**不再有手工「去后缀的 bump 提交」**；下文的「去后缀」措辞一律读作 §12 的机制〕｜
50:| 2 版本 bump 落 develop（带 `-dev`）还是落 release 分支 | **「`-dev` 后缀」** | §4.3 选项 ii | develop 携带 `X.Y.Z-dev`，release 分支去后缀〔⚠️ **裁定原文保留为历史…
```

| 行 | 性质 | 处置 |
|---|---|---|
| 27, 29 | §0 四条确定动作 ② | **⚠️ 就地标注**指向 §12（裁定原文保留为历史） |
| 50 | §1 ⑤ 问 2 裁定表行 | **⚠️ 就地标注**「裁定原文保留为历史；落实机制已由 §12 修订」 |
| 356 | §4.1 流程图注 | **新写的**：声明下文旧措辞效力以 §12 为准 |
| 484 | §4.3 选项 ii 表行 | **⚠️ 就地标注**「本行是 2026-09-15 的旧落实措辞」 |
| 500, 501 | §4.3「落实口径」 | **新写的规则本体**（「⛔ 不再有…的 bump 提交」） |
| 709 | §9 迁移表第 3 行 | **已改写** + ⚠️ 标注（落实已换代：载体表 / 双模式 / 生成器） |
| 843, 860, 873 | 新增 §12 本文 | **新写的** |

⇒ **零条未标注的旧规程**：规程面（§4.1 流程图、§4.3 落实口径、§9 第 3 行、§10 残留 1/1b）**已改写**；
裁定记录面（§0 ②、§1 ⑤、§4.3 选项 ii 表）**保留原文 + ⚠️ 历史标注**（那几行是 2026-09-15 那天确实发生的事，改掉它才是伪造历史）。

**SPEC 新增 §12**「追加裁定（2026-09-20）：版本落实机制 —— `VERSION` 单一来源 + build 模式解析，
⛔ 没有『去后缀的 bump 提交』」：含**人的逐字裁定两行**、日期、载体表（来源/解析/生成/判定四面）、
「tag 提交不自描述」的显式说明、§12.3 的安装读数表与决定性对照、§12.4 的旧文效力表。
同时 §10 新增残留 1b「marketplace 条目的 `version` 是否可以整个省略」并**当场关闭**；残留 1 的旧结论
（「该字段不仅接受 prerelease，还以它作 cache 键」）**被更正为错的**并指向 §12。

### AC4 — `release-branch-finish.sh` 不受影响（原本就不依赖该提交）+ 相关测试与 scoped 门

```
$ bash plugin/scripts/release-branch-finish.sh --help ; echo EXIT=$?
用法: bash release-branch-finish.sh [参数…] …（用法正文）…
EXIT=0
```

**该脚本的判据不读任何版本字面量**（`plugin/scripts/release-branch-finish.sh:289-320`）：合规删除只认
「`develop..<b>` == 0（已合回）」或「`git tag --contains <b>` 非空（tip 被某 tag 持有）」两种形态；
`--cut --tag <vX.Y.Z>` 的 tag 名由**调用者显式给**——正是因为它不猜版本。⇒ **「存在一个去后缀的 bump 提交」
这一前置从来没有被写进任何判据**，本次修订**一行都没有改它**（故它不在本任务的改动集里）。

**⚠️ 措辞精确化（不把 fixture 说错）**：其测试**不是**只跑「不带 bump 提交的分支」——
`plugin/test/release-branch-finish.test.mjs:454` 的 `makeReleaseBranchWithBump` 造的正是**一条带 bump 提交**的
release 分支，而那条 bump 的**内容**是普通 `version.txt`（`0.1.0\n`，不是任何形式的版本字面量），
且删除许可判据**对提交内容无感**：带 bump 与不带 bump 的用例走的是**同一条**「tip 是否被 tag 持有 / 是否已合回」的读法。
⇒ 真正的读数是「**判据对提交内容无感**」，这比「分支里没有 bump 提交」更强也更准——它意味着
**任何**内容的一次 release 分支 bump（包括旧规程里那次「去 `-dev`」）都不是判据的输入。

scoped 门日志（全绿）：

```
✔ --cut lands the cut in ONE command: merge back → tag the merge point → finish (250.101445ms)
✔ --cut preconditions fail closed: missing --tag / existing tag / HEAD not base — nothing mutates
✔ a tip CONTAINED IN A TAG licenses the delete even though develop..<b> != 0 (AC-271's second form)
… ℹ tests 56  ℹ pass 56  ℹ fail 0
```

```
$ bash scripts/test.sh --for-task gap-version-marketplace-omit-and-spec-amendment --allow-thin ; echo EXIT=$?
… MUTATION version-consistency-check: pass
… checker-mutation-check [--check-changed]: delta base develop; 1 checker carrier(s) in THIS delta:
    version-consistency-check
EXIT=0
```

⚠️ **同时验证的负控制（AC-271 的安全面）**：这些测试在**临时仓库**里建 `release/*` 分支，**不在共享仓库**里建。
修完后实测 `git for-each-ref refs/heads/ | grep release` **没有任何 `release/*` 或 `release-*` 命中**
（只有 `task/gap-release-*`、`worktree-release-*` 这些**不匹配** `^release[-/]` 的名字）⇒ 本次工作没有制造
SPEC §4.1.2 记录的那个「为取读数而造一条真 release 分支」的窗口。

### AC5（AC 外、但为本改动的直接下游）— 全量 suite 红：`chart2-s2` 的版本源表仍含两条已删字段

**症状**（fan-in 全量 suite `# tests 6048 / # fail 2`，**两轮 exited-not-landed**）：

```
✖ CLI: against THIS repo (default root) → cov 3/3 …, exit 0
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /S2 Delivery-completeness cov = 1 \(3\/3/. Input:
  'S2 Delivery-completeness cov = 0.6666666666666666 (2/3: version-consistent=false, manifest-published=true, foreign-install-green=true)\n'
✖ CLI: explicit repoRoot arg → cov 3/3 against the real repo   （同一读数）
```

**它不是环境红——它是本次改动的直接下游，判成 UNRELATED 是错的。** 机制：
`experiments/quay-perpetual-stream/scripts/chart2-s2-delivery-completeness.ts` 的 `VERSION_SOURCES` 是
**第二张版本载体表**（与 `scripts/version-carriers.ts` 并列、各自手工维护），它把两个 `marketplace.json` 的
`plugins[0].version` 列为 5 个版本源中的 2 个。字段被删后它们读出 `null` ⇒ `versionsConsistent` 取假
⇒ S2 的 conjunct-1 由真变假 ⇒ cov 3/3 掉到 2/3。

⚠️ **delta-relatedness 判定给出的 UNRELATED 是错的**：那条判定走的是**import 一跳**，而这里的耦合是
**运行期数据依赖**——脚本按路径 `readFileSync` 读 `marketplace.json`，与该测试文件之间**没有 import 边**。
（同硬规则 2：按位置/结构判定，不按「看起来有没有关系」判定。）
**可复现的负控制**：在 develop 上该测试全绿（develop 的 marketplace 仍有 `version`）；在本分支上稳定 2/3。

**修法（改机制，⛔ 不改判据期望值）**：把测试期望改成 `2/3` 是错的——那会把「删掉一个**实测从未被读**的字段」
谎报成一次交付完成度回退。真正的修法是**源表跟上裁定**（与 `scripts/version-carriers.ts` 15→13 同性质）：

| 文件 | 改动 |
|---|---|
| `experiments/quay-perpetual-stream/scripts/chart2-s2-delivery-completeness.ts` | `VERSION_SOURCES` 5 → 3（两个 marketplace 出表）；删掉只服务它们的 `plugins0.version` pointer 变体与嵌套读取分支（否则是 dead code）；`selftest()` 四个 fixture 数组 5 → 3、用例名 `red-5way-drift-no-evidence` → `red-drift-no-evidence`；头注新增段落记录为什么这两条不是源、以及决定性对照 |
| `experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs` | `writeFixtureRepo` 5 文件 → 3 文件（去掉 `nested` 分支）；两处 `fields.length`/序号断言随表长调整；CLI 负控制的漂移数组 5 → 3；**新增负控制**：往 fixture 里写一个 `plugins[0].version: "9.9.9"` 的 `marketplace.json`，断言它**不进入** `readVersionFields` 且 `versionsConsistent` 仍为真 |

**⊢ 那条新增负控制为什么必须有**：否则「marketplace 不再是源」只由「少了一行代码」来断言——恒真、不可取假
（硬规则 4 推论三）。有了它，若有人把这两条加回源表，这条测试**会红**。

**⊢ 为什么不把 S2 这张表并进 `version-carriers.ts`**：两张表消费者不同（判官/生成器 vs chart-2 的 S2 子判据），
S2 的 `VERSION_SOURCES` 只读不写、不参与盖章；合并要跨 `packages/`…`experiments/` 引入新耦合。**本次只让 S2 表跟上裁定，不动它所在架构。**

**读数（本工作树实测）**：

```
$ node --test experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs
ℹ tests 23  ℹ pass 23  ℹ fail 0
$ node --test $(find experiments/quay-perpetual-stream/test -name '*.test.mjs')      # 该目录全部
ℹ tests 1362  ℹ suites 43  ℹ pass 1362  ℹ fail 0
$ node --test scripts/version-consistency-check.test.ts scripts/stamp-version.test.ts \
        plugin/test/plugin-packaging.test.mjs plugin/test/publish-dist-branch-closure-gate.test.mjs
ℹ tests 80  ℹ pass 80  ℹ fail 0
```

**⊢ 5b 自查（同一原则在别处的适用点）**：`grep -rn "plugins\[0\]\.version\|plugins0\.version" --include=*.ts --include=*.mjs --include=*.js .`
（去 `node_modules`/`.quay/`）**命中 3 条、前 3 条分别是本文件的两条注释/测试名与测试文件的一条注释——0 条是读取代码**。
**谓词正控制**（硬规则 2 的零计数半边）：同一谓词打在 develop 上那份文件上得 **4** 命中 ⇒ 谓词本身有效，不是恒零。
⇒ marketplace 条目 `version` 的读取方在本次修完后**已无残留**。

### 落点清单（本任务实际改动的文件）

| 文件 | 改动 |
|---|---|
| `.claude-plugin/marketplace.json` | 删除 quay 条目的 `"version"` 行 |
| `plugin/.claude-plugin/marketplace.json` | 同上 |
| `scripts/version-carriers.ts` | 删两条 carrier + 只服务它们的私有函数/正则；表注记录四条安装读数与决定性对照 |
| `scripts/version-consistency-check.test.ts` | `ALL_PATHS`/`CARRIER_ENTRY_COUNT` 15→13；原「marketplace 被判定」的测试**反转为负控制**（发散的 `9.9.9` 必须仍 GREEN，且不得产生 carrier 条目） |
| `scripts/stamp-version.test.ts` | `buildCarriers('plugin')` 投影由 5 条改 4 条 |
| `plugin/scripts/checker-mutation-cases/version-consistency-check.sh` | 删掉两处已非 carrier 的 fixture 写入（否则是「green baseline 什么都没证」的形状）；计数注释 15/11 → 13/10 |
| `plugin/test/publish-dist-branch-closure-gate.test.mjs` | stub 的 carrier 集合由 5 改 4，并注明为什么删掉那条 |
| `plugin/test/plugin-packaging.test.mjs` | **新增**：两个 `marketplace.json` 的 quay 条目不得带 `version` |
| `experiments/quay-perpetual-stream/scripts/chart2-s2-delivery-completeness.ts` | **新增（AC5）**：`VERSION_SOURCES` 5 → 3 + 删 dead code + selftest fixture 与头注跟上 |
| `experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs` | **新增（AC5）**：fixture 5 → 3 + 下标断言 + 一条「marketplace 不是源」的负控制 |
| `orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` | §0/§1/§4.1/§4.3/§9/§10 改写或标注 + 新增 §12 |

### ⛔ 本次**没有**做、且理由成立的四件事

1. **没有**给 `resolve-version.ts` 加「注入分支名」的开关——那会把 build 模式读数变成恒真的回声（硬规则 4 推论三）。
2. **没有**在 `VERSION_CARRIERS` 里加一条「marketplace 必须无 version」的负向 carrier——`VersionCarrier` 的
   `extract/locate` 契约是「读出一个可写入的版本」，塞一个「断言缺席」的语义进同一接口会让生成器那侧无意义；
   等价的守卫放在 `plugin-packaging.test.mjs` 更贴切，且**不改**判官/生成器的契约。
3. **没有**改 `release-branch-finish.sh`——已核实其判据不含该前置（见 AC4）。
4. **没有**把 chart2-s2 的 `VERSION_SOURCES` 并进 `version-carriers.ts`（理由见 AC5 的 ⊢ 段）——本次只让
   S2 表跟上裁定，不合并两张表。

## Touches

- .claude-plugin/marketplace.json
- plugin/.claude-plugin/marketplace.json
- scripts/version-carriers.ts
- scripts/version-consistency-check.ts
- scripts/version-consistency-check.test.ts
- scripts/stamp-version.ts
- scripts/stamp-version.test.ts
- orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md
- plugin/scripts/release-branch-finish.sh
- plugin/scripts/checker-mutation-cases/version-consistency-check.sh
- plugin/test/plugin-packaging.test.mjs
- plugin/test/publish-dist-branch-closure-gate.test.mjs
- experiments/quay-perpetual-stream/scripts/chart2-s2-delivery-completeness.ts
- experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs
- tasks/gap-version-marketplace-omit-and-spec-amendment.md
