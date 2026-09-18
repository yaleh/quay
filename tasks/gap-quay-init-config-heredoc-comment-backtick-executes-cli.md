---
id: gap-quay-init-config-heredoc-comment-backtick-executes-cli
title: quay-init.sh 的 config heredoc 未加引号 ⇒ 注释里的反引号被真的执行（quay init
  --reconcile），其多行 stdout 被替换进注释 ⇒ 生成的 .quay/config.yml 不是合法 YAML：develop 上 3
  个安装族测试恒红，每个 code-delta 任务的机械 fan-in 都因此 suite 红
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Finding

**缺陷（实测 2026-09-18，非推断）**：`plugin/scripts/quay-init.sh` 的新装分支用**未加引号的 heredoc** 写 `.quay/config.yml`（`cat > "$cfg" <<EOF`，约 `:1826`）。该 heredoc 内有一行**注释**含反引号（约 `:1854`）：

```
  # LOOP_VERSION_DEFAULTS（CLI `quay init --reconcile` 用它做 diff）。shell 无法 import TS，
```

未加引号的 heredoc 会执行 `$(...)` 与反引号 ⇒ **这行注释里嵌的是一条真命令**：写 config 时 `quay init --reconcile` 在目标目录被**真的执行**，其 stdout 被就地替换进注释；多行 stdout 撑成多行、第二行起没有 `#` 前缀 ⇒ 生成物不是合法 YAML。

**实测产物**（`--loop` 一趟后读回，`:28/:29`）：
```
  # LOOP_VERSION_DEFAULTS（CLI /tmp/repro2-yk5L/.quay/config.yml: reconciled to this version's defaults.
  filled loop.fork_baseline (was absent) 用它做 diff）。shell 无法 import TS，
```
`python3 -c "import yaml,sys;yaml.safe_load(open(sys.argv[1]))" <ws>/.quay/config.yml` ⇒ `ScannerError: while scanning a simple key ... line 29 column 3`，退出码 1。

**一条命令的对照（已跑，决定性）**：放一个 PATH shim（`<shim>/quay` = 往 marker 追加一行后 exit 0）后跑同一趟 `--loop` ⇒ marker 内容 `ran: init --reconcile`（证明注释里的命令被真的执行）；且**shim 不产生 stdout 时 config 合法**（python 退出码 0）⇒ 畸形**专门**来自那条 CLI 的 stdout 被替换进来，不是别的原因。

**依赖宿主的触发条件（硬规则 4b 推论二的形态）**：只有 `quay` 在 PATH 上（本机 `/home/yale/work/quay/plugin/bin/quay`）才命中；不在 PATH 时反引号替换为空串、注释完整、YAML 合法 ⇒ 同一份代码在不同机器上「有时坏」，且静默。这与「字面量合理性依赖当前机器」同族。

**代价（实测）**：develop 上 3 个测试恒红——
- `plugin/test/conformance-target-fixture.test.mjs` AC4 (C)：`readLoopTestCommand` 读不出 `loop.test_command` ⇒ scoped gate 判 `skip`，`AssertionError: 'skip' !== 'run'`
- `plugin/test/quay-init-loop.test.mjs` AC3：python 读回 config 失败 ⇒ `AssertionError: confirmed run must exit 0`
- `packages/quay/test/install-config-driven-e2e.test.mjs` A2：`AssertionError: second install failed`

因此**每一个 code-delta 任务的机械 fan-in 的 suite 步都会红**（已观测两份 fan-in suite 日志，均为同 3 条 `# fail 3`）：`gap-prose-prereq-refs-should-exclude-done-referenced-tasks`（16:32Z）、`gap-touches-parser-early-subheading-latch-hides-declaration`（16:25Z）。

**对照（已跑）**：只把那一行注释改写成不含反引号的措辞、其余一字不动 ⇒ 三个文件全绿（`conformance-target-fixture` 9/9 + `quay-init-loop` 5/5；`install-config-driven-e2e` 3/3），改回原样即全红 ⇒ 根因就是这一行。

**归因边界**：`quay init --reconcile` 自身行为正常（被"当成命令执行"才是异常），`packages/quay/src/init.ts` 无涉。引入提交 = `1cdec24fa`（`gap-quay-init-native-reconcile`，2026-09-18 11:31Z，该任务已 done）。

## AC

