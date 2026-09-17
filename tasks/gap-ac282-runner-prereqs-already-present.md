---
id: gap-ac282-runner-prereqs-already-present
title: AC-282｜把 prereqProvision 派生进 .quay/ci-runs.jsonl 唯一写面 + tokyo-alpha 预置
  pyyaml/tmux（自定义 runner 镜像）——今天实测 criterion exit 1 停在
  CAUSE=prereq-provision-not-recorded
status: ready
labels:
  - gap
  - test-wall-clock
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-282
---
**type:** execution

## Proposal

**结论｜AC-282 的判据已经就位，但没有任何任务认领把它做出来 —— 今天实测它 exit 1，停在 `CAUSE=prereq-provision-not-recorded`（可区分、非恒真）。本任务认领整条链的三段：①载体侧派生 `prereqProvision`（`plugin/scripts/ci-runs-collect.ts` 是 `.quay/ci-runs.jsonl` 的唯一写面）；②workflow 在 job 日志里打印机器可读 marker（三态**只能**从日志得到，见 §二）；③tokyo-alpha 上把两个真缺的前置预置进 runner 镜像（GOAL-022 范围节第三条「自定义 runner 镜像消除重复装包」的本体）。**

### 一、立案当轮实测（两个读数都贴逐字，⛔ 不是推测）

**读数 A — AC-282 的 criterion 逐字提取后当场跑（`bash`，cwd = 主检出）**：

```
$ node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts get AC-282 --json \
    | python3 -c "import json,sys; open('/tmp/ac282-crit.txt','w').write(json.load(sys.stdin)['criterion'])"
$ bash /tmp/ac282-crit.txt; echo "EXIT=$?"
CAUSE=prereq-provision-not-recorded — the test job of run 35173718038 (https://github.com/yaleh/quay/actions/runs/35173718038) carries no prereqProvision reading, so per-job re-installation cannot be judged from this carrier. This is NOT-EVALUATED, not 'no install happened'.
EXIT=1
```

⇒ 判据**已经越过** `no-post-filing-run` 那一层（载体里 post-filing 的 develop run 已存在），停在**第二层**：载体里根本没有这个读数。exit 1 与 exit 0 **不同形**且带独立 `CAUSE=` ⇒ 它既不是恒真也不是恒假，是诚实的 NOT-EVALUATED。**这就是缺口的直接量。**

**读数 B — 载体现状（判据读的是 `rows[-1]`，就是下面第二条）**：

```
.quay/ci-runs.jsonl 共 92 行；ts > 2026-09-17T00:45:02Z（GOAL-022 activatedAt）的 develop CI run 有两条：
  runId=35173500232  ts=2026-09-17T02:12:13Z  durationSec=215  testFiles=652
  runId=35173718038  ts=2026-09-17T02:15:29Z  durationSec=243  testFiles=652   ← rows[-1]
两条的 test job 键集逐字相同：['conclusion','durationSec','name','steps','timeoutMinutes'] —— 无 prereqProvision。
```

**读数 C — runner 镜像真缺什么（在 tokyo-alpha 上只读探针，⛔ 未改任何东西）**：

```
$ ssh tokyo-alpha 'docker run --rm --entrypoint bash myoung34/github-runner:latest -lc "…"'
ps      /usr/bin/ps        pgrep  /usr/bin/pgrep      python3  /usr/bin/python3 (Python 3.8.10)
tmux    MISSING            gawk   MISSING            grep     /usr/bin/grep
$ ssh tokyo-alpha 'docker run --rm myoung34/github-runner:latest bash -lc "python3 -c \"import yaml\""'
ModuleNotFoundError: No module named 'yaml'
```

⇒ 判据 `NEED = (pyyaml, tmux, procps)` 里**今天真缺两个**（pyyaml / tmux；procps 基础镜像已有）。⇒ 现有那一步里 pyyaml 与 tmux 两段**必然**走 `installed-*` 分支，判据必然 exit 1。**这不是配置疏漏，是镜像本身的状态。**

