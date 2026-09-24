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

- [ ] `bash plugin/scripts/release-cut.sh 9.9.9 --dry-run` 在主检出下 exit 0，输出按序列出全部步骤（含 worktree 路径、`--root`、trace 绝对路径、bump 与 ratchet 重锚）且 `git status --porcelain` 前后一致（dry-run 不写）
- [ ] 测试（/tmp 仓库 + linked worktree fixture）：从 linked worktree 调 `release-branch-finish.sh --cut` 且不传 `--trace` ⇒ 记录落在**主检出**的 `.quay/release-branch-finish.jsonl`，linked worktree 的 `.quay/` 下无该文件
- [ ] 测试：独立 clone 里调用 ⇒ stderr 含 `WARN: trace lands in an independent clone`，exit 码与不 WARN 时相同
- [ ] 测试：`release-cut.sh` 在 tag 已存在 / develop 不干净 / version-consistency 失败 三种前置下各自非零退出且 `CAUSE=` 不同，且均未创建 worktree
- [ ] `grep -c 'release-cut.sh' orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` ≥ 1

## DoD

真跑：用 `release-cut.sh` 切下一个真实版本（v0.13.0 或其时的下一版），随后在主检出跑 `bash plugin/scripts/release-branch-finish.sh --log` 可读回该 tag 的 `form=tagged exit=0` 记录，且 `quay goal gate AC-320 --dry-run` exit 0（该 tag 是 AC-320 立条后的第一个样本）。若 release run 因外部原因（runner / 账单）未能完成，AC-320 仍须 exit 0（它只判切版留痕），发布结果另记 runId 与失败 job。

## Touches

- tasks/gap-release-cut-single-carrier-and-main-ledger-trace.md
- plugin/scripts/release-cut.sh (new)
- experiments/quay-perpetual-stream/scripts/release-cut.sh (new, symlink twin)
- plugin/scripts/release-branch-finish.sh
- plugin/test/release-cut.test.mjs (new)
- plugin/test/release-branch-finish.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md
- docs/analysis/test-file-baseline.txt
- docs/analysis/suite-perfile-duration-baseline.json