- [x] AC1（先红）`bash plugin/scripts/quay-init.sh --loop --root <ws> --project proj --test-command "node --test" --worktree-root <非 tmpfs 的 tmp>` 后，`python3 -c "import yaml,sys;yaml.safe_load(open(sys.argv[1]))" <ws>/.quay/config.yml` 退出码**非 0** 且 stderr 含 `ScannerError`；贴原始输出。
- [x] AC2（后绿）同一命令修复后退出码 0；且 `<ws>/.quay/config.yml` 中 `grep -c "reconciled to this version's defaults"` = **0**（没有 CLI stdout 被替换进来）；贴该计数与 config 中原本那行注释的修复后原文。
- [x] AC3（不回归）`node --no-warnings --experimental-strip-types --test plugin/test/conformance-target-fixture.test.mjs plugin/test/quay-init-loop.test.mjs packages/quay/test/install-config-driven-e2e.test.mjs` 退出码 0，贴 `# tests` / `# pass` / `# fail` 三行（未修复时 `# fail 3`）。
- [x] AC4（执行半边的负控制）PATH shim：`<shim>/quay` = `#!/bin/bash` + `echo "ran: $*" >> <marker>` + `exit 0`，再跑 `PATH=<shim>:$PATH bash plugin/scripts/quay-init.sh --loop ...`；**修复后 marker 不存在**（未修复时 marker = `ran: init --reconcile`）。两态读数各贴一次。
- [x] AC5（同族扫描，硬规则 5b 的产物）扫描 `plugin/scripts/quay-init.sh` 中**所有** heredoc 开启行（`grep -n "<<"`），逐条列出：定界符形态（是否带引号）、内部是否含反引号或 `$(`；把命中数与每条的判定贴出。只修这一行而不给该读数 ⇒ 视为只修了被报出来的那一个。

## DoD

**真实落地判据**：新装路径（`quay-init.sh --loop`，非 `--dry-run`）生成的 `.quay/config.yml` 能被独立 YAML 解析器（python `yaml.safe_load`）解析；且写 config 的全过程中**没有任何注释里嵌的命令被真的执行**（用 AC4 的 PATH-shim 负控制证明，⛔ 不是「在我这台没装 quay 的机器上通过」）。

**验收面**：AC3 的三个测试文件用**真** `quay-init.sh` 子进程铺真实目标（⛔ 非 `makeWorkspace()` 手写快照）+ AC1/AC2/AC4 在真实产物与真实执行路径上的读数。

**可回滚**：还原那一行注释的措辞即可。

## Touches

- plugin/scripts/quay-init.sh
- plugin/test/conformance-target-fixture.test.mjs
- plugin/test/quay-init-loop.test.mjs
- packages/quay/test/install-config-driven-e2e.test.mjs
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-quay-init-config-heredoc-comment-backtick-executes-cli.md

## Evidence（worker 实测，2026-09-18）

**改动**：`plugin/scripts/quay-init.sh` 那一行注释改为不含反引号的措辞，并在该处加注释说明「本 heredoc 未加引号 ⇒ 正文注释不得含反引号/命令替换」；`plugin/test/quay-init-loop.test.mjs` 新增 AC5 用例把该不变式机械化。heredoc **必须**保持未加引号（它要展开 `${PLUGIN_ROOT}` 等），所以「转义」不是选项。

**AC1（先红，用 develop 的 pre-fix 源）**：`python3 yaml.safe_load` 退出码 **1**：
```
yaml.scanner.ScannerError: while scanning a simple key
  in "/home/yale/work/ac184-repro-ws2/.quay/config.yml", line 29, column 3
could not find expected ':'
  in "/home/yale/work/ac184-repro-ws2/.quay/config.yml", line 30, column 3
```
产物 `:28/:29` 与 Finding 记述逐字一致（`reconciled to this version's defaults.` / `filled loop.fork_baseline (was absent)`）。
**触发条件是 cwd = 目标 workspace**：从别处跑时 `quay init --reconcile` 走的是那个目录的 config，输出退化成单行、YAML 恰好仍合法 ⇒ 这正是「静默、依宿主」的形态。

**AC2（后绿）**：`quay-init.sh --loop` 退出码 0；`python3 -c "import yaml..."` 打印 `YAML OK` 退出码 **0**；`grep -c "reconciled to this version's defaults"` = **0**。修复后原文：
```
  # LOOP_VERSION_DEFAULTS（CLI 的 quay init --reconcile 子命令用它做 diff）。shell 无法 import TS，
```

**AC3（不回归）**：post-fix `# tests 18 / # pass 18 / # fail 0`，退出码 0（18 = 17 原有 + 新增 AC5 用例）。**pre-fix 对照**（同一 3 个文件、develop 的源、独立 worktree）`# tests 17 / # pass 14 / # fail 3`，三条失败消息为 `AssertionError: second install failed:` / `AssertionError: scoped gate runs (delegated to test_command)` / `AssertionError: confirmed run must exit 0:`，三者 stderr 均含 `yaml.scanner.ScannerError: while scanning a simple key` ⇒ 与 Finding 的归因一致。

**AC4（负控制，两态）**：
- pre-fix：marker = `ran: init --reconcile`（注释里的命令被真的执行）
- post-fix：marker = **(absent)**（无任何命令被执行）
两态下 `yaml.safe_load` 均退出 0 —— 因为 shim 不产生 stdout；**这正是 AC4 与 AC1/AC2 的分工**：AC4 测「有没有执行」，AC1/AC2 测「产物合不合法」，两者缺一不可。

