---
id: gap-ac261-plugin-bin-shim-missing-so-cli-needs-npm-global
title: plugin/bin/quay shim 缺席——plugin 形态下 CLI 只能靠 npm 全局安装，而 PATH 里那个目录本来就在
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-261
---
**type:** execution

## Proposal

**机制（官方）**：plugin 根目录下的 `bin/` 会自动加入 Bash tool 的 PATH。`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md:41` 与 `:307` 自己的 T4 实测已记录「PATH 中已存在 `<plugin-root>/bin`（**该目录尚不存在也照样在**）⇒ 建目录即可让 CLI 免 npm 全局安装」。本会话复核确认：PATH 含 `/home/yale/work/quay/plugin/bin`，而该目录**不存在**（Read 该路径报 File does not exist）。

**现状对照（文档与 SPEC 互相矛盾）**：`README.md:80` / `:137` 把 `quay` 二进制**保留给 npm 路径**（原文称那是 "the only supported way to install for the CLI alone"），Option C（`:183-200`）只承诺 MCP + skills、不承诺 CLI；而 `SPEC:139` 把 marketplace 声明为**主发布渠道**。⇒ 主渠道被文档声明为不提供 CLI，**而实测证明 plugin 形态下 CLI 其实可达**：`node <plugin-root>/vendor/quay/dist/quay.js <verb>` 已验证跑通 `--help` / `config validate` / `task list` / `task create` / `driver status --json`。

**⇒ 缺的不是能力，是一个 shim 文件 + 一处文档更正。**

**要做的**：建 `plugin/bin/quay`（可执行，mode 100755），转调 `<plugin-root>/vendor/quay/dist/quay.js`；确认它随 `dist-plugin` 孤儿分支与 npm tarball **两条渠道**都交付且保持可执行位；并修正 README 那处与 SPEC 矛盾的表述。

**实现时必须核的两件事（都是前提，不是结论）**：① `plugin/scripts/publish-dist-branch.sh` 的 rsync 是否保留 mode 位；② `packages/quay/package.json` 的 `files` 已含 `plugin`，故 tarball 侧**应当**自动覆盖 —— 但这是待实测确认的前提。若确需改这两个文件，**先更新 `## Touches` 再改**。

**查重（按机制）**：`gap-ac161-user-level-marketplace-only`（done）动的是 `enabledPlugins` 的 user/project scope 迁移，与「plugin 形态下有没有 CLI 可执行入口」无关；全店 `plugin/bin` 命中仅该一条。本条无既存承接任务。

## Contract

measure npm_free_cli_reachable = `env -u QUAY_PLUGIN_ROOT bash -lc 'command -v quay; quay --help'` 在只装 plugin（无 npm 全局）的 project scope 下的 exit_code 与 resolved_path 两个读数
band n/a: 布尔可达性判据（可达/不可达 + 落点路径），无数值区间
invariant shim_executable_bit_preserved = 两条渠道交付后 plugin/bin/quay 的 mode 都是可执行（孤儿分支 100755 / tarball 解包后 755）
invoke `bash plugin/scripts/publish-dist-branch.sh`
control 临时去掉 shim 的可执行位（chmod 644）⇒ 新测试必须红；恢复可执行位 ⇒ 绿
resume 重跑 publish-dist-branch.sh 与 `bash packages/quay/scripts/package.sh` 后重新读两条渠道里该文件的 mode 位

## Acceptance Criteria

- [x] AC1：`plugin/bin/quay` 存在、可执行，转调 `<plugin-root>/vendor/quay/dist/quay.js`；从一个**不装 npm 全局 quay** 的 shell 起，`quay --help` / `quay config validate` / `quay task list` 三个动词 exit 0，且 `command -v quay` 指向 plugin 目录下的这个 shim（真实进程读数，非 fixture）。
- [x] AC2：两条渠道都交付且保住可执行位——`dist-plugin` 孤儿分支上 `git ls-tree` 给出的 mode 为 100755；npm tarball（真 `npm pack` 产物）解包后同一文件可执行。**⛔ 逐条渠道实测，不得只验一条就推断另一条**（`packages/quay/package.json` 的 `files` 含 `plugin` 是前提不是结论）。
- [x] AC3：`plugin/scripts/publish-dist-branch.sh` 的 rsync 是否保留 mode 位——实测读数写进 `## Evidence`；若不保留，修到保留为止并把改动补进 `## Touches`。
- [x] AC4：`README.md` 与 SPEC 矛盾的表述已修正：`:80` / `:137` 不再把 `quay` 二进制声明为 npm 独占，Option C（`:183-200`）覆盖 CLI——按位置核对 README 这三处的实际文本。
- [x] AC5：负控制——`chmod 644 plugin/bin/quay` 后 `plugin/test/plugin-bin-shim-npm-free-cli.test.mjs` 必须红，恢复后必须绿（红绿两面都实测）。

