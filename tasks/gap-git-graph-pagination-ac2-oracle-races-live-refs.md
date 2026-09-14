---
id: gap-git-graph-pagination-ac2-oracle-races-live-refs
title: git 图分页 AC2 的对拍 oracle 读实时的 `--all`——套件运行期间任何 ref 前进都会把它误判成列号错位（已受控复现）
status: ready
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: plan
---
## Proposal

**实测证据（2026-09-14，机械 fan-in 真实样本，非构造）**：任务
`gap-quay-init-no-doc-branch-bootstrap-leaves-main-checkout-on-develop` 的全量 suite 红，`# fail 1`，唯一失败是
`packages/quay/test/gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs` 的 AC2：

    ✖ AC2: after N pages every rendered commit's column equals git log --graph --all -n <loaded> (mismatch = 0)
      AssertionError [ERR_ASSERTION]: column mismatch after 3 pages = 0 (got 1 of 2000: e223844 rendered=2 git=undefined)

日志：`/home/yale/work/quay/.quay/fan-in-suite-gap-quay-init-no-doc-branch-bootstrap-leaves-main-checkout-on-develop~wk-prod-1789350883~1789353945868-555b39.log:4435`

**失败签名是诊断性的，且排除"列号算错"这一支**：
- 不一致数 = **1 of 2000**（不是很多条）；
- `git=undefined` —— 被渲染的提交**不在 oracle 窗口里**，而不是被算成了别的列号。

列号算法若真错，会产生**大量** `git=<数字>` 的不一致，且在隔离运行下**必然复现**（见下：隔离运行 7/7 绿）。

**机制（两条读法都读实时的 `--all`，中间没有快照）**：
- feed：`readGitHistory(REPO_ROOT, {limit:500, skip:500k})` → `git log --all --topo-order -n 500 --skip=N`
  （`packages/quay/src/observation.ts:2603`；测试侧 `productionFeed()` 在测试文件 `:199`）
- oracle：`git log --graph --all -n <loaded>`（测试文件 `:141`，`gitGraphReferenceColumns`）

两次读之间只要有 **K 个提交进入任一 ref**，窗口头部就多 K 个、尾部就掉出 K 个 ⇒ 恰好 K 条不一致、全部
`git=undefined`。这是"窗口位移"，不是"列号错"。

**时间相关（真实样本）**：该轮 suite 起 `03:01:03.695Z`（日志首行 `SUITE-RUN-START`），失败测试结束
`03:06:51.695Z`（`__PERFILE__ end_ms=1789355211695`，duration 10.15s ⇒ 起于约 `03:06:41.5Z`）；而
`git reflog` 显示 `develop` + `author` 在 **`03:06:45/46Z` 被 push**（`e324da837`）——正落在那条测试的窗口内。

**对照（能区分；隔离克隆，单一变量）**：

    git clone --shared /home/yale/work/quay /tmp/graph-race-probe
    基线（不加任何扰动）：            7/7 pass
    只加一个变量（跑测试期间每 250ms 往一个 scratch ref 推进一个新提交）：
      ✖ AC2 ... column mismatch after 3 pages = 0 (got 3 of 1998: 6bcb19a rendered=2 git=undefined,
        4106493 rendered=1 git=undefined, 5ea9f73 rendered=2 git=undefined)

扰动复现出**同一签名**，基线不复现（scratch ref 在克隆里创建并随后删除，源仓库未被改动）。K=3 与 250ms
节拍 × 约 0.87s 测试时长吻合；真实样本的 K=1 与"一次 push 落在测试中途"吻合。

**为什么是缺陷而不是"环境噪声"**：本仓库的 loop 在套件运行期间持续推进 `develop`/`author`（fan-in 自己
要 merge develop、driver 每轮写任务文件、其它 worker 同时在跑）——**`--all` 的稳定是测试的隐含假设，而生产
从不满足它**。同族加固在兄弟文件里做过（本文件的 origin 任务 Touches 列了另两条 `%D` 对拍 oracle"加
`--topo-order` 对齐 readGitHistory，治数据依赖红"），**本文件的分页 oracle 没做同类加固**。

**发生率（硬规则 12）**：实测 **1 次真实发生 + 1 次受控复现**；**发生率未测量**（无历史分诊读数、无窗口
读数）⇒ 本任务不以"发生率"作阻塞，只把已发生的两次如实登记。

**与既有机制的关系**：`gap-fan-in-suite-red-load-sensitive-flaky-no-isolate-rerun` 已被裁定 `superseded`
（2026-09-03）⇒ 当前**没有隔离重跑兜底**，一次 suite red 即 `exited-not-landed`；且本文件未声明
`@load-sensitive`，即便那套机制还在也覆盖不到。⇒ 这条 race 的代价是**整轮 fan-in 被误杀**。