**读数 D —「每次 job 重装」的机制（逐字读到的 unit 文件，不是推断）**：

```
$ ssh tokyo-alpha 'systemctl --user status gh-runner-quay.service --no-pager'
     Loaded: loaded (/data/home/yale/.config/systemd/user/gh-runner-quay.service; enabled)
     Active: active (running) since Thu 2026-09-17 10:19:37 CST; 35min ago
     Process: ExecStartPre=/usr/bin/docker rm -f gh-runner-quay
     └─ /usr/bin/docker run --rm --name gh-runner-quay … -e EPHEMERAL=true \
          -e DISABLE_AUTO_UPDATE=true -v /data/scratch/yale/actions-runner-quay/_work:/_work \
          myoung34/github-runner:latest
[Service] … Restart=always / RestartSec=5
```

`EPHEMERAL=true` + `--rm` + `ExecStartPre=docker rm -f` + `Restart=always` ⇒ **每处理完一个 job，runner 退出、systemd 5 秒后用同一个镜像起一个新容器**；容器内 `apt-get install` 的结果随之丢弃。⇒ 与 GOAL-022 背景里「ephemeral 容器不留状态」是同一个直接量，且**唯一能消除它的位置就是镜像本身**（workflow 里那一步在 job 内部，怎么改都还是 job 内）。

⚠️ 该 unit 文件的 `EnvironmentFile=%h/.config/gh-runner-quay/env` 内含一个明文 `ACCESS_TOKEN`。**本任务体不复制它**；落地时也不得把它写进任何被 git 跟踪的文件（改动只碰 `ExecStart` 的镜像名那一行）。

### 二、为什么三态**只能**从 job 日志得到（硬规则 4c：判据点名的量必须穿得过中间层还取得到）

`GhJob.steps` 的类型（`plugin/scripts/ci-runs-collect.ts:93`）逐字是 `Array<{ name?: string; conclusion?: string | null; number?: number }>`，而 `toJobReadings():210-216` 只透传这三个键。**`already-present` 与 `installed-apt` 两个分支的 step conclusion 都是 `success`**，jobs API 也不给 per-step 时长 ⇒ **`prereqProvision` 在 jobs API 这一层结构上不可派生**。

⇒ 必须让那一步在**它自己的 stdout** 里打印机器可读的一行（house 形：`__GROUP__` / `__PERFILE__` 已有先例），派生器只读该行。散文措辞（`python3 already has PyYAML (6.0.1)`）**不**作为判据来源 —— 那正是「中间层把量改写掉」的形态。

### 三、两条必须一并修的结构性缺口（⛔ 不修，AC-282 永远到不了 exit 0）

1. **日志拉取闸门**（`collect()`，`:509`）：`if (!alreadyKnown && !knownUnderivable && wantsLogs(r) …)` —— `alreadyKnown` 由 **testFiles** 决定 ⇒ 一条 testFiles 已派生过的 run **永远不会再读日志**，它的 `prereqProvision` 结构性不可派生（这就是增量回填的设计）。闸门要放宽成「testFiles 未知 **或** prereqProvision 未派生」，且**必须保留** `maxLogRuns` 预算与 `log-budget-exhausted:` 留痕（预算耗尽的静默少拉会让「没派生」与「派生不出」同形）。
2. **就地补全只认 testFiles**（`enrichable()`，`:602-606`）：一条在派生落地**之前**已落盘的记录永远拿不到该键。判据读「最新一条」，所以只要派生先落地、run 后到就不阻塞；但按同一条「只补缺失、其余字段逐字保留」的窄边界把它一并纳入，可以消掉在飞窗口里那条永久缺。

### 四、边界（与相邻任务的分工，⛔ 不重复立案）

