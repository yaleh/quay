---
id: gap-release-cut-preflight-misses-shipped-set-size-ceiling-until-the-tag-is-pushed
title: release-cut 的 preflight 不预检产物体积上限：注定失败的发布要等 tag 推出去之后才被 release.yml 第 13
  步发现（v0.20.0、v0.21.0 连续两次）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**来源**：v0.21.0 发布事故（2026-10-20）。

**机制（按位置）**：`shipped-set-clean` 的体积上限只在发布时执行（`plugin/scripts/verify-plugin-channel-assertions.ts`，release.yml 的 `verify-plugin-channel` 第 13 步）。`plugin/scripts/release-cut.mjs` 的 preflight 没有对应预检，所以 tag 已经推送、release.yml 已经派发之后才发现产物超限。基线是从 tag 自己的树里读的（release.yml 检出 `inputs.tag`），所以失败之后无法靠在 develop 上补一个提交来救同一个 tag，只能再切新版本；而 tag 一旦推送就是对外可见的。

**后果（实测）**：v0.20.0（2026-10-16）与 v0.21.0（2026-10-20）连续两次因同一条断言失败（`files 287 > ceiling 286`）。v0.20.0 失败之后没有任何后续：之后有人单独发布了 dist-plugin（`publish-plugin-dist` 是独立 workflow，不跑这道门），结果 tag 与 dist-plugin 是 0.20.0，却没有 GitHub Release，`master` 停在 v0.19.0，这样放了 4 天。

**可行性已验证**：本机在一个 detached worktree 里用 release.yml step 5 的同一条命令（`bash plugin/scripts/publish-dist-branch.sh --branch <scratch>`，不带 `--push`）构建，`git archive` 该分支再跑 `node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --check <dir> --size-ceiling`，得到 287 个文件、exit 1，与 CI 完全一致。所以预检不依赖 CI。

**做法**：在 `release-cut.mjs` 的 preflight（创建 release 分支与推送任何 ref 之前）对 `--base` 的树做上述本机构建与检查：
- 超限：拒绝，独立原因 `CAUSE=release-cut-shipped-set-ceiling-exceeded`，输出测得文件数、基线上限，并给出重新锚定命令；
- 构建或检查无法执行：独立原因 `CAUSE=release-cut-shipped-set-precheck-unavailable`，⛔ 不得与通过共用输出（硬规则 3b）；
- 通过：打印一行读数（测得文件数 / 上限）；
- 提供显式放行开关，写法对照既有的 `--allow-workflow-drift`，放行时仍打印读数；
- `--dry-run` 同样执行预检，但执行后不得留下任何 ref、worktree 或分支（构建用的临时 worktree 与临时分支在成功和失败路径上都要清理）。

**不在本任务范围**：重新锚定基线本身（另有任务）；把体积门接进 CI 的定期执行（该门要求非 -dev 产物，而 develop 产物必带 -dev，不可直接搬）；红灯率调查。

## AC

- [x] AC0（真实路径，超限）：在 `plugin/test/release-cut.test.mjs` 现有的夹具框架里新增用例，让预检在**真实调用路径**上遇到超限产物，断言 `release-cut.sh` 以非零退出、输出含 `release-cut-shipped-set-ceiling-exceeded`、没有创建 tag、没有留下 worktree 或分支；⛔ 不得只单独调用拼文案的函数
- [x] AC1（真实路径，不可用）：新增用例让构建或检查无法执行，断言输出含 `release-cut-shipped-set-precheck-unavailable`，且该输出与通过时的输出不同
- [x] AC2（真实路径，通过）：新增用例在上限充足时预检通过并打印读数，后续步骤照常进行
- [x] AC3（变异对照）：把预检改成永远通过，AC0 的用例必须变红；把变红输出贴进 `## Evidence`
- [x] AC4（真实仓库读数）：在一份临时拷贝的夹具根上（⛔ 不得改动并提交真实的 `plugin/shipped-set-baseline.json`）把 `shipped.files` 调低 1，运行 `bash plugin/scripts/release-cut.sh <X.Y.Z> --dry-run`，必须以新原因拒绝；对未改动的树运行同一命令必须通过；两次输出都贴进 `## Evidence`
- [x] AC5（不留残渣）：AC4 的两次运行前后对比 `git for-each-ref`、`git worktree list`、`git branch`，无新增；贴对比输出
- [x] AC6（不回归）：`plugin/test/release-cut.test.mjs` 全部通过，贴 exit 码
- [ ] AC7（读生产载体）：下一次真实切版时，preflight 在推送 tag 之前打印了体积预检的读数，贴该次切版日志中的对应行（待外部）