**归属**：本条是**独立缺陷**，与被误杀的那个任务无关（被误杀任务的 delta 是 `branch-model.ts` /
`cli/init.ts` / `quay-init.sh`，与 `observation.ts` / `serve-git.ts` 无 import 通路；隔离运行 7/7 绿）。

## Plan

1. 缺陷已定（见上对照）：feed 与 oracle 读的是**两个不同瞬间的 `--all`**。修法必须让两侧在**同一个不可变
   ref 集合**上取值。两种可接受实现：
   a. **把冻结的 ref 列表喂进生产读路径**——`readGitHistory` 增加"只读这些 ref"的入口，测试把快照传进去，
      两侧同源；
   b. **churn 检测 + 有界重试**——测试在 feed 前后各取一次 ref 快照，两次相同才判定；不同则重取 feed，重试
      有上限，超限必须报 **NOT-EVALUATED**（硬规则 3b：⛔ 不得默认通过）。
2. ⛔ 三条**不可接受**的"修法"（会让判据变弱或恒真，硬规则 3b/4）：
   - 让 oracle 重读一次 `readGitHistory`（回声，判据恒真）；
   - 用 `assignGitColumns` 的输出反推 oracle（自证）；
   - 只对两侧**交集**的提交比对（会掩盖真实的分页错位——正是本文件要治的那个 bug）。
3. 负控制：关掉冻结/重试 ⇒ 并发 ref 推进下必须重新报出 `git=undefined` 类不一致；开启 ⇒ 绿。
4. 收口：`scripts/test.sh --for-task <本任务>` 绿 + 全量 suite 绿。

## Implementation（取 Plan 1a：冻结 ref 窗口）

实现全部落在测试文件，**生产读路径 `observation.ts` 零改动**——冻结列表经它既有的 `exec` 宿主读取缝隙
（`GitExec`，`observation.ts:2573-2582`，其存在理由逐字就是"hand the reader a frozen snapshot of the host
instead of racing the live repo"）进入生产读路径。选 1a 而非改 `readGitHistory` 签名，是因为任务 Touches
只声明了测试文件 + 任务文件，而该缝隙正是本仓库为这一类 race 造的机件。

- `snapshotRefWindow()`：`git for-each-ref --format=%(objectname)%09%(refname)`（外加 `rev-parse HEAD`，
  因为 `--all` 含 HEAD 而 `for-each-ref refs/` 不含）⇒ 冻结成不可变对象名 + 出处记录
  （`refCount`/`heads`/`tags`/`at`）。
- `frozenGitExec(shas)`：把每个 `log` 调用的 `--all` 替换为冻结列表。
- `gitGraphReferenceColumns(n, refs)`：oracle 用**同一个** `refs`。
- 取值时机：`renderAfterLoads()` 顶部**一次性**冻结，feed 与 oracle 都由它供给。
- 第三态：`judgeColumnWindow()` 返回 `state: "evaluated" | "not-evaluated"`；`not-evaluated` 时
  `mismatch: null` 且 reason 说明窗口对不齐——**⛔ 不与 mismatch 计数或"通过"同形**（硬规则 3b）。
- 负控制缝隙：`QUAY_TEST_GIT_GRAPH_LIVE_REFS=1` ⇒ 两侧退回各自实时读 `--all`（修前形态）。
- ⛔ 未用回声、未反推 `assignGitColumns`、未比较交集。

## Acceptance Criteria

- [x] AC1（能取假，受控复现）：在隔离克隆里复跑本文件，只加"跑测试期间推进 scratch ref"这一个变量 ⇒ AC2 报出 `git=undefined` 类不一致；不加扰动 ⇒ 7/7 绿。两次读数都留档（命令 + 原文）。
- [x] AC2（修法可执行）：feed 与 oracle 的读数取自**同一个不可变 ref 集合**（快照或等价机制），而非各自实时读 `--all`；打印实现位置与取值时机。
- [x] AC3（负控制，取假）：把冻结/重试关掉 ⇒ 并发 ref 推进下必须重新报红；打开 ⇒ 绿。（两次都要真实读数，不得只跑一边。）
- [x] AC4（判据不得退化）：`refCols.size === loaded`（"oracle 解析同一个已加载窗口"）修后仍成立、`loaded > LIMIT` 仍可满足；且"重试超限/无法评估"必须是**可区分的第三态**，⛔ 不得与"通过"同形。
- [x] AC5（生产读数，非 fixture）：修后 AC1/AC2/AC3 的取值仍来自真实本仓库（>500 行、有跨列边），不是合成 fixture。
- [ ] AC6 全量套件绿（`scripts/test.sh`；由 fan-in 那一次运行判定）（待外部）

## Definition of Done