<!-- dedup-ref -->
本 store 内**无任何任务**以顶层 `goal_ac: AC-282` 认领该 AC（逐文件扫 `^goal_ac:`；AC-279/280/281 各有其主：`gap-suite-split-15-over-30s-test-files` / `gap-checker-mutation-parallel-case-loop` / `gap-ac281-develop-ci-test-job-wallclock-under-30s`）。机制词复扫（prereqProvision / already-present / Install suite runtime prerequisites / 重复装包 / runner image / PyYAML）命中并逐一排除的三条：`gap-goal022-scope-item3-prereq-reinstall-uncovered`（done）**只创建了 AC-282 记录本身**，其 Touches 明写「载体侧派生 prereqProvision 与 runner 预置是**下游工作**，不是本任务的 Touches」；`gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red`（done）要的是**装上**（把 job 一次性跑绿），本条要的是**不要每次装**——同一处代码的两个不同缺陷；`gap-ac281-develop-ci-test-job-wallclock-under-30s`（todo）认领 AC-281（端到端墙钟）。与后者的实测重叠面：它的 Plan 第 3 步① 已点名「Install suite runtime prerequisites（apt PyYAML/tmux/procps，每次 job 重装）… 处置方向按 GOAL-022 范围第三条：把重复装包移出每次 job（runner 侧预置 / 镜像 / 缓存）」，且 Touches 含 `.github/workflows/ci.yml` ⇒ 本条落地镜像后那一步①即被满足（同一次改动，不重复做）；本条不依赖它先落地，也不改它的 `goal_ac`（单值标量），两条改的是同一文件的不同面：本条加**机器可读 marker + 镜像**，它补它自己的残余墙钟项。

### 五、必须让人先看到的耦合（三段链，每一步读数可区分）

L1 载体派生 → 否则恒停 `prereq-provision-not-recorded`；L2 镜像预置 → 否则读到 `prereq-provision-underivable`（marker 全 `absent`）或 `still-reinstalling-every-job`；L3 一次 post-filing 的 develop CI run + 采集 → 否则读数不在载体里。⛔ **只做 L1 不会变绿**（这正是判据「把量挪到产物上」的意图）。⛔ **不得为了让判据变绿而改判据的词表**（例如把 `installed-apt` 认成通过）—— 那是「读不懂 ⇒ 伪装成合格」。

## Plan

1. **载体侧派生（L1，repo 侧，完全可测）**
   - 在 `plugin/scripts/ci-runs-collect.ts` 新增导出 `derivePrereqProvision(logText)`，返回 `{pyyaml, tmux, procps}` 三键，取值逐字 `already-present | installed-apt | installed-pip | absent`（tmux/procps 只有前两者与 `absent`），照抄同文件 `seaVerify`（`:109-164`）的形状与注释族。
   - ⛔ `absent` 是**独立取值**，绝不回落成 `already-present`：「日志拉到了但该 marker 一条都没有」= `absent`；「日志压根没拉」（闸门未开）⇒ **不写该键**（缺 ≠ 0，与 `testFiles` 同款）。
   - 把 job 级读数挂到 `jobs[]` 上（判据读的就是 `latest["jobs"]` 里 `name == "test"` 那条）。若为此需要在 `plugin/scripts/ci-red-attribute.ts` 的 `JobReading` 上加字段，照 `durationSec` / `timeoutMinutes` 的「派生不出就不写」先例。
   - 一并修 §三 的两条（日志闸门 + 就地补全），保留既有的全部留痕。
2. **workflow 打印机器可读 marker（L2 的前置）**
   - `.github/workflows/ci.yml` 的 `Install suite runtime prerequisites` 步，每个前置的每个分支各打印一行，形如 `__PREREQ__ pyyaml=already-present` / `__PREREQ__ tmux=installed-apt`。
   - ⛔ **不删该步、不删任何分支**：`plugin/test/ci-runner-env-prereqs.test.mjs` 断言那一步的 install 配方必须仍在（删掉立刻红）；本条只要求它在预置好的镜像上**走 no-op 分支**。
3. **测试（与实现同轮）**
   - `plugin/test/ci-runs-collect.test.mjs`：正向（三条 marker 全 `already-present` ⇒ 三键全 already-present）；**负控制**（日志含 `installed-apt` ⇒ 该键 ≠ already-present，谓词能取假）；**零命中方向**（日志在、marker 一条都没有 ⇒ 三键全 `absent`）；以及 `collect()` 级一条：testFiles 已知的 run 仍会为 `prereqProvision` 拉日志。
   - `plugin/test/ci-runner-env-prereqs.test.mjs`：断言 marker 行存在，并保留原有 mutation control（防恒真）。