**AC5（同族扫描）**：`grep -n "<<"` 命中 **11** 条 heredoc；逐条判定 —— **10 条定界符带引号**（`:224 :396 :460 :613 :1056 :1563 :2058 :2086 :2094 :2214`，均 `<<'PYEOF'` / `<<'EOF'`，替换惰性，其中 `:396/:460/:613/:2086/:2094` 内部确有反引号但**不执行**）；**1 条不带引号** = `:1826`（`cat > "$cfg" <<EOF`，必须不带引号）。未加引号者中，pre-fix 含反引号的行 = **1**（`:1854`，即被报出来的那一条），post-fix = **0**。⇒ 同族**没有**第二个实例，且修复覆盖的是「所有未加引号的 heredoc」而非这一行。
该扫描已由新增用例 `plugin/test/quay-init-loop.test.mjs`「AC5 — no unquoted heredoc body in quay-init.sh carries a backtick or command substitution」机械化（含「扫描必须真的找到 heredoc / 必须至少有一条未加引号」的守卫，避免解析失败被读成通过，硬规则 3b）。

**scoped 门**：`bash scripts/test.sh --for-task <id> --allow-thin` 退出码 **0**；`ℹ tests 32 / ℹ pass 32 / ℹ fail 0`；`PASS: quay-init-closure-ratchet: laydown source fingerprint fresh (d38dc71b6e70d01b…, 4 sources) — baseline in sync`。develop merged 且 `git rev-list --count HEAD..develop` = **0** 时复跑一次后据此写 scoped-gate 缓存（developSha `1a431b0181f4f78154d359b610c70919fd0d264b`）。

**closure-ratchet**：改 `quay-init.sh` 必然使 baseline 指纹陈旧。先 `--gate` 确认**未膨胀**（`3 files / 1022 bytes ≤ baseline 3 files / 1022 bytes`，shrink-only），再 `--reanchor`；baseline 的 diff 只有 `fingerprint` 与 `quay-init.sh` 的 `sha` 两处（`files`/`bytes` 一字未动）⇒ 不是用重锚洗白增长。（该 baseline 因此进入 Touches。）

## Evidence — 第二趟复核（merge develop 之后，2026-09-18）

**背景（必须记，否则本任务的 delta 会被读错）**：本任务立案时 develop 的红源是 `1cdec24fa` 那行**未转义**反引号。此后 `7b0b50a1c`（16:37:51Z，**另一个**修复，走「转义反引号 `\``」路线）已先落在 develop 上；本分支的 `0c3da22f3`（16:52:37Z）走的是**另一条**路线（措辞里根本不放反引号 + 新增机械不变式）。两者合并后 develop 侧那套解释性注释与本分支的重复，故本趟把重复段收敛为 2 行（commit `cd8e46091`，comment-only）。
**为什么两条路线都要留**：转义路线依赖「记得转义」，而 `7b0b50a1c` 自己的提交信息就记着它「写这段注释时又复发了一次」；本分支路线的产物里**没有可执行内容**，且由 AC5 用例机械钉住全部未加引号的 heredoc。⇒ 本分支的增量是 **AC5 那一条机械不变式**，develop 的修复没有它。

**本趟读数（在最终源上复跑，非沿用上一趟）**：
- **AC1**：把 `1cdec24fa:plugin/scripts/quay-init.sh` 临时换入后跑同一趟 ⇒ `ScannerError: while scanning a simple key ... line 29, column 3` / `could not find expected ':' ... line 30, column 3`，`yaml.safe_load` 退出码 **1**；产物 `:28/:29` 逐字复现 Finding 记述；`grep -c "reconciled to this version's defaults"` = **1**。
- **AC2**：最终源 ⇒ `quay-init` 退出码 **0**，`yaml.safe_load` 退出码 **0**，该 grep 计数 = **0**；产物中该行原文 = `# LOOP_VERSION_DEFAULTS（CLI 的 quay init --reconcile 子命令用它做 diff）。shell 无法 import TS，`。
- **AC3**：最终源 ⇒ `ℹ tests 18 / ℹ pass 18 / ℹ fail 0`，退出码 **0**；新增用例在列（`✔ AC5 — no unquoted heredoc body in quay-init.sh carries a backtick or command substitution`）。
- **AC4**：两态各复跑一次 —— pre-fix marker = `ran: init --reconcile`；post-fix marker = **(absent)**；两态下 `yaml.safe_load` 均退出 **0**（shim 不产生 stdout，正说明 AC4 测「有没有执行」而非「产物合不合法」）。
- **AC5**：`grep -n "<<"` 命中 **11** 条；解析判定 10 条带引号（惰性）/ 1 条不带引号（`:1826`，必须如此）；**未加引号 heredoc 正文中的危险行 = 0**。带引号的 10 条内部共 13 处反引号，全部因定界符加引号而**不执行**——这正是「按构造安全」与「靠内容干净」的区别。
- **closure-ratchet**：本趟编辑后先 `--gate` ⇒ `PASS: 3 files / 1022 bytes ≤ baseline 3 files / 1022 bytes`（**未膨胀**），再 `--reanchor`；baseline diff 仅 `fingerprint` 与 `quay-init.sh` 的 `sha` 两处，`files`/`bytes` 未动；`--gate` 与 `--check-stale` 复跑均 **PASS**。

**本趟 commit**：`cd8e46091`（收敛重复注释 + 重锚 baseline）。AC 状态经 `task_check` 复核 = **5/5**，未改动任何勾选。
