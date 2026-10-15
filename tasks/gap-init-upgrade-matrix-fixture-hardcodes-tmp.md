---
id: gap-init-upgrade-matrix-fixture-hardcodes-tmp
title: init-upgrade-matrix 夹具硬编码 /tmp：在 runner 的 tmpfs /tmp 下三条 v0.14/0.15/0.16
  用例恒红（job 级 TMPDIR 覆盖不到）
status: ready
labels:
  - gap
  - ci
parent: null
children: []
extra: {}
---
## Proposal

develop 的 CI 自 2026-10-10 起全红，逐条查 `gh run view <runId> --log-failed` 后，**本文件负责的这一条**不是产品回归，而是**夹具硬编码 `/tmp`**：

- run 38700638546（07:43Z, headSha 290a771369）`plugin/test/init-upgrade-matrix.test.mjs` 三条用例红：
  `AssertionError [ERR_ASSERTION]: v0.14.0: \`quay init\` upgrade failed (2)`（v0.15.0 / v0.16.0 同形），
  同段 stderr 逐字：`worktree root '/tmp/quay-init-matrix-gen/scratch-rel-v0.14.0/../scratch-rel-v0.14.0-worktrees' is on tmpfs`。
- 成因：该夹具在**代码里写死 `/tmp`** 造 scratch 目录 ⇒ 它**不读 `TMPDIR`**。runner（self-hosted `tokyo-alpha`，`gh-runner-quay` 容器）挂 `--tmpfs /tmp`，而 `quay init` 对 tmpfs worktree root 是 **fail-closed 拒绝**（2026-08-04 OOM 防御，⛔ 不得放宽）。
- ⇒ 已 done 的 `gap-ci-test-job-tmpdir-on-disk-not-tmpfs`（把 `TMPDIR=${{ runner.temp }}` 写进 job 级 `$GITHUB_ENV`）**覆盖不到本夹具**：job 级 env 对硬编码 `/tmp` 无效。

## Plan

1. 定位夹具里造 scratch 的那处路径（`/tmp/quay-init-matrix-gen` 字面来自哪里），改成**走系统临时目录解析**（`os.tmpdir()` / `fs.mkdtempSync(path.join(os.tmpdir(), …))`），使 `TMPDIR` 生效。
2. 本机 A/B：`TMPDIR=<磁盘目录>` 与 `TMPDIR=<tmpfs 目录>` 两侧各跑一次同一文件，确认三条用例都不再因 tmpfs 红（改动前后者必红）。
3. 负控：用一个**故意忽略 TMPDIR** 的临时改法（或改动前形态）确认「硬编码 ⇒ tmpfs 下红」这一因果仍在，避免把红因归错。

## AC

- [x] AC1: `plugin/test/init-upgrade-matrix.test.mjs` 里造 scratch 的路径不再含硬编码 `/tmp`（粘贴改动后的行），并说明它现在从哪里取临时根。
- [x] AC2: 本机同一命令的 A/B 读数：`TMPDIR=<磁盘目录> node --test plugin/test/init-upgrade-matrix.test.mjs` 退出码 0；`TMPDIR=<tmpfs 目录>`（如 `/dev/shm/qim-$$`）**同样**退出码 0（粘贴两侧 `ℹ tests/pass/fail` 原文）；改动前的同一 `TMPDIR=<tmpfs 目录>` 那次必须是红（粘贴原文）。
- [x] AC3: 负控：把临时改法回退成硬编码 `/tmp` 形态后，`TMPDIR=<tmpfs 目录>` 下三条 v0.14/0.15/0.16 用例**必须**复现「upgrade failed (2)」；恢复后绿。粘贴两侧读数。
- [x] AC4: 改动只落在该夹具（`git diff --name-only` 只有这一个文件），⛔ 不改 `quay init` 的 tmpfs 判定、不改 runner 配置。

## DoD

- 落地后 develop 上**下一轮真实 CI run** 中，`init-upgrade-matrix` 的三条 v0.14/0.15/0.16 用例不再是该 run 的失败项（粘贴 run id + 结论）。
- 本机全量套件的结论里不再出现本文件的红（粘贴读数）。
- ⛔ 不引入新的 CI 失败项（对照该 run 的失败清单）。

## Touches

- plugin/test/init-upgrade-matrix.test.mjs
- tasks/gap-init-upgrade-matrix-fixture-hardcodes-tmp.md



## Disposition

2026-10-15，worker 轮。实现提交 `ad1ad58a3`（分支 `task/gap-init-upgrade-matrix-fixture-hardcodes-tmp`）。
四步读数如下；DoD 三条都是**落地后**才存在的读数，本任务 DoD 又是散文条目（不带复选框），故无可勾之处。

### 根因：`/tmp/quay-init-matrix-gen` 字面来自哪里（Plan 第 1 步）

