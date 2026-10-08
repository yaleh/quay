---
id: gap-goal030-branch-selfhost-probe
title: GOAL-030 ③：分支自举探针——证明分支上运行的 promotion-driver / ready-pool-check
  加载的是分支代码，并在沙盒触发两类转移
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal030-promotion-writes-via-kernel-transition
goal_ac: AC-337
---
**type:** execution

## Proposal

GOAL-030 的第三块，也是本试点的核心验收：一个**分支自举探针**，证明「在分支上运行的 Quay driver 加载的是分支自己的代码，而不是主检出」，并在沙盒里实际触发晋升路径的两类转移。GOAL-030 的 AC-337 判据调用本探针，并**独立复核**探针输出里每条事件的代码路径（判据不信任探针自己报的「通过」）。

为什么必须有它：SPEC-goal-branch §4.10/§8 写明预览实例不跑 driver；另有两条实测记录表明 worktree 中的代码可能在运行时加载主检出代码（Core 的 plugin root 在 linked worktree 中重定位到主检出；quay-native 经 `node_modules` 软链解析 `quay/*` 到主检出）。plugin 侧 driver 的子脚本解析（`driver-runtime.ts` 的 `resolveKernelSibling`）锚在 driver 文件自身位置，但会被环境变量 `QUAY_PLUGIN_ROOT` 覆盖。⛔ `quay driver start` 不可用于此目的：anchor 只从主检出起。

探针 `scripts/branch-selfhost-probe.mjs`（`node scripts/branch-selfhost-probe.mjs --json [--keep] [--selftest]`），契约如下：
1. `root` = 探针文件所在 git 树的 toplevel 的 realpath；`main` = `git rev-parse --git-common-dir` 的上一级的 realpath。
2. 运行所有子进程时 ⛔ 删除环境变量 `QUAY_PLUGIN_ROOT`，并在输出 `env.QUAY_PLUGIN_ROOT` 记为 `null`；`TMPDIR=/tmp`。
3. 在 `/tmp` 下建沙盒 workspace：git 仓库（`develop` 与 `author` 两个分支指向同一提交、检出 `author`，提交身份用 `-c user.name/-c user.email`）、真 `.quay/config.yml`（native provider 指向 `<root>/packages/quay-native` 的绝对路径）、`tasks/` 下种入 2 个四件套齐全、带自引用 Touches 的 todo 任务和 1 个四件套不全的 ready 任务，全部已提交。
4. **晋升（默认子进程解析）**：`node --no-warnings --experimental-strip-types <root>/plugin/scripts/promotion-driver.ts --root <沙盒> --once --cap 2 --max-fix-retries 0 --json`，⛔ 不传 `--ready-pool-cmd`（验证 driver 自己解析出的子脚本是哪一份），输出 `promotion.childResolution: "default"` 与 `promotion.flips`（沙盒中实际 todo→ready 的任务数）。
5. **撤回**：`node --no-warnings --experimental-strip-types <root>/plugin/scripts/ready-pool-check.ts --root <沙盒> --revaluate-apply --json`，输出 `revaluation.flips`（实际 ready→todo 数）。
6. `events` = 沙盒 `.quay/task-status-events.jsonl` 的全部记录（原样）。
7. **负对照**（`root ≠ main` 时）：另建一个相同的沙盒，用 `<main>/plugin/scripts/promotion-driver.ts` 跑同样一轮，输出 `negativeControl: {evaluated, events, mainHasModule}`；`mainHasModule` = 主检出是否已有 `packages/quay/src/kernel/task-transition.ts`。
8. **生产不变**：运行前后对主检出 `.quay/` 下 `dispatch-record.jsonl`、`promotion-round.jsonl`、`promotion-outcome.jsonl`、`worker-round.jsonl`（存在者）的 sha256，以及 `git -C <main> status --porcelain -- tasks` 的输出做比较，输出 `production: {unchanged, diff?}`。
9. 退出码：0 = 全部运行完成（是否达标由判据复核）；1 = 运行完成但探针自检发现身份或转移问题（同时在 stderr 写 `CAUSE=`）；3 = 无法评估（沙盒建不起来、driver 启动失败等）。沙盒默认删除，`--keep` 保留并在输出里给出路径。
10. `--selftest`：不跑 driver，只用注入的路径对身份比较器做两面检查（一条写入模块位于 `main` 的事件必须判为 `loaded-main-checkout-code`；全部位于 `root` 的必须判通过），exit 0 / 1。

