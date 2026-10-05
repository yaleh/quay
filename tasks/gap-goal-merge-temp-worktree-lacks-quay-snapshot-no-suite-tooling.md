---
id: gap-goal-merge-temp-worktree-lacks-quay-snapshot-no-suite-tooling
title: goal 并入的临时 worktree 没有 .quay 快照——不跟踪 .quay/ 的项目（cantus）并入的 suite 步读不到
  loop 声明，必红 no-suite-tooling
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
---
## Proposal

**机制**（2026-10-06，cantus 项目第一次 `quay goal merge GOAL-003` 失败；cantus 会话读到、本任务提出者在 quay 源码里复核）：`plugin/scripts/worker-fan-in.ts` 的 `runGoalMergeFanIn`（约 :2587）为并入建临时 worktree（`os.tmpdir()/goal-merge-<id>-XXXX/wt`，`git worktree add --detach … develop`），之后**只**调 `ensureWorktreeNodeModules`，没有 `.quay/` 快照。随后 suite 步经 `defaultMechanicalSuiteCommand`（:1317）→ `readLoopFanInContract(<临时 worktree>)` → `readLoopSection`（:93-99）读 `<dir>/.quay/config.yml`，文件不存在就返回 null，没有任何回退位置 ⇒ `suite_runner`、`test_command` 都读成未声明 ⇒ `suiteCapabilityFailClosed("no-suite-tooling: 未声明 loop.suite_runner 且未声明 loop.test_command（无测试能力）")`（:1358-1359）⇒ goal 并入必红，step=suite。

**触发条件**：项目的 develop 不跟踪 `.quay/`。cantus 在提交 716ad8d 之后即如此；quay 自己的仓库跟踪 `.quay/`（`git ls-files .quay` 非空），所以 quay 自己的测试与演练都测不到（GOAL-904/905 的并入都走通）。同族先例：`packages/quay/src/goal-preview.ts:26-38` 的预览/判据 worktree 已按 `plugin/scripts/refresh-worktree-quay.sh` 的排除集做 `.quay/` 快照，只有并入临时 worktree 漏了。

**生产读数**（cantus，只读转引，本任务提出者未直接读该账本）：`.quay/gate-events.jsonl` 里 `gate: goal-merge-result`、`verdict: fail`、`payload.outcome: red`、`step: suite`、`reason: "no-suite-tooling: 未声明 loop.suite_runner 且未声明 loop.test_command（无测试能力）"`，tipSha `29699631f220`，landedSha null；develop 与 `goal/GOAL-003` 均未动。cantus 的主检出 `.quay/config.yml` 本身有 `suite_runner: delegated` 与 `test_command: npm test`。

**修法（方向，实现者可调）**：
1. 在并入临时 worktree 里提供 `.quay/` 快照（复制，⛔ 不用符号链接），**复用** `goal-preview.ts` 已有的快照实现与排除集（含：实例身份文件 `server.json`/`server.lock`/`server-services.json` 不复制，`node-compile-cache` 等大目录跳过）。⛔ 不要写第三份；需要的话把复制函数抽成共享实现，让预览与并入共用。
2. ⚠️ **时序约束（必须先想清楚）**：quay 自己的仓库**跟踪** `.quay/` 下的一批文件。若在 `git merge --no-ff` **之前**把快照复制进 worktree，会改写这些已跟踪文件，使 merge 因「本地改动会被覆盖」失败（或把快照内容带进工作树脏状态）。快照应在**合并提交造好之后、typecheck/反漂移/suite 之前**铺入，并且只铺**未被该提交跟踪的**条目，或铺入后确保 `git status` 对已跟踪文件无改动——具体手段由实现者定，但两种项目形态（跟踪 `.quay/` 的 quay 自己 / 不跟踪的 cantus）都必须覆盖。
3. 快照里的条目是未跟踪、被忽略的，**不得**进入并入提交（并入提交是 merge 时已造好的，快照在其后，天然满足，但要有断言）。
4. 另一并列的小项（可一并做，不阻塞）：`goal-merge-result` 里 `no-suite-tooling` 的 reason 与 `merge-conflict` 已是不同 step/reason 文案，但人读到 red 时容易把环境问题当代码问题；评估是否在 result 事件里给「能力缺失」一个独立 step 取值（如 `suite-capability`），而不是和「suite 跑了且失败」共用 `step: suite`（硬规则 3b）。若改动面大则降为观察项，在 Evidence 写明理由。