## Definition of Done

- [x] AC1–AC5 全勾；AC1/AC2 的读数来自真实安装形态（孤儿分支 + `npm pack` 产物），不是开发检出里的直接调用（inherited-core 的标准 DoD：REAL LANDING 是门槛）。
- [x] 实现落地后重跑 `bash plugin/scripts/publish-dist-branch.sh`，让 AC-261 读到的是新交付面而不是旧的。
- [x] scoped 门 `bash scripts/test.sh --for-task gap-ac261-plugin-bin-shim-missing-so-cli-needs-npm-global` 绿；全量由 fan-in 机械跑。

## Dispatch review

reviewer: human
at: 2026-09-15
changed: 无（按人给定的机制事实、现状对照与 Touches 原样落盘）

## Touches

- plugin/bin/quay (new)
- plugin/test/plugin-bin-shim-npm-free-cli.test.mjs (new)
- plugin/scripts/publish-dist-branch.sh
- plugin/sync.sh
- README.md
- tasks/gap-ac261-plugin-bin-shim-missing-so-cli-needs-npm-global.md

## Evidence

**AC1 — npm-free CLI reachability（真实进程读数，2026-09-15）**

探针 = `env -u QUAY_PLUGIN_ROOT` + PATH 第一项为 `plugin/bin` 且**剔除每一个自身含可执行 `quay` 的目录**；cwd = 只含 `.quay/config.yml` + `tasks/` 的临时 workspace（裸 tasks 目录不是合法 workspace，见 README）。

```
command -v quay        -> <worktree>/plugin/bin/quay
quay --help            => rc=0
quay config validate   => rc=0  ("Config valid.")
quay task list         => rc=0  ("No tasks found.")
CONTROL（同一 PATH 去掉 shim 目录）：command -v quay -> 空，rc=1（其余 18 个 PATH 目录）
```
⇒ 因「自身含可执行 quay」被剔除的 PATH 目录数 = **0**：本机根本没有 npm 全局 quay，所以这不是「shim 赢过了全局安装」，而是「全局安装不存在」。

**AC2 — 两条渠道各自实测，互不推断**

(a) **dist-plugin 孤儿分支** —— 真跑 `bash plugin/scripts/publish-dist-branch.sh`（不带 `--push`，未向任何 remote 推送）：
```
[publish-dist-branch] orphan commit ready: d98e7728c550ce2fbc6ebcd5548693ee76d2d5d1
$ git ls-tree d98e7728 bin/quay
100755 blob 717ebabbb65155d9f17d01fac2bd3bbd62f6e511	bin/quay
```
blob sha `717ebabbb…` 与源文件 `git ls-files -s plugin/bin/quay` 的 blob sha **逐字相同** ⇒ 交付内容字节一致，且 mode 存活。该分支上 plugin 根 = 分支根，故路径是 `bin/quay` 而非 `plugin/bin/quay`。

⚠️ 脚本自己的收尾话术（"built+committed locally only"）夸大了留下的东西：EXIT trap 里的 `git worktree remove --force` 同时把本地 `dist-plugin` ref 也带走了，所以不带 `--push` 跑完之后，除了上面那个「按 sha 可达」的孤儿提交之外，**不存在叫 `dist-plugin` 的引用**。既有现象、与本条无关（`--push` 路径在 trap 之前就推完了）。**记录，不在本条修。**

(b) **npm tarball** —— 真跑 `bash packages/quay/scripts/package.sh`，产物 `packages/quay/quay-0.7.0.tgz`（495 files）：
```
$ npm pack --dry-run --json   -> plugin/bin/quay  size=2480  mode=493 (0o755)
$ tar -tvzf quay-0.7.0.tgz | grep plugin/bin/quay
-rwxr-xr-x 0/0  2480 … package/plugin/bin/quay
解包后 mode = 755
```
且**解包出来的 shim 端到端能跑**：
```
<tarball>/package/plugin/bin/quay --help            => rc=0
<tarball>/package/plugin/bin/quay config validate   => rc=0  ("Config valid.")
<tarball>/package/plugin/bin/quay task list         => rc=0
```