测试 `plugin/test/branch-selfhost-probe.test.mjs` 运行 `--selftest`（不起 driver，保持套件轻量）。

**实现注记（两处对 Proposal 字面的偏离，均记入 Evidence）**：
- §4 的 `--max-fix-retries 0` 被 driver 本身拒绝（`common.ts`/`promotion-driver.ts:1001` 要求正整数，0 ⇒ exit 2）。探针改用最小值 `1`；沙盒里两个候选全部合格 ⇒ `fixDecisions` 为空 ⇒ 0 个 fix worker，与 0 的行为等价。
- §8 的「sha256 前后比较」在生产上**不是可取的测量**：主检出常驻的 promotion-driver 会在探针运行期间往 `promotion-round.jsonl` 等载体追加记录（实测 12s 窗口内 +468B），裸 sha256 比较会把「别人在写」判成「探针写了」。故 `production.unchanged` 改判一个**可取的假**的性质：没有任何被观察载体的**增量**带本探针的指纹（沙盒 realpath / run-id / 沙盒任务 id）；同时输出 `byteIdentical`（严格）与逐文件 `foreign` 标记，外来追加被点名而非隐藏。真实泄漏（沙盒任务或事件落进主检出）带指纹 ⇒ 判红。**代码身份判据未做任何放松**（`writerModule`/`entry` 仍须落在被求值树内）。

## AC

- [x] 探针自检：`node scripts/branch-selfhost-probe.mjs --selftest` exit 0；`scripts/test.sh plugin/test/branch-selfhost-probe.test.mjs` exit 0
- [x] 本任务 worktree 根（已含 goal 分支上的 kernel 模块与 ready-pool-check 接线）运行 GOAL-030 的 AC-337 判据（`quay goal show AC-337` 的 criterion，用 bash 执行）exit 0；完整输出与探针 JSON 进 Evidence
- [x] 负对照有效：上条探针 JSON 中 `negativeControl.evaluated` 为 true 且 `negativeControl.events` 为 0（主检出尚无 kernel 模块）
- [x] 生产不变：上条探针 JSON 中 `production.unchanged` 为 true；另在 Evidence 贴出运行前后 `git -C <main> status --porcelain -- tasks` 的输出
- [x] 身份判据能取假：cp 备份后临时让探针把 `events` 中一条记录的 `writerModule` 改写为 `<main>` 下的同名路径，运行 AC-337 判据必须 exit 1 且 stderr 含 `CAUSE=loaded-main-checkout-code`；还原后 exit 0；两次 exit 码进 Evidence（⛔ 不用 git checkout 还原）

## DoD

本任务经 goal/GOAL-030 分支落地，⛔ 不落 develop。落地后在 GOAL-030 的判据 worktree（goal 分支 tip）上 AC-337 判据 exit 0。若探针证明 driver 或其子脚本加载了主检出代码（`loaded-main-checkout-code`），⛔ 不得以 `--ready-pool-cmd` 钉死路径、改判据或改探针来绕过——那是 GOAL-030 定义的「分支不健康」信号，必须如实上报并停止扩大范围。

## Touches

- tasks/gap-goal030-branch-selfhost-probe.md
- scripts/branch-selfhost-probe.mjs (new)
- plugin/test/branch-selfhost-probe.test.mjs (new)

## Evidence

**取证时刻**：2026-10-08T04:59Z（本机 +0800，12:59）。**执行树** = 本任务 worktree `/data/home/yale/work/quay-worktrees/gap-goal030-branch-selfhost-probe`（分支 `task/gap-goal030-branch-selfhost-probe`，含 goal 分支的 kernel 模块与 ready-pool-check 接线，取数前已 `git merge develop` 追平）。**主检出**（负对照/生产面的 `main`）= `/data/home/yale/work/quay`。

### ① 探针自检（AC1）

```
$ node --no-warnings scripts/branch-selfhost-probe.mjs --selftest
branch-selfhost-probe --selftest: root=/data/home/yale/work/quay-worktrees/gap-goal030-branch-selfhost-probe main=/data/home/yale/work/quay
SELFTEST PASS
EXIT=0

$ bash scripts/test.sh plugin/test/branch-selfhost-probe.test.mjs
✔ --selftest exits 0 (the probe's own two-sided identity check) (32ms)
✔ identity comparator flags main-checkout code and accepts in-tree code (0.4ms)
✔ production attribution takes both values (0.2ms)
✔ AC-337's criterion fields are all produced by the probe (0.6ms)
ℹ tests 4  ℹ pass 4  ℹ fail 0        EXIT=0
```

