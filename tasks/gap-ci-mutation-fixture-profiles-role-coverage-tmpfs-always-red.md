---
id: gap-ci-mutation-fixture-profiles-role-coverage-tmpfs-always-red
title: develop CI 自 2026-10-14 起 100/100 红：profiles-role-coverage-check 的
  mutation 夹具在 tmpfs /tmp 上跑 quay init 被拒 ⇒ always-red，阻塞 v0.20.0 正式发布
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal

**真实读数（2026-10-15，quay-fleet Manager 会话 + quay 发布会话 `0aa4332a-…` 只读核实）**
- `gh run list --branch develop --workflow ci.yml --limit 100`：**100/100 failure**，区间 2026-10-14T03:46:35Z – 2026-10-15T06:13:31Z；最近一次 success 是 2026-10-10T03:04:40Z（headSha `2b8dd5689`）。develop 已连续数十个任务落地无一次 CI 绿。
- 最新失败 run `38691147885`（headSha `aa3cbd10a`）`test` job（发布会话读日志）：`checker-mutation-check` 把 `profiles-role-coverage-check` 判为 **always-red**——其 mutation 夹具 `plugin/scripts/checker-mutation-cases/profiles-role-coverage-check.sh` 以 `/tmp` 为 workdir 跑一次真实 `quay init`，而 `quay init` 现对 tmpfs worktree-root fail-closed 拒绝（`packages/quay/src/init.ts` 约 1464–1470 行 `validateWorktreeRoot` ⇒「worktree root … is on tmpfs」）；CI 自宿主 runner（`tokyo-alpha`，本机 `gh-runner-quay` 容器）以 `--tmpfs /tmp` 运行 ⇒ baseline 一步即 NOT-EVALUATED（exit 3≠期望 0）⇒ always-red。本机 `/tmp` 非 tmpfs，同脚本 GREEN ⇒ 只在 CI 容器上复现。
- 后果：`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §3 的切版前置「上一次 decisive CI 绿」不成立 ⇒ v0.20.0 正式发布被阻（发布会话已按边界停下，未切版、未打 tag、未 push）。

## Plan

1. 让该 mutation 夹具不依赖 `/tmp` 的文件系统类型：workdir 改为真实磁盘路径（如仓库内 gitignored 的临时目录或 `$RUNNER_TEMP`/`mktemp -d -p <disk path>`），或显式传 `--worktree-root <真实磁盘路径>` 给 `quay init`。⛔ 不放宽 `quay init` 对 tmpfs 的拒绝（那是 2026-08-04 OOM 的防线）。
2. 用与 CI 相同的条件复现：在一个 `--tmpfs /tmp` 的容器（或等价挂载）里先跑一次改动前得红，改动后得绿（A/B）。
3. 推上 develop 后读一次真实 CI 结论。

## Acceptance Criteria

- [x] AC1: 在 `/tmp` 为 tmpfs 的环境下，改动前 `checker-mutation-check` 对 `profiles-role-coverage-check` 判 always-red、改动后判 GREEN（粘贴 A/B 原文读数与复现命令）。 —— 同一 worktree、同一 `--tmpfs /tmp` 容器、同一条命令，只换该 case 文件的版本：改动前 `MUTATION-FAIL [baseline GREEN (requested roles are all defined)]: checker exited 3, expected 0` → `MUTATION profiles-role-coverage-check: always-red` → `HARNESS-EXIT=1`；改动后 7 条断言全 `ok` → `MUTATION profiles-role-coverage-check: pass` → `HARNESS-EXIT=0`。原文读数与复现命令见 `## Disposition`。
- [x] AC2: `quay init` 对 tmpfs worktree-root 的拒绝逻辑未改动（`git diff` 不含 `packages/quay/src/init.ts`）。 —— 本分支 delta 只有 1 个文件（`git diff --name-only develop...HEAD | grep -c packages/quay/src/init.ts` = 0）；并在同一容器里实测 init 仍拒 tmpfs：`quay init: worktree root '/tmp/tmp.JgkIS7ZyPl-worktrees' is on tmpfs ('/tmp' is tmpfs) — this is memory, not disk.`（exit 2）。

## Definition of Done

落地后观测（不是 worker 可在 worktree 内勾的 AC，故放在 DoD）：develop 上落地后的第一次真实 `ci.yml` run，`test` job 不再因 `profiles-role-coverage-check` always-red 失败——粘贴 run id 与结论；若暴露出其它失败（静态检查此前 fail-closed，测试套件自 2026-10-10 起可能未完整跑过），如实列出、另行立案，不在本任务内修。

AC1–AC3 带真实读数勾选；不绕过任何门禁；不改 runner 配置。

落地标志：develop 上 ci.yml 的 test job 不再出现 profiles-role-coverage-check always-red；随后 quay 发布会话可按 SPEC §3「上一次 decisive CI 绿」前置执行 `bash plugin/scripts/release-cut.sh 0.20.0`。

## Touches

- plugin/scripts/checker-mutation-cases/profiles-role-coverage-check.sh
- tasks/gap-ci-mutation-fixture-profiles-role-coverage-tmpfs-always-red.md

## Disposition

**本轮（2026-10-15）实现**：`plugin/scripts/checker-mutation-cases/profiles-role-coverage-check.sh` —— 该 case 起 checker 时不再让子进程继承环境 `$TMPDIR`，改为给它一个**与检出同一文件系统**的 scratch 根（仓根同级，正是 quay 自己 worktree 的约定：`<repo>-worktrees`）；`rc()` 每次调用都显式 `TMPDIR="$scratch_root"`，退出时 `trap` 清掉。