**AC3 — publish-dist-branch.sh 的 rsync 是否保留 mode 位：保留。** 机制是 `rsync -a --exclude='.git'`（`-a` 含 `-p`），但读数取自 AC2(a) 的 `100755`——**穿过真实发布流程量出来的，不是读旗标推断的**。rsync 本身无需改动。

**AC4 — README 按位置核对**：`:80` 原文「This installs the `quay` binary on your PATH.」→ 补明「**one of two ways to get one**, not the only one」并指向 Option C；`:137` 原文「This is the **only** supported way to install for the CLI alone.」→ 改为「installs the CLI **without** registering the plugin … not the only way to get a `quay` binary」；Option C 段（原 `:190-194`）后新增一段，写明 Claude Code 把每个启用插件的 `bin/` 加进 Bash tool PATH、插件在那里交付 `plugin/bin/quay`、它转调自带 bundle，故 `quay --help` / `quay config validate` / `quay task list` 免 npm 可用；末尾「Pick one」段补一句：两条路都给 `quay` 二进制（A 走 npm 全局 bin，C 走插件自己的 `bin/quay`）。同类「CLI 只能靠 npm」的表述在 README 之外**全店扫过**，无第二处（`experiments/quay-continuous-bootstrap/**` 的命中是已退役经典循环的历史档案，不在交付面）。

**AC5 — 负控制，红绿两面都实测**（`node --test plugin/test/plugin-bin-shim-npm-free-cli.test.mjs`）：
```
chmod 644 plugin/bin/quay -> fail 3 / pass 2   （结构面、AC1 三动词、AC2(b) 全红）
chmod 755 plugin/bin/quay -> fail 0 / pass 5   （全绿）
```
另有套件内同轴红绿对（shim 字节复制到临时插件根，644 vs 755）：`644 -> rc=126 "Permission denied"`、`755 -> rc=0`。
⚠️ 这里纠正了一个差点让负控制空转的写法：**`command -v quay` 对 mode 644 的文件照样返回路径且 rc=0**（实测），所以「存在性探针」在红绿两半都会绿、什么都证明不了；判据必须**执行**它。

**scoped 门（DoD 第 3 条）**：`bash scripts/test.sh --for-task gap-ac261-plugin-bin-shim-missing-so-cli-needs-npm-global --allow-thin` ⇒ **rc=0，`✖` 计数 0**；scoped 静态层全部 PASS（含 test-isolation / tmp-leak-pairing / test-file-snapshot / checked-in-write / landing-target / suite-slot-SSoT / quay-init-closure-ratchet 等），测试层本文件 5/5 通过。选择面被标 thin（6 条 Touches 只有 1 条解出对应测试——Touches 里本就只有测试文件自身带测试），`--allow-thin` 正是为此传入；全量由 fan-in 机械跑。scoped-gate cache 已按 develop sha 写入。

**途中发现并当场修掉的两处（都会静默丢掉 shim）**

1. `plugin/scripts/publish-dist-branch.sh` 在**装了本仓 pre-commit 钩子**的机器上根本跑不起来：钩子做 `git rev-parse --show-toplevel` 后执行 `$ROOT/plugin/scripts/precommit-guard.ts`，而该文件正是这个脚本自己的「删掉 raw `.ts`」步骤刚从孤儿工作树里删掉的 ⇒ commit 步 `MODULE_NOT_FOUND`。修复前实测 `rc=1` 与上述报错；加 `--no-verify` + 说明（源树提交策略对一个生成型孤儿产物提交没有主体：该分支上根本没有 `tasks/`，其唯一消费者是 Claude Code 的插件安装器）后 `rc=0`。CI 从未见过它——钩子不随 clone 走。既有缺陷，成因与本条无关，但它挡住了 DoD 里的那一步。
2. `plugin/sync.sh --install-user-scope` 的 **tar 不可用 fallback** 逐目录列举要拷贝的插件子树，原列举为 `skills scripts workflows agents vendor probes loop` —— **不含 `bin`** ⇒ 该路径会装出一个 CLI 入口直接消失的插件。已补 `bin`。

**未测的残余（如实记，⛔ 不与"已验证"混同）**：Claude Code 把 marketplace 插件目录复制进自己的 cache 那一步是否保留 mode 位，本条**没有实测**——那需要一次真的 `/plugin install`（会改写用户插件 cache，且要网络），超出本 worker 的范围。已测的两条渠道覆盖的是**交付物本身**（git 孤儿分支：git 存 100755；npm tarball：0o755 且解包后可执行）；cache 复制是 Claude Code 自身行为，不在本仓的交付面内。