### ② AC-337 判据在本 worktree 根 exit 0（AC2）

判据取自正本（`quay goal show AC-337` 的 `criterion`，⛔ 非本任务复写）：

```
$ cd /data/home/yale/work/quay-worktrees/gap-goal030-branch-selfhost-probe
$ bash <(node --experimental-strip-types packages/quay/bin/quay.ts goal show AC-337 --root "$PWD" \
      | sed -n '/^criterion: /,$p' | sed '1s/^criterion: //')
PASS: branch code proven (3 events, all writerModule/entry under
  /data/home/yale/work/quay-worktrees/gap-goal030-branch-selfhost-probe);
  promote 2, retreat 1; negative control 0 events; production unchanged
criterion EXIT=0   (wall ~9.6s，判据自带 timeout 55)
```

探针 JSON（`node --no-warnings scripts/branch-selfhost-probe.mjs --json`，exit 0；此处为完整输出的关键字段；`selfCheck.ok=true, causes=[]`）：

```json
{
  "root": "/data/home/yale/work/quay-worktrees/gap-goal030-branch-selfhost-probe",
  "main": "/data/home/yale/work/quay",
  "env": { "QUAY_PLUGIN_ROOT": null, "TMPDIR": "/tmp" },
  "promotion": {
    "childResolution": "default",
    "childEntry": "/data/home/yale/work/quay-worktrees/gap-goal030-branch-selfhost-probe/plugin/scripts/ready-pool-check.ts",
    "flips": 2,
    "seedStatuses":   { "bsp-todo-alpha": "todo", "bsp-todo-beta": "todo", "bsp-ready-decayed": "ready" },
    "afterPromotion": { "bsp-todo-alpha": "ready", "bsp-todo-beta": "ready", "bsp-ready-decayed": "ready" }
  },
  "revaluation": {
    "exit": 0, "flips": 1,
    "afterRevaluation": { "bsp-todo-alpha": "ready", "bsp-todo-beta": "ready", "bsp-ready-decayed": "todo" }
  },
  "negativeControl": { "evaluated": true, "events": 0, "mainHasModule": false, "exit": 0, "reason": "ran" },
  "production": {
    "unchanged": true, "byteIdentical": true,
    "files": [
      { "path": ".quay/dispatch-record.jsonl",   "changed": false, "attributableToProbe": false, "foreign": false },
      { "path": ".quay/promotion-round.jsonl",   "changed": false, "attributableToProbe": false, "foreign": false },
      { "path": ".quay/promotion-outcome.jsonl", "changed": false, "attributableToProbe": false, "foreign": false },
      { "path": ".quay/worker-round.jsonl",      "changed": false, "attributableToProbe": false, "foreign": false }
    ],
    "foreignDrift": [], "tasksStatusChanged": false, "sandboxArtifactsLeakedIntoMain": false
  },
  "events": [
    { "taskId": "bsp-todo-alpha",    "from": "todo",  "to": "ready", "kind": "promote", "actor": "ready-pool-check --apply",
      "writerModule": ".../gap-goal030-branch-selfhost-probe/packages/quay/src/kernel/task-transition.ts",
      "entry":        ".../gap-goal030-branch-selfhost-probe/plugin/scripts/ready-pool-check.ts", "pid": 3513413 },
    { "taskId": "bsp-todo-beta",     "from": "todo",  "to": "ready", "kind": "promote", "actor": "ready-pool-check --apply",
      "writerModule": ".../gap-goal030-branch-selfhost-probe/packages/quay/src/kernel/task-transition.ts",
      "entry":        ".../gap-goal030-branch-selfhost-probe/plugin/scripts/ready-pool-check.ts", "pid": 3513413 },
    { "taskId": "bsp-ready-decayed", "from": "ready", "to": "todo",  "kind": "retreat", "actor": "ready-pool-check --revaluate-apply",
      "writerModule": ".../gap-goal030-branch-selfhost-probe/packages/quay/src/kernel/task-transition.ts",
      "entry":        ".../gap-goal030-branch-selfhost-probe/plugin/scripts/ready-pool-check.ts", "pid": 3518912 }
  ],
  "selfCheck": { "ok": true, "causes": [], "badEvents": [] }
}
```