**不在测试代码里，在夹具字节里。** 三个 fixture 各自逐字带着它那个发布版「生成当天」的绝对布局
（README.md 的生成脚本 `BASE=/tmp/quay-init-matrix-gen`）：`loop.repo_root`、`loop.worktree_root`、
`providers.native.path` / `mcp_entry`、四个 `QUAY_NATIVE_*` 目录，全部挂在那一个 BASE 下。
runner 容器挂 `--tmpfs /tmp` ⇒ 这份字节交给当前 `quay init` 时 `loop.worktree_root` 就是内存 ⇒
按 2026-08-04 OOM 防御 fail-closed 拒绝。⇒ job 级 `TMPDIR` 罩不住它：那是**字面量**，与 TMPDIR 无关。

原 Plan 假设「夹具在**代码里**写死 `/tmp`」，实测不符（测试代码本来就用 `os.tmpdir()`）。
改法据此校准为：把夹具的**生成基址**换成测试自有的 scratch 根，**形状保留**
（绝对路径、`scratch-rel-<v>/../scratch-rel-<v>-worktrees` 的同级写法）。

### AC1 — 不再含硬编码 `/tmp` 的 scratch 路径

改动后的行（`plugin/test/init-upgrade-matrix.test.mjs`）：

- `L151  const SCRATCH_BASE = scratchBase();`
- `L187  const ws = fs.mkdtempSync(path.join(SCRATCH_BASE, "quay-init-matrix-"));`
- `L190  fs.writeFileSync(…, rebaseOntoScratch(injectUserEdits(raw), v, ws), "utf8");`
- `L145  for (const base of [os.tmpdir(), "/var/tmp"]) {`

**它现在从哪取临时根**，两个来源：

1. **scratch 基址** = `[os.tmpdir(), "/var/tmp"]` 里第一个**非 tmpfs** 的候选。`os.tmpdir()` 排第一，
   所以 `TMPDIR` 照常生效（CI job 级导出 `TMPDIR=${{ runner.temp }}`）；候选是 tmpfs 时跳过、退回
   `/var/tmp`（POSIX 持久临时目录，磁盘）——否则一个 tmpfs `TMPDIR` 会让本套件退化成「测宿主内存」。
   两处都不可用时返回 null，用例**显式 `t.skip()`**（NOT-EVALUATED ≠ 通过，硬规则 3b）。
2. **夹具的生成基址** 由 `fixtureGenerationBase()` 从 fixture **自己的 `loop.repo_root`** 读出
   （`path.dirname`），不在此文件里复制那份字面量；`rebaseOntoScratch()` 把该串整串换成 ws，
   并 `assert.notEqual` 断言「替换确实发生了」（读不懂 ⇒ 不静默通过）。

`grep -n "/tmp" plugin/test/init-upgrade-matrix.test.mjs` 的全部命中：
`L118/L120/L121/L125/L126/L141` = **注释**（记述生成布局与 runner 条件，不是路径；硬规则 2 按位置判定）；
`L145/L276` = `"/var/tmp"`（非 tmpfs 回退候选，**不是 `/tmp`**）。
⇒ 无任何**可执行行**再以 `/tmp` 作 scratch 路径。

暂存产物的**直读**（临时关掉 `after()` 清理跑一次，随后按 sha256 校验还原）：
`repo_root: /tmp/qim-live/quay-init-matrix-XFvXr9/scratch-rel-v0.14.0`、
`worktree_root: …/scratch-rel-v0.14.0/../scratch-rel-v0.14.0-worktrees`
—— 基址已落在测试自有的 scratch 上，夹具的形状原样保留。

### AC2 — A/B 矩阵

runner 条件用 **runner 自己的镜像** `quay-ci-runner:sysd` + `--tmpfs /tmp` 复现
（生产容器 `gh-runner-quay` 实测 `HostConfig.Tmpfs = {"/run":"","/tmp":""}`），
宿主 node v24 跑，命令与宿主同一条：`node --test plugin/test/init-upgrade-matrix.test.mjs`。

| 环境 | TMPDIR | 改动前（`develop` 字节） | 改动后 |
|---|---|---|---|
| 本机（`stat -f -c %T /tmp` = `ext2/ext3`） | 磁盘目录 | `pass 8 / fail 0` | `pass 8 / fail 0` |
| 本机 | tmpfs `/dev/shm/qim-final` | `pass 8 / fail 0` | `pass 8 / fail 0` |
| runner 形（`--tmpfs /tmp`） | 磁盘 `/var/tmp/qim-disk2` | `pass 5 / fail 3` | `pass 8 / fail 0` |
| runner 形（`--tmpfs /tmp`） | tmpfs `/dev/shm/qim-pre` | `pass 5 / fail 3` | `pass 8 / fail 0` |

改动后两侧原文（本机）：`ℹ tests 8` / `ℹ pass 8` / `ℹ fail 0`（磁盘 TMPDIR 那一侧同形，退出码 0）。

