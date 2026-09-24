---
id: gap-release-cut-single-carrier-and-main-ledger-trace
title: 切版一条命令载体 release-cut.sh + release-branch-finish 台账缺省落主检出（AC-320）
status: ready
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-320
---
## Proposal

**直接量（2026-09-24 v0.12.0 切版）**：切版按 SPEC §4 / §12 散文手工做了 12 步（VERSION 校验 → 从 develop 切 `release/vX` → 合回 + 打 tag + 删分支 → push → dispatch `release.yml` → develop 上 bump 下一版 → closure-ratchet 重锚），撞到两个 footgun：
1. `release-branch-finish.sh` 不传 `--root` 时 `repo_root` 取**脚本自身所在检出**（`release-branch-finish.sh:87`）。从主检出（HEAD=`author`）调用 ⇒ 实测 `head-not-base`；于是改在 `/data/scratch/yale/quay-release-cut-v0120` 的独立 clone 里切。
2. 于是 finish 记录落进**那个 clone** 的 `.quay/release-branch-finish.jsonl`，主检出台账末行仍是 2026-09-20 ⇒ SPEC §4 性质 4「THE FINISH LEAVES A RECORD」对读主台账的人不成立。
3. 下一版 bump（`6bb9b925b`，12 个文件）必然改 `docs/analysis/quay-init-closure-ratchet.baseline.json`，散文里没写，是切版者当场撞到的。

**做法（可执行载体，⛔ 不是 SPEC 里再加一节散文——ADR-004）**：
1. 新建 `plugin/scripts/release-cut.sh <version>`，一条命令完成全链：前置校验（`scripts/version-consistency-check.ts`、`develop` 干净且与 origin 同步、tag 不存在）→ **自建一个 linked worktree**（`/home/yale/work/quay-worktrees/release-v<version>`，off `develop`；⛔ 不用独立 clone，⛔ 不在主检出切换分支）→ 在其中调 `release-branch-finish.sh --cut … --root <该 worktree>` → push tag + develop → `gh workflow run release.yml -f tag=v<version>` 并回显 run URL → 在 develop 上用 `scripts/stamp-version.ts` bump 下一版 + 重锚 closure-ratchet baseline 并提交 → 清理自建 worktree。每一步失败都带自己的 `CAUSE=` 与退出码；`--dry-run` 打印全部步骤而不写。
2. **台账落点修正（`release-branch-finish.sh`）**：`--trace` 缺省值由 `<repo_root>/.quay/…` 改为 `<主检出>/.quay/…`，主检出 = `git -C <repo_root> rev-parse --path-format=absolute --git-common-dir` 的父目录（linked worktree 与主检出共用一份台账）。每次写记录时把**绝对路径**打到 stderr；`--log` 同样先打印它读的是哪个文件。独立 clone 里跑时 common-dir 就是该 clone 自己——此情形打一行 `WARN: trace lands in an independent clone, not a linked worktree of the main checkout` 到 stderr（⛔ 不猜「真正的主检出」在哪，AC-320 会在 goal 层抓住这种落错）。
3. SPEC §4 / §12 里的手工步骤散文改为一行指针指向 `release-cut.sh --help`（单一来源）。

## AC

- [x] `bash plugin/scripts/release-cut.sh 9.9.9 --dry-run` 在主检出下 exit 0，输出按序列出全部步骤（含 worktree 路径、`--root`、trace 绝对路径、bump 与 ratchet 重锚）且 `git status --porcelain` 前后一致（dry-run 不写）
- [x] 测试（/tmp 仓库 + linked worktree fixture）：从 linked worktree 调 `release-branch-finish.sh --cut` 且不传 `--trace` ⇒ 记录落在**主检出**的 `.quay/release-branch-finish.jsonl`，linked worktree 的 `.quay/` 下无该文件
- [x] 测试：独立 clone 里调用 ⇒ stderr 含 `WARN: trace lands in an independent clone`，exit 码与不 WARN 时相同
- [x] 测试：`release-cut.sh` 在 tag 已存在 / develop 不干净 / version-consistency 失败 三种前置下各自非零退出且 `CAUSE=` 不同，且均未创建 worktree
- [x] `grep -c 'release-cut.sh' orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` ≥ 1

## DoD

真跑：用 `release-cut.sh` 切下一个真实版本（v0.13.0 或其时的下一版），随后在主检出跑 `bash plugin/scripts/release-branch-finish.sh --log` 可读回该 tag 的 `form=tagged exit=0` 记录，且 `quay goal gate AC-320 --dry-run` exit 0（该 tag 是 AC-320 立条后的第一个样本）。若 release run 因外部原因（runner / 账单）未能完成，AC-320 仍须 exit 0（它只判切版留痕），发布结果另记 runId 与失败 job。

