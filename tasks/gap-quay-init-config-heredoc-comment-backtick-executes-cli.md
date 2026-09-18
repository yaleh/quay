---
id: gap-quay-init-config-heredoc-comment-backtick-executes-cli
title: quay-init.sh 的 config heredoc 未加引号 ⇒ 注释里的反引号被真的执行（quay init
  --reconcile），其多行 stdout 被替换进注释 ⇒ 生成的 .quay/config.yml 不是合法 YAML：develop 上 3
  个安装族测试恒红，每个 code-delta 任务的机械 fan-in 都因此 suite 红
status: todo
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

- [ ] AC1（先红）`bash plugin/scripts/quay-init.sh --loop --root <ws> --project proj --test-command "node --test" --worktree-root <非 tmpfs 的 tmp>` 后，`python3 -c "import yaml,sys;yaml.safe_load(open(sys.argv[1]))" <ws>/.quay/config.yml` 退出码**非 0** 且 stderr 含 `ScannerError`；贴原始输出。
- [ ] AC2（后绿）同一命令修复后退出码 0；且 `<ws>/.quay/config.yml` 中 `grep -c "reconciled to this version's defaults"` = **0**（没有 CLI stdout 被替换进来）；贴该计数与 config 中原本那行注释的修复后原文。
- [ ] AC3（不回归）`node --no-warnings --experimental-strip-types --test plugin/test/conformance-target-fixture.test.mjs plugin/test/quay-init-loop.test.mjs packages/quay/test/install-config-driven-e2e.test.mjs` 退出码 0，贴 `# tests` / `# pass` / `# fail` 三行（未修复时 `# fail 3`）。
- [ ] AC4（执行半边的负控制）PATH shim：`<shim>/quay` = `#!/bin/bash` + `echo "ran: $*" >> <marker>` + `exit 0`，再跑 `PATH=<shim>:$PATH bash plugin/scripts/quay-init.sh --loop ...`；**修复后 marker 不存在**（未修复时 marker = `ran: init --reconcile`）。两态读数各贴一次。
- [ ] AC5（同族扫描，硬规则 5b 的产物）扫描 `plugin/scripts/quay-init.sh` 中**所有** heredoc 开启行（`grep -n "<<"`），逐条列出：定界符形态（是否带引号）、内部是否含反引号或 `$(`；把命中数与每条的判定贴出。只修这一行而不给该读数 ⇒ 视为只修了被报出来的那一个。

## DoD

**真实落地判据**：新装路径（`quay-init.sh --loop`，非 `--dry-run`）生成的 `.quay/config.yml` 能被独立 YAML 解析器（python `yaml.safe_load`）解析；且写 config 的全过程中**没有任何注释里嵌的命令被真的执行**（用 AC4 的 PATH-shim 负控制证明，⛔ 不是「在我这台没装 quay 的机器上通过」）。

**验收面**：AC3 的三个测试文件用**真** `quay-init.sh` 子进程铺真实目标（⛔ 非 `makeWorkspace()` 手写快照）+ AC1/AC2/AC4 在真实产物与真实执行路径上的读数。

**可回滚**：还原那一行注释的措辞即可。

## Touches

- plugin/scripts/quay-init.sh
- plugin/test/conformance-target-fixture.test.mjs
- plugin/test/quay-init-loop.test.mjs
- packages/quay/test/install-config-driven-e2e.test.mjs
- tasks/gap-quay-init-config-heredoc-comment-backtick-executes-cli.md
