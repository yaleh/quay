---
id: gap-ci-test-job-tmpdir-on-disk-not-tmpfs
title: CI test job 把 TMPDIR 指向 runner 磁盘目录：runner 容器 /tmp 是 tmpfs，quay init
  拒绝且吃内存（与夹具修复互补）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal

**真实读数（2026-10-15）**：`ci.yml` 的 `test` job 跑在自宿主 runner `tokyo-alpha`（本机 `gh-runner-quay` 容器）。该容器自 `gap-ci-runner-container-needs-user-systemd`（done，2026-10-10）起以 `--tmpfs /run`、`--tmpfs /tmp` 运行（容器内 systemd 需要）。develop 的 `ci.yml` 最近一次 success 是 2026-10-10T03:04:40Z（`2b8dd5689`），2026-10-11 起取到的 400 次 run 全部 failure。直接失败点是 `profiles-role-coverage-check` 的 mutation 夹具在 tmpfs `/tmp` 上跑 `quay init` 被拒（已立案 `gap-ci-mutation-fixture-profiles-role-coverage-tmpfs-always-red`，只修那一个夹具）。

**本任务**：从 job 层面让所有测试的临时文件落在磁盘上，而不是只修一个夹具——在 `test` job 的 `env:` 里设 `TMPDIR: ${{ runner.temp }}`（runner 的工作盘目录，非 tmpfs）。这同时消掉两类问题：① 任何在 `os.tmpdir()`/`mktemp` 下跑 `quay init` 的测试都会撞 tmpfs 拒绝；② 套件在 tmpfs `/tmp` 写临时文件直接吃容器内存。⛔ 不改 runner 容器的 `/run`、`/tmp` tmpfs（systemd 需要）；⛔ 不放宽 `quay init` 的 tmpfs 拒绝。

## Plan

1. 在 `.github/workflows/ci.yml` 的 `test` job `env:` 加 `TMPDIR: ${{ runner.temp }}`（若该 job 已有 env 块则追加）。
2. 本地用与 CI 等价的条件复现：在 `/tmp` 为 tmpfs 的环境（容器 `--tmpfs /tmp` 或等价 mount namespace）里分别以默认 `TMPDIR` 与 `TMPDIR=<磁盘目录>` 跑 `plugin/scripts/checker-mutation-cases/profiles-role-coverage-check.sh` 对应的 mutation 检查，记录 A/B。
3. 校验 workflow 语法。

**⚠️ 执行期对 Plan 第 1 步的偏离（机械实测，非口味）**：第 1 步按字面写**不可行**。`jobs.<job_id>.env` **不能读 `runner` 上下文** —— GitHub 上下文可用性表对该键只允许 `github/needs/strategy/matrix/vars/secrets/inputs`；`runner.temp` 只对 **step 级**键（`steps.*.env` / `steps.*.run` 等）合法。而且它不是 no-op：actionlint 报 `context "runner" is not allowed here [expression]`，GitHub 会因校验失败**拒绝加载整个 workflow 文件** ⇒ ci.yml 里**所有** job（含 `test` 自己）连启动都不会启动 —— 比要修的「红」更坏。故改为：在 checkout 之后新增 1 个 step，把 `TMPDIR=$RUNNER_TEMP` 写进 `$GITHUB_ENV`（本 runner 上与 `runner.temp` 同值）。`$GITHUB_ENV` 是「job 级变量、值来自 step 期上下文」的受支持机制，**同样覆盖该 job 其余全部 step**，即 Plan 想达到的 job 级覆盖面。详见 `## Disposition`。

## Acceptance Criteria