- 分页 AC2 的对拍 oracle 不再让 feed 与 oracle 落在两个不同瞬间的 `--all` 上；同一提交在两侧位于同一个不可变窗口。
- 受控复现（AC1）与负控制（AC3）都取得真实读数并留档：修前红 / 修后绿，且"关掉冻结"能重新变红。
- ⛔ 不把 oracle 改成回声（重读 `readGitHistory`）或用 `assignGitColumns` 的输出反推；⛔ 不用"只比交集"来变相削弱判据。
- 本条的一次真实发生样本（suite 日志路径 + 断言原文 + reflog 时刻）与受控复现读数保留在任务体里。

## Touches

- packages/quay/test/gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs（oracle 的不可变 ref 窗口 + AC1 受控复现 + AC3 负控制）
- tasks/gap-git-graph-pagination-ac2-oracle-races-live-refs.md（自身）

## Evidence（2026-09-14 实现与读数留档）

### E0 落笔前当场干跑：冻结列表 ≡ `--all`（硬规则 4c）

在 `/home/yale/work/quay`（真仓库）逐个形态比对，`REFS = for-each-ref refs/ 的 objectname ∪ rev-parse HEAD`：

| 形态 | 结果 |
|---|---|
| `git log --all --topo-order -n 500` vs `git log <REFS> --topo-order -n 500` | **逐字节相同**（499 行） |
| `--skip=500` / `--skip=1000` / `--skip=1500` 同上 | **逐字节相同**（各 500 行） |
| `git log --graph --all -n 2000` vs `git log --graph <REFS> -n 2000` | **逐字节相同**；oracle map size = 2000 |
| `git log --graph --topo-order --all` vs `git log --graph --all` | 相同（`--graph` 本身即 topo-order） |
| ref 对象类型 | 147 `commit` + 11 `tag`（全部可 peel 到 commit）；去重后 148 个对象名 |

### E1 受控复现（AC1）—— 隔离克隆，单一变量

```
git clone --shared /home/yale/work/quay <clone>
cp <worktree>/packages/quay/test/gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs \
   <clone>/packages/quay/test/
ln -s /home/yale/work/quay/node_modules <clone>/node_modules
# 唯一变量：每 250ms 往 scratch ref 推进一个空提交
while :; do git -C <clone> -c user.name=r -c user.email=r@x commit -q --allow-empty -m churn \
  && git -C <clone> update-ref refs/scratch/race HEAD; sleep 0.25; done &
node --test <clone>/packages/quay/test/gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs
```

**修前 · 不加扰动**（原文）：
```
== prefx-noperturb (churn=off) rc=0 pass=7 fail=0
✔ AC2: after N pages every rendered commit's column equals git log --graph --all -n <loaded> (mismatch = 0) (646.558157ms)
```

**修前 · 加扰动**（原文）：
```
== prefx-churn (churn=on) rc=1 pass=6 fail=1
✖ AC2: after N pages every rendered commit's column equals git log --graph --all -n <loaded> (mismatch = 0) (734.000265ms)
  AssertionError [ERR_ASSERTION]: column mismatch after 3 pages = 0 (got 1 of 2000: bf65649 rendered=1 git=undefined)
```
⇒ 与真实样本**同一签名**（K=1、`git=undefined`、`rendered=<数字>`）。复现成立，且"列号算错"这一支被排除。

### E2 负控制（AC3）—— 修后四臂矩阵，隔离克隆

| 冻结 | 扰动 | 读数 |
|---|---|---|
| **关**（`QUAY_TEST_GIT_GRAPH_LIVE_REFS=1`） | 开 | **红**：`rc=1 pass=6 fail=1` / `column mismatch after 3 pages = 0 (got 1 of 1999: b1d487d rendered=1 git=undefined)` |
| 关 | 关 | 绿 `rc=0 pass=7 fail=0` |
| **开**（缺省） | 开 | **绿** `rc=0 pass=7 fail=0` |
| 开 | 关 | 绿 `rc=0 pass=7 fail=0` |

⇒ 单变量可区分：**同一份代码**，只翻转冻结开关，红/绿互换。⛔ 两臂都是真实读数，不是只跑一边。

### E3 实现位置与取值时机（AC2）

- 位置：`packages/quay/test/gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs`
  `snapshotRefWindow()` / `resolveRefWindow()` / `frozenGitExec()` / `gitGraphReferenceColumns()` /
  `judgeColumnWindow()`；`productionFeed()` 把 `refs` 穿过 `readGitHistory` 的 `exec` 缝隙。
- 取值时机：`renderAfterLoads()` 顶部一次性冻结，**早于两侧任何读**；运行时可核（每轮套件日志里都有）：
```
[AC2] oracle window: FROZEN at 2026-09-14T04:03:57.229Z (148 ref object names); n=2000
```

### E4 判据不得退化（AC4）

