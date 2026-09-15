---
id: gap-ac261-plugin-bin-shim-missing-so-cli-needs-npm-global
title: plugin/bin/quay shim 缺席——plugin 形态下 CLI 只能靠 npm 全局安装，而 PATH 里那个目录本来就在
status: todo
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

- [ ] AC1：`plugin/bin/quay` 存在、可执行，转调 `<plugin-root>/vendor/quay/dist/quay.js`；从一个**不装 npm 全局 quay** 的 shell 起，`quay --help` / `quay config validate` / `quay task list` 三个动词 exit 0，且 `command -v quay` 指向 plugin 目录下的这个 shim（真实进程读数，非 fixture）。
- [ ] AC2：两条渠道都交付且保住可执行位——`dist-plugin` 孤儿分支上 `git ls-tree` 给出的 mode 为 100755；npm tarball（真 `npm pack` 产物）解包后同一文件可执行。**⛔ 逐条渠道实测，不得只验一条就推断另一条**（`packages/quay/package.json` 的 `files` 含 `plugin` 是前提不是结论）。
- [ ] AC3：`plugin/scripts/publish-dist-branch.sh` 的 rsync 是否保留 mode 位——实测读数写进 `## Evidence`；若不保留，修到保留为止并把改动补进 `## Touches`。
- [ ] AC4：`README.md` 与 SPEC 矛盾的表述已修正：`:80` / `:137` 不再把 `quay` 二进制声明为 npm 独占，Option C（`:183-200`）覆盖 CLI——按位置核对 README 这三处的实际文本。
- [ ] AC5：负控制——`chmod 644 plugin/bin/quay` 后 `plugin/test/plugin-bin-shim-npm-free-cli.test.mjs` 必须红，恢复后必须绿（红绿两面都实测）。

## Definition of Done

- [ ] AC1–AC5 全勾；AC1/AC2 的读数来自真实安装形态（孤儿分支 + `npm pack` 产物），不是开发检出里的直接调用（inherited-core 的标准 DoD：REAL LANDING 是门槛）。
- [ ] 实现落地后重跑 `bash plugin/scripts/publish-dist-branch.sh`，让 AC-261 读到的是新交付面而不是旧的。
- [ ] scoped 门 `bash scripts/test.sh --for-task gap-ac261-plugin-bin-shim-missing-so-cli-needs-npm-global` 绿；全量由 fan-in 机械跑。

## Dispatch review

reviewer: human
at: 2026-09-15
changed: 无（按人给定的机制事实、现状对照与 Touches 原样落盘）

## Touches

- plugin/bin/quay (new)
- plugin/test/plugin-bin-shim-npm-free-cli.test.mjs (new)
- README.md
- tasks/gap-ac261-plugin-bin-shim-missing-so-cli-needs-npm-global.md