- [x] AC1: `ci.yml` 的 `test` job 设置 `TMPDIR` 为 runner 工作盘目录（粘贴 diff）；其它 job 与 runner 配置不变。 —— `test` job 新增 1 个 step（`Point TMPDIR at the runner's disk-backed temp dir (not the container's tmpfs /tmp)`），把 `TMPDIR=${RUNNER_TEMP}` 追加进 `$GITHUB_ENV`（`$RUNNER_TEMP` = `runner.temp`，本 runner = `/_work/_temp`，bind mount 自 `/data/scratch/yale/actions-runner-quay/_work`，`stat -f -c %T` = `xfs`）。delta 只有 `.github/workflows/ci.yml` 一个文件，且只有 `test` job 多了 1 个 step；其余 5 个 job 的 `runs-on`/`timeout-minutes`/`permissions`/`if`/`strategy`/`env` 与 develop **逐字段相同**（diff 与逐字段读数见 `## Disposition`）。
- [x] AC2: 在 tmpfs `/tmp` 条件下 A/B：默认 `TMPDIR` 时 `profiles-role-coverage-check` 的 mutation baseline 为 NOT-EVALUATED（quay init 拒绝 tmpfs），`TMPDIR` 指向磁盘目录时为 GREEN（粘贴复现命令与原文读数）。 —— 同一 `--tmpfs /tmp` 容器、同一 worktree、同一条命令 `bash plugin/scripts/checker-mutation-check.sh --check --only profiles-role-coverage-check`，唯一差异是新 step 是否执行：不执行 ⇒ `MUTATION-FAIL [baseline GREEN (requested roles are all defined)]: checker exited 3, expected 0` ⇒ `MUTATION profiles-role-coverage-check: always-red` ⇒ `HARNESS-EXIT=1`；执行新 step 的**真实 body**（从本 commit 的 ci.yml 里抽出）后 ⇒ 7 条断言全 `ok` ⇒ `MUTATION profiles-role-coverage-check: pass` ⇒ `HARNESS-EXIT=0`。两侧 `stat -f -c %T /tmp` 都仍是 `tmpfs`（runner 配置未动）。原文读数与复现命令见 `## Disposition`。
- [x] AC3: workflow 文件可被解析（`actionlint` 或 YAML 解析读数），且 `git diff` 不含 `packages/quay/src/init.ts`。 —— actionlint（`rhysd/actionlint:latest` 容器）对 develop 版与本版各跑一次：**两侧各 28 条、类别完全相同**（6 × `runner-label`，即自宿主自定义标签 `tokyo-alpha`，pre-existing；1 × 前已存在的 `shellcheck`），**唯一差异是行号随新 step 平移** ⇒ 本改动引入 0 条新 finding；并且正是它抓出了 Plan 字面版本的那条 `[expression]` 致命 finding（偏离的直接依据）。PyYAML `yaml.safe_load` 亦通过。`git diff --name-only develop...HEAD | grep -c 'packages/quay/src/init.ts'` = **0**。读数见 `## Disposition`。

## Definition of Done

AC1–AC3 带真实读数勾选。落地后观测（不在 worker 内）：develop 上第一次真实 `ci.yml` run 的 `test` job 进入并完成测试套件阶段——粘贴 run id、结论、耗时与失败文件清单（若有，另行立案；若 25 分钟超时不够，如实记录供人裁定）。

## Touches

- .github/workflows/ci.yml
- tasks/gap-ci-test-job-tmpdir-on-disk-not-tmpfs.md

## Disposition

**本轮（2026-10-15）实现**：`.github/workflows/ci.yml` 的 `test` job 在 `actions/checkout@v4` 之后新增第 1 个 step，把 `TMPDIR=$RUNNER_TEMP` 写进 `$GITHUB_ENV`；step 自身 fail-closed（`RUNNER_TEMP` 为空即 `exit 1`，不写）。job 的 `env:` 块里**只留一条注释**说明为什么 TMPDIR 不能写在那里。

### 为什么不是 `env:`（Plan 第 1 步字面版）—— 一条被 actionlint 抓出来的致命缺陷

先按 Plan 字面写成了 job `env:` 里的 `TMPDIR: ${{ runner.temp }}`，AC3 要求的解析读数（actionlint）当场判红：

```
.github/workflows/ci.yml:94:7: context "runner" is not allowed here. available contexts are
"github", "inputs", "matrix", "needs", "secrets", "strategy", "vars". see
https://docs.github.com/en/actions/learn-github-actions/contexts#context-availability for more details [expression]
    |
 94 |       TMPDIR: ${{ runner.temp }}
```