<!-- dedup-ref -->相关但机制不同：`gap-goal-branch-worktrees-lack-node-modules`（done）给并入临时 worktree 补了 node_modules，本任务补它同族遗漏的 `.quay/`；`gap-goal-merge-infra-red-mislabelled-and-rerequest-never-retries`（done）修的是 merge 失败分类与重发请求重试。

## AC

- [x] `plugin/test/worker-driver.test.mjs`（该文件已有 goal-merge e2e 的临时仓库夹具）新增用例，临时仓库**不跟踪** `.quay/`（`.quay/` 在 `.gitignore` 里，主检出有 `.quay/config.yml` 声明 `loop.suite_runner: delegated` 与 `loop.test_command` 为一个写标记文件的命令）：goal 并入成功（outcome landed），且标记文件证明 test_command 真的在临时 worktree 里被执行（不是只看 exit 0）。
- [x] 同文件新增用例，临时仓库**跟踪** `.quay/config.yml`（quay 自己的形态）：并入仍成功，并入提交的文件列表（`git show --name-only <mergeSha>` 相对其第一父提交）不含任何快照条目，且并入过程中 merge 步没有因「本地改动会被覆盖」失败。
- [x] 用例断言快照不含实例身份文件：主检出 `.quay/` 放入 `server.json`/`server.lock`/`server-services.json` 后，临时 worktree 的 `.quay/` 里没有这三个。
- [x] 取假：把快照步骤临时去掉（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面第一条用例变红，且失败信息里出现 `no-suite-tooling`；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 清理路径不退化：既有 goal-merge e2e 里关于「并入后临时 worktree 与 mkdtemp 父目录被删」的用例仍通过，并且对快照目录（`.quay/`）同样被一并删除做一个断言。
- [x] 5b 邻近扫描：grep 其它「新建 worktree 后只装 node_modules、不铺 .quay」的点（`git worktree add` 与 `ensureWorktreeNodeModules` 同现，含 `plugin/scripts/`、`packages/quay/src/`），把命中数与前 3 条贴进 Evidence，逐条判断是否同样要铺快照；需要且在 Touches 内的一并改，其余写明理由。
- [x] `node --test plugin/test/worker-driver.test.mjs plugin/test/worker-fan-in.test.mjs` 退出 0。

## DoD

真实落地判据：在一个 develop 不跟踪 `.quay/` 的项目里，`quay goal merge` 的 suite 步读到该项目 `loop.suite_runner` 与 `loop.test_command` 并真正执行。生产读数是 cantus 重发 GOAL-003 的并入请求后，其 `.quay/gate-events.jsonl` 里新的 `goal-merge-result` 不再是 `step: suite` + `no-suite-tooling`。它依赖 cantus 的 worker-driver 已加载含本修复的版本（升级插件后 `quay driver restart --kind worker`，须由 cantus 侧执行），落地时可能尚未满足，完成记录里须写明该读数是否已取得、以及当时 cantus driver 加载的版本。

## Touches

- plugin/scripts/worker-fan-in.ts
- packages/quay/src/goal-preview.ts
- plugin/test/worker-driver.test.mjs
- plugin/test/worker-fan-in.test.mjs
- tasks/gap-goal-merge-temp-worktree-lacks-quay-snapshot-no-suite-tooling.md

## Evidence

### 改动（两处实现 + 测试）