**为什么这是对的修法（而不是放宽 init）**：`profiles-role-coverage-check.ts` 的断言对象是一次**真实 `quay init` 的产物**，而 init 把 workspace 建在 `$TMPDIR` 下、其**默认 worktree root 是 workspace 的同级目录**（`<repoRoot>/../<base>-worktrees`）⇒ 继承 `/tmp` 的文件系统。CI runner 的 `/tmp` 是 tmpfs（`--tmpfs /tmp`，`gh-runner-quay` on tokyo-alpha，本机 `docker inspect gh-runner-quay` 实测 `{"Tmpfs":{"/run":"","/tmp":""}}`）⇒ 该 case 里**每一次** init 都被拒，checker 只能答 NOT-EVALUATED（exit 3），baseline 把 3≠0 读成 ALWAYS-RED —— 一条关于 **runner 的 /tmp** 的判词，不是关于 checker 的。case 的职责是量 checker，不是量 `/tmp` 的文件系统类型。

**A/B 原文读数**（同一棵 worktree、同一容器配置、同一条命令；唯一差异是该 case 文件的版本 —— 改动前用 `git show HEAD:` 的版本以只读 bind-mount 覆盖同一路径，容器内 `md5sum` 复核 = `324a9b46a42206a84562df0d6cb9a1e6`；改动后盘上文件 = `48116055dbf4737f8954712859c4f155`）：

改动前（`HARNESS-EXIT=1`）:
```
MUTATION-FAIL [baseline GREEN (requested roles are all defined)]: checker exited 3, expected 0
baseline RED — checker always-red?
MUTATION profiles-role-coverage-check: always-red
RESULT: FAIL — a checker stayed green under a defect it should catch, or the manifest is incomplete/broken.
```
改动后（`HARNESS-EXIT=0`）:
```
ok [baseline GREEN (requested roles are all defined)]: exit 0
ok [RED-1 shipped carrier missing a requested role]: exit 1
ok [RED-2 driver requests an undeclared role]: exit 1
ok [RED-3 the two templates disagree]: exit 1
ok [RED-4 retired role (inner) present]: exit 1
ok [NOT-EVALUATED when no init artifact is obtainable]: exit 3
ok [restored baseline GREEN]: exit 0
MUTATION profiles-role-coverage-check: pass
mutations_that_stayed_green: 0
mutations_that_always_red: 0
RESULT: PASS — every checker IN THIS DELTA went RED under its injected defect and GREEN on restore (narrowed run; the whole-store set is the full-tier registration's job).
```
⚠️ 两侧都用了 `--only profiles-role-coverage-check`（文档化的窄化模式）：CI 跑的是全量 `--check`，本任务改动只在这一个 case 内，判词来自同一个 case 的同一个报告行。四条 RED 与 NOT-EVALUATED 那条在改动前**也**是红的（init 被拒 ⇒ 期望 1/3 的断言都拿不到），只是 case 在 baseline 就 `exit 4`，所以 CI 日志里只看得到 baseline 那一条。

**复现命令**（本机 `/tmp` 是磁盘 ⇒ 必须在 `--tmpfs /tmp` 容器里跑；`node_modules` 挂主检出是因为 `quay init` 要 `yaml`）:
```sh
WT=<task worktree>
docker run --rm --entrypoint bash --tmpfs /tmp \
  -v "$WT":"$WT" -v /data/home/yale/work/quay/node_modules:/data/home/yale/work/quay/node_modules:ro \
  -w "$WT" node:24-bookworm \
  -c 'bash plugin/scripts/checker-mutation-check.sh --check --only profiles-role-coverage-check; echo "HARNESS-EXIT=$?"'
```
（A/B 的改动前那一侧，在上面的 `-v` 里再加一条 `-v <改动前副本>:<同路径>:ro` 即可复现。）

**AC2 的另一半（活体负控制，同一 `--tmpfs /tmp` 容器）**: `stat -f -c %T /tmp` = `tmpfs`；`node … quay.ts init --root "$(mktemp -d)" --test-command "node --test"` ⇒ exit 2 + `quay init: worktree root '/tmp/tmp.JgkIS7ZyPl-worktrees' is on tmpfs ('/tmp' is tmpfs) — this is memory, not disk.` ⇒ 拒绝逻辑未动。

**⚠️ 同源观察（不在本任务内修，按 DoD 另记）**: `runner-static-gate.ts` 里那条**直接**检查 `profiles-role-coverage-check`（`--root ${repo_root}`，不经 case）在 CI 上仍会走 NOT-EVALUATED（checker 自己建 workspace 时用的是 `os.tmpdir()` = tmpfs）。`run_checker` 把 exit 3 当第三态（`STATIC_CHECK_NOT_EVALUATED`，不 abort、不算 fail）⇒ 它不产生 CI 红，但意味着该检查在 CI 上**不评估**。本轮不改：AC2 明令 init 的 tmpfs 拒绝不动，而这条检查的输入（runner 的 TMPDIR）不在本任务 `## Touches` 内。

**DoD 的两条**（develop 上落地后第一次真实 `ci.yml` run 的结论、随后 `release-cut.sh 0.20.0`）是落地后观测，不在 worktree 内 —— 未做。

## Needs-Human

**执行 2026-10-15T06:32:55.196Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：unsatisfiableUnannotatedAc=[AC3: 落地后 develop 上一次真实 `ci.yml` run 的 `test` job 不再因该检查失败（粘贴 run id 与结论；若有其它失败如实列出，不在本任务内修）。]（连续 3 轮被结构上不可派的拦截挡住 ⇒ 作者/人改写；⛔ 不派 fix worker）