## Touches

- tasks/gap-release-cut-single-carrier-and-main-ledger-trace.md
- plugin/scripts/release-cut.sh (new, thin entry)
- plugin/scripts/release-cut.mjs (new, the renderer behind that entry)
- experiments/quay-perpetual-stream/scripts/release-cut.sh (new, symlink twin)
- plugin/scripts/release-branch-finish.sh
- plugin/test/release-cut.test.mjs (new)
- plugin/test/release-branch-finish.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md
- docs/analysis/test-file-baseline.txt
- docs/analysis/suite-perfile-duration-baseline.json

## Evidence

### 本轮（2026-09-24，第 2 轮）：为什么执行体从 `.sh` 搬进 `.mjs`

上一轮 exited-not-landed 于 `step=scoped-gate`：`STATIC_CHECK_FAILED: sh-census-check exit=1`
（`embeddedInterpreterLines 8153 > baseline 7687`）。读数分解：
`release-cut.sh` 233 行 + `experiments/…/scripts/release-cut.sh` 符号链接孪生 233 行 = 恰好 +466。

`plugin/sh-census-check.ts` 的口径是：一个 tracked `.sh` 只要在【代码位置】出现一次被计数的解释器调用
（`node` 带 `--experimental-strip-types` / `-e` / `--eval`，或直接跑 `.ts`），就把**该文件全部有效行**
计入 `embeddedInterpreterLines`（符号链接按路径计数，故孪生翻倍）。而 `plugin/sh-census-baseline.json`
是**只降不升**棘轮，且实测基线 7687 = 当前读数 ⇒ **零余量**。

⛔ 两条捷径都不走，因为都是「买过闸」：自豁免 `plugin/sh-census-exceptions.txt`（人裁定清单）、
或调高只降不升的基线。**采用本仓库自己的薄入口形态**（`capability-catalog.sh` / `cap-from-gate.sh`）：
入口仍是 `bash plugin/scripts/release-cut.sh`（任务 AC、SPEC §4/§12、catalog 声明键、experiments 孪生
全都按这个形态写死了），但**入口只做三件事**——`readlink -f` 解析自身真实路径、渲染器缺失时
`CAUSE=release-cut-renderer-missing` exit 3、`exec` 渲染器并原样传 argv；**全部逻辑进
`plugin/scripts/release-cut.mjs`**。census 问的正是「这个 `.sh` 是程序还是胶水」，薄入口是诚实答案：
实测 `embeddedInterpreterLines = 7687 = baseline`（零余量未动用）。

渲染器选 **plain ESM（⛔ 不用 `--experimental-strip-types`）** 还有一条独立理由：切版工具必须跑在
切版那一刻 PATH 上的 `node`，而 strip-types 要 Node ≥22.6、ESM 不要 —— 与仓库已有的
`scripts/stamp-version.mjs`（「the Node-20-safe entry」，`sync-vendor.sh` 同法调用）同源。

### 验证读数

- `node --no-warnings --experimental-strip-types plugin/scripts/sh-census-check.ts --root .`
  ⇒ `PASS — embeddedInterpreterLines=7687 ≤ 7687, duplicateCopies=0 ≤ 0`（基线文件未改）。
- `bash plugin/scripts/capability-catalog.sh --summary` ⇒ `360 scripts | 360 declared | 0 unclassified`
  （渲染器按 `capability-catalog.sh`/`.ts` 入口+渲染器先例在 6 张表内声明）。
- `node --test plugin/test/release-cut.test.mjs` ⇒ `pass 6 / fail 0`，含**真实切版**那条
  （linked worktree 建立→合回→打 tag→删分支→台账落主检出→bump 到 9.10.0→清理 worktree）。
- `bash plugin/scripts/release-cut.sh --help` ⇒ 首行 `用法:`，退出 0，无副作用（`gap-scripts-sprawl` 统一形态）。

### 行为等价

`--dry-run` 的全部步骤行、三个 preflight 的 `CAUSE=`（tag 已存在 / 版本不一致 / 树脏）、台账落点
（`release-branch-finish.sh --trace-path` 单一推导）与退出码 0/1/2 逐字保留 —— 由上述测试文件钉住，
无需改测试。

### 未做（DoD 的「真跑」那一半）

DoD 要求用本命令切一个**真实**版本（v0.13.0）并 dispatch `release.yml`。这是对外的发布动作
（推 tag/develop 到 origin、触发 CI、消耗 runner），须由人/管理者在真实发布窗口裁定后执行，
本 worker 不自行发起；载体本身已在 fixture 上端到端真跑过（上面第 3 条读数）。AC-320 是
`long-term` 条，其判据在**下一次真实切版**后自然取到样本。