- `refCols.size === loaded`：修后由 `judged.state === "evaluated"` 表达（其定义就是 `oracleCols.size === loaded`）；实测 `n=2000 → map size 2000` ✔ 仍成立。
- `loaded > LIMIT`：实测 `loaded = 2000 > 500 = LIMIT` ✔ 仍可满足（断言仍在）。
- **第三态可达且可区分**：`judgeColumnWindow()` 对**真实窗口**的错位读数（`gitGraphReferenceColumns(loaded - 1, refs)` → size 1999 ≠ 2000）返回 `state: "not-evaluated"` + `mismatch: null`，测试断言它**不是**"通过"、且**不带** mismatch 计数。⚠️ 实现取 Plan 1a（冻结），**没有重试路径** ⇒ 「无法评估」以「窗口对不齐 / 快照不可得」形态出现，而非"重试超限"；AC4 要求的"可区分第三态"由此满足。

### E5 生产读数，非 fixture（AC5）

AC7 全绿：窗口含 `refs/heads/` ≥1 与 `refs/tags/` ≥1（真实 ref 密集生产仓库的特征），合并窗口 > LIMIT 行、跨列边 > 0。冻结列表由测试自身在 `REPO_ROOT` 上用 `git for-each-ref` 现取；被替换的只是**起点列表**（`--all` → 不可变对象名），跑的仍是真 `git` 读真仓库，**不是 fixture**。

### E6 scoped 门

`bash <worktree>/scripts/test.sh --for-task gap-git-graph-pagination-ac2-oracle-races-live-refs --allow-thin` ⇒ **EXIT=0**，目标文件 7/7 绿，且该文件**不在** test-isolation-check 的 24 条既有 violation 内。

### E7 fan-in 预期（scoped-gate 缓存的口径）

写缓存用的是**门实际验证过的那个 develop tip**（`HEAD^2` = `12ecdb4bb75044da40013f098e4c1930d6af9807`），
**不是**写缓存那刻的 `git rev-parse develop`（那已是 `4331b7187`——loop 在我跑门期间又推进了 develop）。
⚠️ `worker-driver.ts:1406` 打印的指引签名写的是 `--develop-sha "$(git -C <worktree> rev-parse develop)"`，
在 develop 于 worker 运行期间前进时它会记下一个**本门从未验证过**的 SHA ⇒ 潜在地造成 fan-in 假命中。本条按
fan-in 的真实判据（`worker-driver.ts:4437-4438`：与**锁内 merge 到的** develop tip 逐字相符才算命中）写诚实值：
develop 此后若再前进 ⇒ 缓存未命中 ⇒ 门照跑（fail-closed，安全方向）。该指引缺陷不属本任务 Touches，另记。

### E8 AC6 标注形态未被子句识别器认出（本条自带的收口陷阱，已修）

原 AC6 写作 ``AC6 全量 `scripts/test.sh` 绿（待外部；由 fan-in 那一次全量运行判定）``。fan-in 翻 done 前的
AC 完成闸（`fan-in-ac-completion-gate.ts` → `isLandedCodeComplete`，`slot-refill.ts`）对"未勾项"的放行条件是
`isOuterVerificationItem(text)`，即二者之一：

- `isExternalVerificationItem` = `/（待外部）\s*$/` —— **必须落在该条文本的末尾**；
- `OUTER_VERIFICATION_RE` = `/全量套件绿|外层(?:全量)?验证|外层\s*verification-round/` —— 需**字面** `全量套件绿`。

原写法两不沾（`全量 \`scripts/test.sh\` 绿` ≠ `全量套件绿`；末尾是 `判定）`），**实测**（真跑该断言，非推断）：
```
sectionFound: true total: 6 checked: 5 unchecked: 1
  uncheckedItem: "AC6 全量 `scripts/test.sh` 绿（待外部；由 fan-in 那一次全量运行判定）" => isOuterVerificationItem: false
isLandedCodeComplete: false
```
⇒ 该条一旦原样进 fan-in，翻 done 会被拒 ⇒ **整轮 fan-in 白跑**。已改为**同时满足两个识别器**的形态：
``AC6 全量套件绿（`scripts/test.sh`；由 fan-in 那一次运行判定）（待外部）``（含字面 `全量套件绿` ∧ 末尾 `（待外部）`）。

**同形发生率（实测，全库扫描 `tasks/*.md` 的未勾项）**：带 `待外部` 但**不**落在末尾的共 **3** 条 —
`gap-single-flight-lock-2-slot-concurrent-suites.md:75`（BLIND，且末尾还有续写）、
`gap-fan-in-suite-red-with-no-attributable-test-still-redispatches-worker.md:120`（OUTER-OK，命中外层族）、
本文件（BLIND）。⇒ 3 条中 **2 条**会被拒。本条已修；另 2 条不属本任务 Touches，另记。