- **`packages/quay/src/goal-preview.ts`** — `snapshotQuayDirInto(mainRoot, targetRoot, opts?)` 新增可选 `opts.skip(rel)` 谓词：返回非 null ⇒ 跳过该条目（目录则跳过整个子树），并记入 `excluded`/`reasons`。判据/预览两个既有调用方不传 ⇒ 行为逐字不变。
- **`plugin/scripts/worker-fan-in.ts`** — `runGoalMergeFanIn` 在**合并提交造好之后、typecheck/anti-drift/suite 之前**铺 `.quay/` 快照（复用 `snapshotQuayDirInto`，经 `driver-runtime.ts` 取符号——该处已 re-export，零新模块边）；`skip` 谓词 = 「该路径被合并提交跟踪」（`git ls-files -z -- .quay`，读的是 merge 提交后的索引）。另（修法第 4 小项）把 suite 命令解析拆成 `resolveMechanicalSuiteCommand`（argv + `capabilityMissing` 成因），`defaultMechanicalSuiteCommand` 保留为其 argv 投影（既有 import 面逐字不变）；`capabilityMissing` 非 null ⇒ 该步的 step 取值是 `suite-capability`，⛔ 不与「suite 跑了且失败」共用 `suite`（硬规则 3b）。
- **`plugin/test/worker-driver.test.mjs`** — 夹具 `makeGoalMergeRepo(tag, opts)` 支持 `quayConfig`（函数式，拿得到主检出路径）/`trackQuayConfig`；新增 3 个用例。

### AC1/AC2/AC3/AC5 — 三个新用例的实跑

```
✔ goal-merge e2e — develop 不跟踪 .quay：主检出 .quay 快照铺进临时 worktree，suite 读到本项目声明的 test_command 并真的在那里执行
✔ goal-merge e2e — develop 跟踪 .quay/config.yml（quay 自己的形态）：快照不覆盖已跟踪条目，并入提交不含快照条目、merge 不因本地改动失败
✔ goal-merge e2e — 本项目无测试能力（.quay 无 loop 声明）：red 的 step 是 suite-capability，⛔ 不与「suite 跑了且失败」共用 suite
```

判据是**直接量**，不是 exit 0 自述：
- 用例 1 的 `test_command` 是 `pwd > <主检出>/suite-pwd.txt; ls -a .quay > <主检出>/suite-quay-listing.txt`；断言 `$PWD` 的 basename 是 `wt`、其父目录 basename 匹配 `^goal-merge-`（即 test_command 真的跑在临时 worktree 里），且列出的 `.quay/` 含 `config.yml`、**不含** `server.json`/`server.lock`/`server-services.json`（AC3）。并入收尾后断言 `fs.existsSync(pwd)===false` 且 `fs.existsSync(pwd/.quay)===false`（AC5）。
- 用例 2 故意让**主检出的** `.quay/config.yml` 与**合并提交里的**那份内容不同（提交里那条 test_command 写 `suite-quay-status.txt`；主检出那条写 `root-config-ran.txt`）。判据：`suite-quay-status.txt` 存在 ∧ `root-config-ran.txt` **不存在** ⇒ 临时 worktree 用的是**提交里的** config（快照没覆盖已跟踪条目）；该文件内容里每行都以 `??` 开头（无已跟踪文件被写脏）且至少一行命中 `.quay/gate-events.jsonl`（证明快照**确实**铺下了未跟踪条目，断言不空转）；`git diff --name-only <mergeSha>^1 <mergeSha>` 过滤 `.quay/` 后为空（AC2）。

### AC4 — 取假（`cp` 备份恢复，⛔ 不用 `git checkout --`）

停用方式：把 `skip` 谓词临时改成 `(_rel) => "negative-control: snapshot disabled"`（即「步骤还在但什么都不铺」），备份 `/tmp/nc2-backup-worker-fan-in.ts`。第一条用例转红：

```
✖ goal-merge e2e — develop 不跟踪 .quay：主检出 .quay 快照铺进临时 worktree，suite 读到本项目声明的 test_command 并真的在那里执行 (139.316337ms)
ℹ tests 1 / pass 0 / fail 1

  AssertionError [ERR_ASSERTION]: 并入必须落地；step=suite-capability reason=no-suite-tooling: 未声明 loop.suite_runner 且未声明 loop.test_command（无测试能力）
  'red' !== 'landed'
```