## DoD

真实落地：下一次真实切版时，如果产物超限，`release-cut.sh` 在创建分支、推送 tag 之前就以 `release-cut-shipped-set-ceiling-exceeded` 拒绝，不再出现“tag 已推出去、release.yml 才在第 13 步失败”的情形；若预检本身无法执行，会以独立原因说明，而不是静默通过。仅“测试存在”不算达标。

## Touches

- plugin/scripts/release-cut.mjs
- plugin/scripts/release-cut.sh
- plugin/test/release-cut.test.mjs
- tasks/gap-release-cut-preflight-misses-shipped-set-size-ceiling-until-the-tag-is-pushed.md

## Evidence

### 实现（改动面）

- `plugin/scripts/release-cut.mjs` — 新增 **preflight ⑥**（原有的 CI 读数记录顺延为 ⑦，编号不复用）：`precheckShippedSetSize()` 在 `--base` 上建一个 throwaway linked worktree、把 base 提交放在 **`release/*` 分支**上（下详）、用**发布自身的机制** `plugin/scripts/publish-dist-branch.sh --branch <scratch>` 构建、`git archive` 取产物、再跑 `shipped-set-rules.ts --check <产物目录> --size-ceiling --json`。判定用 JSON 的**枚举读数**（`evaluated` / `size.over` / `size.measured` / `size.ceiling`），⛔ 不靠退出码猜；三条互不共用输出的结局：within（打印读数）、`CAUSE=release-cut-shipped-set-ceiling-exceeded`（含测得数、上限、`--reanchor` 命令）、`CAUSE=release-cut-shipped-set-precheck-unavailable`（含子进程自己的话）。新开关 `--allow-shipped-set-ceiling`（对照 `--allow-workflow-drift`，放行时仍打印读数）。`finally` 里删 worktree + 两个临时分支 + `worktree prune`，成功/失败/`--dry-run` 三条路径都走。
- **必须落在 `release/*` 分支上（实测，不是风格）**：`publish-dist-branch.sh` 的构建链是 `build-plugin-dist --rewrite && stamp-version && version-consistency --stamp-bundle-tree && --bundle-tree && { prune 不可达 .sh }`。`resolve-version.ts --mode build` 在**detached HEAD 且无版本 tag** 时返回 NOT-EVALUATED（exit 3）；因为它是 `&&` 链中间的一环，bash 的 errexit 不触发，**链的其余部分被静默跳过**。本机实测同一条树：detached 构建得到 **306 文件 / 16594 .sh 行**（跳过了 .sh 剪枝与 bundle 版本门），`release/*` 构建得到 **287 / 7345**（差正好是剪枝掉的 19 个 .sh）。所以探针把 base 提交放在 `release/preflight-v<version>-<pid>` 上——也正是这次切版马上要创建的形状。
- `plugin/scripts/release-cut.sh` — 只改头注释（`--help` 面）：preflight 清单 + 新开关 + `--dry-run` 的「read-only」说明。代码行数未变（sh-census 的 code-line 轴只计非注释行）。这条写入已在 Touches 里申报（anti-drift 首轮报出 out-of-declared，这是任务自身的 `--help` 面，属登记而非回退）。
- `plugin/test/release-cut.test.mjs` — AC0/AC1/AC2 三个用例 + 两个夹具助手（`setShippedCeilingOnDevelop` 写**提交**在 develop 上的 `shipped` 上限、`breakPublisherOnDevelop` 让发布子进程带自己的话失败）。`makeClone` 现在给每个夹具种一个**宽裕且已提交**的上限，理由写在注释里：否则本文件其余 14 个用例都会因为仓库自己的（当时还是过期的）基线而变红，而那并不是它们的主题。