4. **runner 镜像（L2，host 侧；repo 侧留可复现定义）**
   - 新增 `.github/runner/Dockerfile`（`FROM myoung34/github-runner:latest` + `apt-get install -y --no-install-recommends python3-yaml tmux procps`；procps 基础镜像已有，仍显式写上以防基础镜像变动）。
   - 在 tokyo-alpha 上 `docker build -t quay-ci-runner:<tag> .`，只把 unit 文件 `ExecStart` 最后一行的镜像名换掉，`systemctl --user daemon-reload && systemctl --user restart gh-runner-quay.service`。
   - 负控制：变更前记下 `gh api /repos/yaleh/quay/actions/runners`；变更后核对 `tokyo-alpha-1` 仍 `online`（镜像换错会让 job 永久排队，而「排队」与「慢」在载体上是两种形态）。
   - ⛔ GOAL-022「执行主机」节裁定**开发在 boheidc**：本条对 tokyo-alpha 的动作**只限 runner 部署**（读 unit / build 镜像 / 重启服务），⛔ 不在该机上改本仓库代码、不在该机上建 worktree。
   - 落地后把 AC-281 任务体第 3 步① 标注一句「已由本条满足」（只加事实，⛔ 不改它的 AC / DoD / 状态）。
5. **生产跑 + 采集 + 收口（L3）** — `gh workflow run ci.yml --ref develop`（或 push develop）；job 结束后在**主检出根**跑 `node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --branch develop --workflow ci.yml --limit 20`（载体是 workspace-local 的 gitignored 运行时文件，必须在主检出根产出），再跑 AC-282 的 criterion 收口。

## AC