失败信息里出现 `no-suite-tooling`（正是 cantus GOAL-003 那次的生产形态）。`cp` 恢复后 `cmp` 备份与盘上文件一致（`RESTORED-BYTES-IDENTICAL`），同一用例转绿：

```
✔ goal-merge e2e — develop 不跟踪 .quay：主检出 .quay 快照铺进临时 worktree，suite 读到本项目声明的 test_command 并真的在那里执行 (184.999757ms)
ℹ tests 1 / pass 1 / fail 0
```

### AC6 — 5b 邻近扫描（谓词：`plugin/scripts/` + `packages/quay/src/` 下同时含 `"worktree", "add"` 与 `ensureWorktreeNodeModules` 的文件）

**命中数 = 2**：

1. `plugin/scripts/goal-driver.ts:3225/3229/3246` — 判据/预览 worktree：三处 `worktree add` 都已在同处调 `snapshotQuayDirInto(root, wtPath)`。**同类但已覆盖，不改**。
2. `plugin/scripts/worker-fan-in.ts:2653` — 本任务修的并入临时 worktree，**已改**。

`git worktree add` 的**全部**站点（非测试，`plugin/scripts` + `packages/quay/src`）共 4 文件 6 处；其余两文件判断为**不同类，无需铺快照**：

- `plugin/scripts/full-suite-runner.ts:914`（one-shot verify worktree）— **已经**经 `provision-verify-worktree.sh` → `worktree-include.sh` 铺 `config.yml` + vendor dist（脚本头注释即为此而写）。不是本缺陷。
- `plugin/scripts/integration-batch-merge.ts:1061`（临时合并 worktree）— 只跑 `git merge` / `git show :3:<path>` / `git checkout --ours`，**不读 `.quay/config.yml`、不跑 suite、不需要 node_modules**；它读的 `.quay` 是**主检出**的 state 文件，不是该临时 worktree 的。不同类。

**观察项（不在 Touches，未改）**：`goal-driver.ts` 的判据/预览 worktree 调 `snapshotQuayDirInto` 时**不传** `skip`——若某项目的 goal 分支/判据 tip **跟踪** `.quay/config.yml`，预览 worktree 的该文件会被主检出副本覆盖（受测树 ≠ 判据 tip，且写脏已跟踪文件）。本任务 Touches 不含该文件，记为观察项。

### AC7 要求的测试

```
$ node --test plugin/test/worker-driver.test.mjs plugin/test/worker-fan-in.test.mjs
ℹ tests 126 / pass 126 / fail 0
```

### scoped 门（worker 预合并步，driver 的 fan-in 同一条命令）

```
$ bash scripts/test.sh --for-task gap-goal-merge-temp-worktree-lacks-quay-snapshot-no-suite-tooling --allow-thin
$ echo $?   # 0
ℹ tests 220 / pass 220 / fail 0
```

已写 scoped-gate 缓存：`developSha 11d39a898a2e5d5363cebbdeb9e7155f387eb96b`。

### DoD 落地读数 — **尚未取得**

真实落地判据是 cantus 重发 GOAL-003 的并入请求后，其 `.quay/gate-events.jsonl` 里新的 `goal-merge-result` 不再是 `step: suite` + `no-suite-tooling`。这需要 **cantus 侧**升级插件并 `quay driver restart --kind worker`（本 worker 只在自己的 quay worktree 内作业，⛔ 不操作 cantus），故**本次完成记录未取得该生产读数**；cantus driver 当时加载的版本本 worker 同样无从读取（也须 cantus 侧命令）。本任务交付的是使其可能的机制 + 可复现的本仓端到端证据：上面两个新用例把「不跟踪 `.quay/`」与「跟踪 `.quay/config.yml`」两种项目形态都造出来，直接量是 test_command 真的在临时 worktree 里执行、且受测树 == 合并提交。