### AC0 / AC1 / AC2（真实路径，scoped gate 输出）

```
✔ AC0: an artifact OVER the shipped-set size ceiling REFUSES the cut — no tag, no worktree, no branch, no ref moved (12565.57119ms)
✔ AC1: a publisher that cannot run is its OWN cause (…-precheck-unavailable), never the pass or ceiling arm (3233.927794ms)
✔ AC2: within the ceiling the preflight PRINTS its reading and the cut proceeds normally (13668.158388ms)
```

AC0 断言的是**测得的**文件数（`files (\d+) > ceiling 1` 且 `> 1`），所以「预检被删掉」或「只拼一句话」都不可能满足；同时断言 `for-each-ref` 与 `git worktree list --porcelain` 逐字不变（探针的临时 ref/worktree 已清理）、tag 与 `release/v9.9.3` 都不存在。AC1 用夹具里的**失败发布器**（子进程），断言 CAUSE 是 unavailable 臂、带着子进程自己的 `PUBLISHER-BLEW-UP`，且 stdout 里**没有**通过臂的读数行。

### AC3（变异对照）

把预检改成永远通过，AC0 变红：

```
$ sed -i 's/    if (over.length > 0) return { verdict: "exceeded"/    if (false \&\& over.length > 0) return { verdict: "exceeded"/' plugin/scripts/release-cut.mjs
627:    if (false && over.length > 0) return { verdict: "exceeded", measured: size.measured, ceiling: size.ceiling, over };
$ node --test --test-name-pattern 'AC0:' plugin/test/release-cut.test.mjs
MUTANT_TEST_EXIT=1
✖ AC0: an artifact OVER the shipped-set size ceiling REFUSES the cut — no tag, no worktree, no branch, no ref moved (12639.991114ms)
  AssertionError [ERR_ASSERTION]: an over-ceiling artifact must REFUSE the cut: preflight: shipped-set size ceiling: files 287 / ceiling 1 · .sh lines 7345 / ceiling 1 — within (built from 'develop' by plugin/scripts/publish-dist-branch.sh; source: plugin/shipped-set-baseline.json)
  ...
  cut-tagged: 'v9.9.3' at 921dcf4bdedea3b903f3f7b0524da153777ca7da
  cut: v9.9.3 landed on 'develop' (merge point tagged, 'release/v9.9.3' deleted), released via release.yml, and 'develop' now carries 9.10.0
  0 !== 2
```

放行变异版之后 tag 真的推出去了——这正是本任务要消灭的形态。变异已还原（`git checkout -- plugin/scripts/release-cut.mjs`，`grep -c "false && over.length"` = 0）。

### AC4（真实仓库读数，临时拷贝）

夹具根 = `/data/home/yale/work/quay-scratch/ac-ceiling-fixture/repo`（`git clone --local --no-hardlinks` 的拷贝，HEAD 与 `develop` 均为本任务合并后的树 `285e02fc6`，`node_modules` 符号链接）。真实的 `plugin/shipped-set-baseline.json` **未被改动**（见 AC5：两次运行前后 `git branch` / `for-each-ref` 逐字相同；调低只发生在拷贝里，并 commit 在**拷贝的** develop 上——预检构建的是 develop 的树，未提交的改动根本不在被构建的树里）。

未改动的树（`shipped.files` = 287，即另一任务已重新锚定的真实读数）：

```
$ bash plugin/scripts/release-cut.sh 9.9.9 --dry-run --root <FIXTURE>
EXIT1=0
preflight: shipped-set size ceiling: files 287 / ceiling 287 · .sh lines 7345 / ceiling 7345 — within (built from 'develop' by plugin/scripts/publish-dist-branch.sh; source: plugin/shipped-set-baseline.json)
...
dry-run: preflight PASSED — nothing was created and no ref was touched
```

把拷贝里的 `shipped.files` 调低 1（287 → 286）并提交在拷贝的 develop 上，同一命令：