与 GitHub 官方上下文可用性表逐字一致：`jobs.<job_id>.env` 只允许 `github, needs, strategy, matrix, vars, secrets, inputs`；`runner` 是 **step 级**上下文。这不是「写法不优雅」而是**结构性非法**：workflow 文件校验失败 ⇒ ci.yml 全部 job 连启动都不会启动（是「永远不 start」这一最坏失败形态，比现在还红的 CI 更坏）。同文件既有先例 `HOME: ${{ runner.temp }}/scratch-home` 全部位于 **step 级** `env:`，与此判定一致。

### AC1 逐字段读数（`test` job 的 diff 与其余 job 的不变）

```
$ git diff --name-only develop...HEAD
.github/workflows/ci.yml

$ python3 -c "...compare jobs['test'] env/steps + every other job's runs-on/timeout-minutes/permissions/if/strategy/env..."
job key sets identical: True
fields differing across jobs: [('test', 'steps-list')]
test steps before: 10 -> after: 11
added step name: ["Point TMPDIR at the runner's disk-backed temp dir (not the container's tmpfs /tmp)"]

# test job 的 env 块：TMPDIR 不在这里（见上），只多了一条解释性注释
test.env = {'LC_ALL': 'C.UTF-8', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
```

新 step 的 body（从本 commit 的 ci.yml 里程序化抽出，逐字）：

```sh
set -euo pipefail
if [ -z "${RUNNER_TEMP:-}" ]; then
  echo "FAIL: RUNNER_TEMP is empty — refusing to export an empty TMPDIR (os.tmpdir() would fall back to /tmp, the tmpfs this step exists to avoid)" >&2
  exit 1
fi
echo "TMPDIR=${RUNNER_TEMP}" >> "$GITHUB_ENV"
echo "TMPDIR -> ${RUNNER_TEMP} (filesystem: $(stat -f -c %T "${RUNNER_TEMP}" 2>/dev/null || echo unreadable))"
```

**fail-closed 的理由**（硬规则 3b）：`TMPDIR=`（空值）**不等于**「什么都不设」——Node 的 `os.tmpdir()` 会因此回落 `/tmp`，即静默复现本 step 要消灭的那个 tmpfs bug，而日志仍读作「TMPDIR 已设置」。所以空值必须是一个独立的红，不是一个看起来成功的绿。

### AC2 复现命令与 A/B 原文读数

runner 侧事实（本机实测）：`docker inspect gh-runner-quay` ⇒ `Binds ["/sys/fs/cgroup:…","/data/scratch/yale/actions-runner-quay/_work:/_work"]`、`Tmpfs {"/run":"","/tmp":""}`；宿主 `/data/scratch/yale/actions-runner-quay/_work` = `xfs`，宿主 `/tmp` = `ext2/ext3`。⇒ `RUNNER_TEMP`（= `/_work/_temp`）在磁盘上，而容器 `/tmp` 是 tmpfs。

**边 A（新 step 不执行 ⇒ TMPDIR 未设 ⇒ 落到容器 tmpfs /tmp）**：

```sh
WT=/data/home/yale/work/quay-worktrees/gap-ci-test-job-tmpdir-on-disk-not-tmpfs
docker run --rm --entrypoint bash --tmpfs /tmp \
  -v "$WT":"$WT" -v /data/home/yale/work/quay/node_modules:/data/home/yale/work/quay/node_modules:ro \
  -w "$WT" node:24-bookworm \
  -c 'echo "stat -f -c %T /tmp => $(stat -f -c %T /tmp)"; echo "TMPDIR => ${TMPDIR:-<unset>}";
      echo "os.tmpdir() => $(node -e "console.log(require(\"os\").tmpdir())")";
      bash plugin/scripts/checker-mutation-check.sh --check --only profiles-role-coverage-check; echo "HARNESS-EXIT=$?"'
```
```
stat -f -c %T /tmp => tmpfs
TMPDIR => <unset>
os.tmpdir() => /tmp
MUTATION-FAIL [baseline GREEN (requested roles are all defined)]: checker exited 3, expected 0
baseline RED — checker always-red?
MUTATION profiles-role-coverage-check: always-red
mutations_that_always_red: 1
RESULT: FAIL — a checker stayed green under a defect it should catch, or the manifest is incomplete/broken.
HARNESS-EXIT=1
```