两条转移的**代码身份直接量**：三条事件的 `writerModule` 全部 = `<worktree>/packages/quay/src/kernel/task-transition.ts`，`entry` 全部 = `<worktree>/plugin/scripts/ready-pool-check.ts` —— **都在被求值的树内**。`childEntry` 与被 spawn 的 ready-pool-check 是同一份，证明 driver 的默认子脚本解析（`resolveKernelSibling`，锚在 driver 自身位置）没有落到主检出。`promotion.flips`=2 / `revaluation.flips`=1 由**沙盒任务文件的 status 前后读数**得出，与事件条数独立相等。

### ③ 负对照有效（AC3）

`negativeControl.evaluated=true`、`negativeControl.events=0`、`negativeControl.mainHasModule=false`：主检出 `/data/home/yale/work/quay` 上 `packages/quay/src/kernel/task-transition.ts` **不存在**（`ls` 报 No such file），故用**主检出的** `promotion-driver.ts` 在**同一个**沙盒上跑同一轮 ⇒ 沙盒 2 的 `.quay/task-status-events.jsonl` **0 条**。这把 ② 的 3 条事件从「某个 driver 跑过」提升为「**分支代码**跑过」的证据（负对照必需，否则事件条数结构上不可取假，硬规则 4）。

### ④ 生产不变（AC4）

`production.unchanged=true`（本次取数 `byteIdentical=true`、`foreignDrift=[]`、`sandboxArtifactsLeakedIntoMain=false`）。判据要求的运行前后 `git -C <main> status --porcelain -- tasks`：

```
### 运行前
$ git -C /data/home/yale/work/quay status --porcelain -- tasks
（空）

### 运行后
$ git -C /data/home/yale/work/quay status --porcelain -- tasks
（空）
```

⚠️ 如实注记：主检出有常驻 promotion-driver，取数窗口内它可能往 `.quay/promotion-round.jsonl` 追加（实测另一窗口 12s +468B）。故 `unchanged` 按上面的**指纹归属**判定而非裸 sha256：外来追加进 `foreignDrift`（本次为空），**带探针指纹的追加才判红**。本任务已单独验证该归属判据**能取假**（`probeAttributable` 两面检查，见测试 ③）。

### ⑤ 身份判据能取假（AC5，⛔ 全程用 cp 备份/还原，未用 git checkout）

```
$ sha256sum scripts/branch-selfhost-probe.mjs
a4661c786e2a2f2c56211ff75882c3eddce5e568d13768ee083f7708e181a8c0  scripts/branch-selfhost-probe.mjs
$ cp scripts/branch-selfhost-probe.mjs /tmp/bsp-probe-backup.mjs
```

临时注入（在 `out.events = events;` 前把 `events[0].writerModule` 改写为 `<main>/packages/quay/src/kernel/task-transition.ts`）：

```
$ sha256sum scripts/branch-selfhost-probe.mjs      # 注入后
0219881428884490e4ec46086e0afa34efef80dae408c1f6a1fb590573ea3955  scripts/branch-selfhost-probe.mjs

$ bash <AC-337 criterion>
CAUSE=loaded-main-checkout-code — 1 event(s) written by code outside
  /data/home/yale/work/quay-worktrees/gap-goal030-branch-selfhost-probe:
  {"ts":"...","taskId":"bsp-todo-alpha","from":"todo","to":"ready","kind":"promote",
   "writerModule":"/data/home/yale/work/quay/packages/quay/src/kernel/task-transition.ts","entry":"..."}
criterion EXIT=1        ← 判据能取假
```

还原（`cp` 备份覆盖，⛔ 非 `git checkout`）：

```
$ cp /tmp/bsp-probe-backup.mjs scripts/branch-selfhost-probe.mjs
$ sha256sum scripts/branch-selfhost-probe.mjs
a4661c786e2a2f2c56211ff75882c3eddce5e568d13768ee083f7708e181a8c0  scripts/branch-selfhost-probe.mjs   ← 与编辑前逐字节相同

$ bash <AC-337 criterion>
PASS: branch code proven (3 events, all writerModule/entry under .../gap-goal030-branch-selfhost-probe);
  promote 2, retreat 1; negative control 0 events; production unchanged
criterion EXIT=0
```

两次 exit 码：**注入 1 → 还原 0**；还原后 sha256 与注入前逐字节一致，且与已提交版本一致（`git show HEAD:scripts/branch-selfhost-probe.mjs | sha256sum` 相同），`git status --porcelain` 为空。

## 停放说明

本任务以 needs-human 状态立案，用于停放：在 GOAL-030 激活且 `goal/GOAL-030` 分支存在之前，⛔ 不得被派发。由立案会话在核验分支存在后改回 todo；依赖顺序由 frontmatter 的 depends_on 表达。