```
$ bash plugin/scripts/release-cut.sh 9.9.9 --dry-run --root <FIXTURE>
EXIT2=2
CAUSE=release-cut-shipped-set-ceiling-exceeded — the artifact built from 'develop' exceeds the shipped-set size ceiling: files 287 > ceiling 286 (exceeds by 1). release.yml's shipped-set-clean would FAIL on the tag this cut is about to push, and that verdict cannot be repaired afterwards (release.yml reads the ceiling from the tag's own tree). Re-anchor it DELIBERATELY on 'develop' first (a commit — the number is not hand-fit): node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --reanchor <built-artifact-dir> --why "<why>" (record the before/after run output), then re-run this cut. Or pass --allow-shipped-set-ceiling to cut anyway
```

（`files 287 > ceiling 286` 与 v0.20.0 / v0.21.0 两次 CI 失败的逐字读数一致——即预检复现的正是它要预测的那次判定。）

### AC5（不留残渣）

每次运行前后各拍一次 `git for-each-ref` + `git worktree list --porcelain` + `git branch`（129 行快照）：

```
$ diff -u before-run1.txt after-run1.txt   # 未改动树的运行
STATE-DIFF: identical
$ diff -u before-run2.txt after-run2.txt   # 调低上限后的拒绝运行（EXIT2=2）
STATE-DIFF: identical
```

即：探针建出来的 `release/preflight-v9.9.9-<pid>`、`release-cut-preflight-artifact-<pid>` 两个临时分支与临时 worktree 在**通过路径和拒绝路径**上都已消失，`--dry-run` 没有留下任何 ref、worktree 或分支。

### AC6（不回归）

```
$ node --test plugin/test/release-cut.test.mjs
ℹ tests 17
ℹ pass 17
ℹ fail 0
（duration_ms 237910）
```

同一文件在改动前的 develop 版本是 `tests 14 / pass 14 / duration 199109ms`——即三个新用例之外无回归，本文件的总耗时增加约 39s（每个 cross-checkout 的构建约 6–10s）。scoped gate（`bash scripts/test.sh --for-task gap-release-cut-preflight-misses-shipped-set-size-ceiling-until-the-tag-is-pushed --allow-thin`）里同一文件同样 17/17 绿。

### 静态检查 `kernel-sibling-resolution-check`（2026-10-21 本轮修复 —— 上一轮 suite 红的真因）

上一轮 exited-not-landed 的 suite 红**不是 flake**：`STATIC_CHECK_FAILED: kernel-sibling-resolution-check exit=1`，两处命中都是本任务 preflight 新增的两行（`plugin/scripts/release-cut.mjs:540-541`，形如 `path.join(worktree, "plugin", "scripts", <name>)` 的 P2 target-root）。这两行是**刻意**锚在「被判定那棵树（`--base`）」上的——release.yml 读的正是 tag 自己树里的 publisher / checker，所以被测树必须自己提供判定机件；⛔ 不是改用 `resolveKernelSibling`（那解析的是 release-cut 碰巧从哪个 checkout 运行，不是被测事实）。按检查器既有的 `kernel-sibling-dev-tree-only:` 标记（带理由、与命中同处可复核；release-cut 是 dev-tree-only，第三方项目不跑它）登记豁免，并在两行上方写明理由。

```
$ node --no-warnings --experimental-strip-types plugin/scripts/kernel-sibling-resolution-check.ts
kernel-sibling-resolution-check: PASS — 452 kernel file(s) scanned, 0 naive kernel resource resolution(s)
EXIT=0
$ node --no-warnings --experimental-strip-types --test plugin/test/kernel-sibling-resolution-check.test.mjs
ℹ tests 27 / pass 27 / fail 0
```

修复后 scoped gate 重跑仍绿（`plugin/test/release-cut.test.mjs` 17/17，exit 0）；anti-drift Touches 检查 `ANTI-DRIFT OK: 3 actual file(s), all within declared Touches`。

## Blocker

**2026-10-20T23:23:41.526Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: incomplete suite (598/598 files) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：810ab1fd-9d3b-437e-b26e-ad3c18e38e46
- 后续（2026-10-21 本轮）：真因是静态检查 `kernel-sibling-resolution-check` 对预检新增两行的 P2 命中（见 Evidence 末节），已修复并在本 worktree 重跑为 PASS；AC7 仍为（待外部）。