根因原文（同容器内直接跑 checker，`--json` 的 `notEvaluatedReason`）——判词是关于 **runner 的 /tmp** 的，不是关于 checker 的：

```
"notEvaluatedReason":"quay init did not complete (exit 2): quay init: worktree root
'/tmp/profiles-role-coverage-5dUo1u-worktrees' is on tmpfs ('/tmp' is tmpfs) — this is memory, not disk.
  Every worktree under it consumes RAM; the 2026-08-04 machine-wide OOM traced straight to it.
  Change it to a real disk path — e.g. '/tmp/profiles-role-coverage-5dUo1u-worktrees', or pass --worktree-root.
quay-init FAILED — closed-set write state: …","status":"not-evaluated","ok":false
DIRECT-EXIT=3
```

**边 B（执行新 step 的真实 body ⇒ TMPDIR=磁盘目录，`/tmp` 仍是 tmpfs）**：

```sh
docker run --rm --entrypoint bash --tmpfs /tmp \
  -v "$WT":"$WT" -v /data/home/yale/work/quay/node_modules:/data/home/yale/work/quay/node_modules:ro \
  -v /tmp/tmpdir-step-body.sh:/tmp/tmpdir-step-body.sh:ro \
  -v /data/scratch/yale/quay-ab-tmpdir-work:/_work \
  -e RUNNER_TEMP=/_work/_temp -e GITHUB_ENV=/tmp/gh-env \
  -w "$WT" node:24-bookworm \
  -c 'echo "stat -f -c %T /tmp => $(stat -f -c %T /tmp)";
      bash /tmp/tmpdir-step-body.sh; echo "STEP-EXIT=$?";
      echo "GITHUB_ENV: [$(cat /tmp/gh-env)]"; set -a; . /tmp/gh-env; set +a;
      echo "TMPDIR => $TMPDIR (stat: $(stat -f -c %T "$TMPDIR"))";
      echo "os.tmpdir() => $(node -e "console.log(require(\"os\").tmpdir())")";
      bash plugin/scripts/checker-mutation-check.sh --check --only profiles-role-coverage-check; echo "HARNESS-EXIT=$?"'
```
```
stat -f -c %T /tmp => tmpfs   (unchanged: tmpfs)
--- executing the step body verbatim (extracted from the committed ci.yml):
TMPDIR -> /_work/_temp (filesystem: xfs)
STEP-EXIT=0
--- $GITHUB_ENV contents: [TMPDIR=/_work/_temp]
TMPDIR is now => /_work/_temp   (stat: xfs)
os.tmpdir() => /_work/_temp
--- run:
ok [baseline GREEN (requested roles are all defined)]: exit 0
ok [RED-1 shipped carrier missing a requested role]: exit 1
ok [RED-2 driver requests an undeclared role]: exit 1
ok [RED-3 the two templates disagree]: exit 1
ok [RED-4 retired role (inner) present]: exit 1
ok [NOT-EVALUATED when no init artifact is obtainable]: exit 3
ok [restored baseline GREEN]: exit 0
MUTATION profiles-role-coverage-check: pass
mutations_that_always_red: 0
RESULT: PASS — every checker IN THIS DELTA went RED under its injected defect and GREEN on restore (narrowed run; the whole-store set is the full-tier registration's job).
HARNESS-EXIT=0
```

**step body 三臂单测**（`RUNNER_TEMP` 未设 ⇒ 必须红且不落盘；设了 ⇒ 写对值；下游子进程真的看得见）：