改动前 runner 形 + `TMPDIR=/dev/shm/qim-pre` 的原文（三条逐字）：

```
✖ v0.14.0: current init upgrades to a VALID, comment-preserving, idempotent config
  AssertionError [ERR_ASSERTION]: v0.14.0: `quay init` upgrade failed (2)
  quay init: worktree root '/tmp/quay-init-matrix-gen/scratch-rel-v0.14.0/../scratch-rel-v0.14.0-worktrees' is on tmpfs ('/tmp' is tmpfs) — this is memory, not disk.
✖ v0.15.0: current init upgrades to a VALID, comment-preserving, idempotent config
  AssertionError [ERR_ASSERTION]: v0.15.0: `quay init` upgrade failed (2)
  quay init: worktree root '/tmp/quay-init-matrix-gen/scratch-rel-v0.15.0/../scratch-rel-v0.15.0-worktrees' is on tmpfs ('/tmp' is tmpfs) — this is memory, not disk.
✖ v0.16.0: current init upgrades to a VALID, comment-preserving, idempotent config
  AssertionError [ERR_ASSERTION]: v0.16.0: `quay init` upgrade failed (2)
  quay init: worktree root '/tmp/quay-init-matrix-gen/scratch-rel-v0.16.0/../scratch-rel-v0.16.0-worktrees' is on tmpfs ('/tmp' is tmpfs) — this is memory, not disk.
ℹ tests 8 / ℹ pass 5 / ℹ fail 3
```

⇒ 与 run 38700638546 的失败项**逐字同形**（含 `upgrade failed (2)` 与那句 tmpfs 文案）。

⚠️ **读数边界（必须说清，否则归因会错）**：本机 `/tmp` 是 `ext2/ext3`（`stat -f -c %T /tmp`），
且改动前代码**完全不读 `TMPDIR`**（夹具里是字面量）⇒ 单纯在本机把 `TMPDIR` 设成 tmpfs 目录，
改动前那次**仍是绿**（上表第 2 行，实测 `pass 8 / fail 0`）。
「改动前必须红」只在**夹具那条路径真的落在 tmpfs 上**时成立 —— 即 runner 的条件。
宿主 `unshare` 建 tmpfs 挂载在本机被拒（`Operation not permitted`），故用容器复现该条件，
而不是声称「本机 /tmp 是 tmpfs」。

### AC3 — 负控

把临时改法回退成**硬编码 `/tmp` 形态**（`sed`：`const SCRATCH_BASE = "/tmp";`，即改动前「写死 /tmp、
忽略环境」的形状），在 runner 形容器 + `TMPDIR=/dev/shm/qim-neg` 下：

```
✖ v0.14.0 … AssertionError [ERR_ASSERTION]: v0.14.0: `quay init` upgrade failed (2)
  quay init: worktree root '/tmp/quay-init-matrix-mpG77E/scratch-rel-v0.14.0/../scratch-rel-v0.14.0-worktrees' is on tmpfs ('/tmp/quay-init-matrix-mpG77E' is tmpfs) — this is memory, not disk.
✖ v0.15.0 / ✖ v0.16.0 同形
ℹ tests 8 / ℹ pass 5 / ℹ fail 3
```

恢复（`cp` 备份还原，`sha256sum -c` = `OK`）后：本机两侧 `pass 8 / fail 0`，
runner 形容器两侧 `pass 8 / fail 0`。
⇒ 「硬编码 ⇒ tmpfs 下红 / 走 scratch 根 ⇒ 绿」这一因果仍在，红因没有归错。

**附带一读（把归因钉死）**：同一负控在**本机** + `TMPDIR=/dev/shm/qim-neg` 下 = `pass 8 / fail 0`
—— 因为本机 `/tmp` 是磁盘。⇒ 变量是「scratch 落在什么文件系统上」，**不是 `TMPDIR` 本身**。

### AC4 — 改动范围

`git diff --name-only`（对 develop）= 只有 `plugin/test/init-upgrade-matrix.test.mjs`。
未改 `quay init` 的 tmpfs 判定（`packages/` 零改动）、未改 runner 配置、
未改夹具字节（`plugin/test/fixtures/init-matrix/**` 零改动：`rebaseOntoScratch()` 只作用于内存中的暂存副本）。

### 落地后待外部读数（DoD）

DoD 三条（下一轮真实 CI run 的失败清单 / 本机全量套件读数 / 不引入新失败项）都只能在**落地之后**取得，
本轮无法产出。本任务的 `## DoD` 是**散文条目、不带复选框**（完成判据的 total 恰为 4 条 AC），
故无可勾之处，只在此声明其状态为「待外部」。

ADR-007 逐里程碑暗轴记录（本任务的声明）
该轴仍暗,理由: 本任务是测试夹具与运行器环境耦合的修复（改的是夹具如何取临时目录），不量架构面（依赖图 / 文档比 / 变异存活都没测），没有可解析的读数可贴。