- [x] **AC1｜`derivePrereqProvision` 存在、词表四值、`absent` 不回落。** 核法：`grep -n "export function derivePrereqProvision" plugin/scripts/ci-runs-collect.ts` 命中；`node --experimental-strip-types --test plugin/test/ci-runs-collect.test.mjs` **exit 0**；贴出四条新用例名与去色后的汇总行（⚠️ node 汇总行带 ANSI 色，`grep '^# fail 0'` 会取零，先 `sed 's/\x1b\[[0-9;]*m//g'` 再断言）。**实测 2026-09-17**：`ci-runs-collect.ts:164:export function derivePrereqProvision(logText: string): Record<string, string> {`；`ℹ tests 38 / ℹ pass 38 / ℹ fail 0`（exit 0）。四条新用例：①`prereqProvision — 三条 marker 全 already-present ⇒ 三键全 already-present`；②`prereqProvision — 负控制①（谓词能取假）：marker 说 installed-apt ⇒ 该键 ≠ already-present`；③`prereqProvision — 负控制②（零命中方向）：日志在、marker 一条都没有 ⇒ 三键全 absent`；④`collect — testFiles 已知的 run 仍会为 prereqProvision 拉日志（闸门不再只由 testFiles 决定）`。另加 `prereqProvision — 未知取值/marker 名不进入词表`、`collect — prereqProvision 已派生的 run ⇒ 不重复拉日志`、`collect — 没拉日志的 run【不写】prereqProvision 键`、`knownPrereqRunsFromCarrier`、`writeCarrier — 就地补全 prereqProvision` 五条。
- [x] **AC2｜负控制（两个方向各取一次读数）。** ① 谓词能取假：夹具日志含 `__PREREQ__ tmux=installed-apt` ⇒ 该键 ≠ `already-present`（贴命令 + 逐字输出）；② 零命中方向：夹具日志**在**、marker 一条都没有 ⇒ 三键全 `absent`（⛔ 不是 already-present），且不得把「日志拉到了但没 marker」算成通过。**实测 2026-09-17**：`node --experimental-strip-types --test --test-name-pattern "负控制" plugin/test/ci-runs-collect.test.mjs` ⇒ `✔ prereqProvision — 负控制①（谓词能取假）`、`✔ prereqProvision — 负控制②（零命中方向）`，`ℹ tests 4 / pass 4 / fail 0`（exit 0）。**且②在【生产】上取到同一读数**：新派生器对真实 gh job 日志跑 ⇒ `.quay/ci-runs.jsonl` 里最新 post-filing develop run 35173718038 的 test job 得 `{"pyyaml":"absent","tmux":"absent","procps":"absent"}`（marker 尚未落 develop ⇒ 真「没评估成」，不是「没装过」）。
- [x] **AC3｜workflow 打印机器可读 marker，且那一步的配方仍在。** 核法：`node --test plugin/test/ci-runner-env-prereqs.test.mjs` exit 0（mutation control 仍在 ⇒ 不是恒真）；`grep -c '__PREREQ__ ' .github/workflows/ci.yml` ≥ 3，并打印前 3 条命中逐字（硬规则 2 的动作）。**实测 2026-09-17**：`ℹ tests 6 / pass 6 / fail 0`（exit 0，含原 `AC: the prerequisites are DECLARED, not inherited — mutation control` 与原配方断言）；`grep -c` = **8**；前 3 条逐字：`:93`（注释）/`:104: echo "__PREREQ__ pyyaml=already-present"` / `:107: echo "__PREREQ__ pyyaml=installed-apt"`。新增 `AC-282 carrier arm: the prereq step prints a machine-readable __PREREQ__ marker per prerequisite`，自带「删掉 marker 行后同一谓词命中 0」的取假控制。
- [x] **AC4｜runner 镜像已预置，且这是本条的 host 侧直接量。** 核法：在 tokyo-alpha 上 `docker run --rm --entrypoint bash quay-ci-runner:<tag> -lc "python3 -c 'import yaml'; command -v tmux; command -v pgrep"` ⇒ exit 0 且三条都打印路径；unit 文件 `ExecStart` 的镜像名已换（贴逐字行）；`gh api /repos/yaleh/quay/actions/runners` 里 `tokyo-alpha-1` 仍 `online`。⛔ 不贴 token。**实测 2026-09-17**：探针 ⇒ `yaml 5.3.1` / `/usr/bin/tmux` / `/usr/bin/pgrep` / `/usr/bin/ps`，`PROBE_EXIT=0`（ssh 退出 0）；unit 第 18 行逐字现为 `  quay-ci-runner:ac282`（原 `  myoung34/github-runner:latest`，其余 8 行续行一字未动，`ACCESS_TOKEN` 仍只在 `EnvironmentFile` 里）；`gh api …/actions/runners` ⇒ `{"busy":false,"labels":["self-hosted","Linux","X64","tokyo-alpha"],"name":"tokyo-alpha-1","status":"online"}`（变更前同一读数亦为 online）。镜像定义落成 `.github/runner/Dockerfile`（构建时自检三条命令，缺一个则**构建**失败）。`docker ps` 显示容器已在跑 `quay-ci-runner:ac282`。
- [ ] **AC5｜生产载体上有读数，且 AC-282 真的 exit 0。** 核法：贴 `.quay/ci-runs.jsonl` 里**最新一条** post-filing develop run 的 `jobs[].prereqProvision` 逐字（三键齐、无 `absent`），再逐字跑 AC-282 的 criterion（`goal-store.ts get AC-282 --json` 取 `criterion` → `bash`）⇒ **exit 0**，贴 OK 行。⚠️ 若仍 exit 1，**贴它在哪一层停下**（哪一个 `CAUSE=`）；⛔ 不得改判据词表或删 marker 让它变绿。**实测 2026-09-17（前半已达成、后半按原文记 not-evaluated）**：(a) 生产载体上**已有读数** —— 用新写面在主检出根跑 `ci-runs-collect.ts --root /home/yale/work/quay --branch develop --workflow ci.yml --limit 20` ⇒ `appended=0 skipped=20 enrichedPrereq=17 logRunsFetched=17 prereqProvisionDerived=17`；载体里带 `prereqProvision` 的记录由 **0 → 17**，且**非 jobs 字段逐字未变**（窄边界在生产数据上成立）；最新一条 post-filing develop run `35173718038` 的 test job 逐字得 `{"pyyaml": "absent", "tmux": "absent", "procps": "absent"}`。(b) criterion 逐字跑 ⇒ **exit 1**，停在**第二层** `CAUSE=prereq-provision-underivable — run 35173718038 …: {'pyyaml': 'absent', 'tmux': 'absent', 'procps': 'absent'} could not be derived from the job log (NOT-EVALUATED)`——即比立案时的 `prereq-provision-not-recorded` **前进了一层**（L1 已在生产上生效），剩下的 L3 需要一次**由带 marker 的 workflow 产出的** develop run，而该 workflow 只在本任务分支上（判据过滤 `branch == "develop"`）⇒ 这一段**落地前结构上取不到输入**（不是本任务未做）。落地后 `on: push: branches: [develop]` 会自动产出一条新 develop run，goal-driver 每轮 `collectForRound` 会派生并落盘它 ⇒ 自动收敛。⇒ 属外层验证（待外部）。