```
ARM 1 (RUNNER_TEMP unset):  FAIL: RUNNER_TEMP is empty — refusing to export an empty TMPDIR …
                            ARM1-EXIT=1  envfile-bytes=0
ARM 2 (RUNNER_TEMP=/tmp/tmpdir-step-test/disk-temp):
                            TMPDIR -> /tmp/tmpdir-step-test/disk-temp (filesystem: ext2/ext3)
                            ARM2-EXIT=0 ; $GITHUB_ENV = "TMPDIR=/tmp/tmpdir-step-test/disk-temp"
ARM 3 (later step's child): os.tmpdir() seen by a later step => /tmp/tmpdir-step-test/disk-temp
```

### AC3 读数

**actionlint A/B（`rhysd/actionlint:latest`，`--tmpfs` 无关；两侧同一镜像同一命令）**：

```
before findings: 28   after findings: 28
=== finding kinds ===   before: 6 [runner-label] + 1 [shellcheck]
                        after:  6 [runner-label] + 1 [shellcheck]
=== DIFF (before vs after) ===   仅行号平移（301→343 等，新 step 使 ci.yml +42 行）
```

即：本改动**不引入任何新 actionlint finding**；`runner-label`（自定义标签 `tokyo-alpha`，文件里 6 处）与 `shellcheck` 那条都是 develop 上既有的。**这条 A/B 是 AC3 的解析读数，也是发现 Plan 第 1 步致命缺陷的仪器** —— 按 Plan 字面写的版本在这一步多出 1 条 `[expression]`。

PyYAML：`yaml.safe_load(ci.yml)` 通过（`jobs` = test/dist-verify-node-floor/version-consistency/cold-start-e2e/verify-plugin-channel-assertions/release-channel-gate-wiring）。

`init.ts` 未动：`git diff --name-only develop...HEAD | grep -c 'packages/quay/src/init.ts'` = **0**（本分支 delta 只有 1 个文件）。**未放宽 `quay init` 的 tmpfs 拒绝** —— 边 A 的 `notEvaluatedReason` 正是该拒绝仍在生效的活体读数。

仓库自带的 `workflow-runner-self-hosted-check`（注册 checker，逐 workflow 解析 YAML 并判每个 job 是否自宿主）在本 worktree 上：`status: pass`，`10 workflow jobs across 3 files, all runs-on self-hosted`。

### 相关测试（直接跑，非 scoped 选择器）

`ci-runner-env-prereqs` / `workflow-runner-self-hosted-check` / `ci-runner-container-recycle` / `gate-dispatch-coverage` / `ci-runs-collect` / `release-cut` 共 **99 tests, 99 pass, 0 fail**。

### ⚠️ 同源观察（不在本任务内修，供人裁定）

- **`gap-ci-mutation-fixture-profiles-role-coverage-tmpfs-always-red` 的夹具修复尚未落地**（本 worktree 上该 case 文件 md5 = `324a9b46a42206a84562df0d6cb9a1e6`，正是那份任务 Disposition 里记的「改动前」值；任务状态 `ready` + `## Needs-Human`）。本任务**在 job 层面覆盖了它在 CI 上的症状**（TMPDIR 不在 tmpfs 上 ⇒ 该 case 的 baseline 转 GREEN，见 AC2 边 B），但**两处修复互不替代**：那一条修的是「case 依赖 runner 的文件系统类型」这一设计缺陷（本机 `/tmp` 是磁盘时它一直是绿的），本任务修的是「CI 的临时目录落在 tmpfs 上」。即便本任务落地，那份夹具在**其它** tmpfs 环境（开发者容器）里仍会 always-red。
- **`runner-static-gate.ts` 里对 `profiles-role-coverage-check` 的直连检查**（不经 case）同样吃 `os.tmpdir()`；本任务把 job 级 TMPDIR 设到磁盘后它也一并受益，但这一点**未单独取读数**（诚实记录：未评估）。
- **DoD 的两条是落地后观测**，不在 worktree 内：develop 上第一次真实 `ci.yml` run 的 `test` job 结论，以及 25 分钟预算是否够 —— 均未做，留给落地后。