## DoD

**真实落地 = 三件对象真的被这样操作过**：(a) 载体写面真的派生并落盘了 `prereqProvision` —— 在**主检出根**产出的 `.quay/ci-runs.jsonl` 里读得到；(b) tokyo-alpha 上真的跑着一个预置了 pyyaml/tmux 的 runner 镜像（`docker run` 探针 exit 0），且 repo 里有它的可复现定义；(c) `.github/workflows/ci.yml` 真的在 job 日志里打印了 marker，使 (a) 的读数在**最新一条** develop run 上成立。⛔ 不是「测试绿了」就算 —— 判据读的是**生产载体**（硬规则 4 推论三：一个只能被 fixture / 注入数据满足的判据不是测量）。

1. **落地对象**：`derivePrereqProvision` 在**生产路径**（`collect()`）被调用，不是只被测试调用。**实测**：主检出根那次运行 `logRunsFetched=17 / enrichedPrereq=17`，载体里 17 条记录带上该键 —— 走的就是 `collect()` → `toJobReadings` → `writeCarrier` 这条生产链。
2. **可区分**：AC2 的两次读数都在；`already-present` / `installed-*` / `absent` 三态在输出上彼此可分。**实测**：单元夹具两次 + 生产 `absent` 一次；三态由四个不同取值承载，无「读不懂 ⇒ already-present」路径。
3. **不删既有**：`plugin/test/ci-runner-env-prereqs.test.mjs` 全绿（配方仍在，只是走 no-op 分支）。**实测**：6/6 pass，含原 mutation control 与配方断言。
4. **外部读数**：AC4 的 runner 探针 + `online` 读数；AC5 的生产载体逐字 + AC-282 exit 0。**实测**：探针 exit 0 + `online` + 载体逐字**均已取到**；AC-282 exit 0 需一次落地后的 develop run（AC5 已按原文记 not-evaluated 并标注）。
5. **证据留痕**：读数落成 `.quay/ac282-*` 证据文件或写进任务体，**可被下一轮独立复算**。**实测**：本任务体各 AC 条内含逐字命令与读数；`.quay/ci-runs.jsonl` 本身即留痕（17 条带 `prereqProvision`，可用 `knownPrereqRunsFromCarrier` 复算）。

⛔ **本任务不动任何 AC 的状态**：不翻 AC-282 / AC-279 / AC-280 / AC-281，不改 GOAL-022 的 body。

## Touches

- plugin/scripts/ci-runs-collect.ts
- plugin/scripts/ci-red-attribute.ts
- plugin/test/ci-runs-collect.test.mjs
- plugin/test/ci-runner-env-prereqs.test.mjs
- .github/workflows/ci.yml
- .github/runner/Dockerfile (new)
- tasks/gap-ac281-develop-ci-test-job-wallclock-under-30s.md
- tasks/gap-ac282-runner-prereqs-already-present.md
