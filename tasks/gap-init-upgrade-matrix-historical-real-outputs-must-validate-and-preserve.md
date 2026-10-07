---
id: gap-init-upgrade-matrix-historical-real-outputs-must-validate-and-preserve
title: 升级矩阵：最近发布版本的真实 init 输出经当前 init 后校验通过、用户自定义值与注释保留、幂等
status: done
labels:
  - gap
  - priority:p2
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-init-single-engine-state-based-upgrade-validate-before-write
goal_ac: AC-333
---
## Proposal
GOAL-029「init 统一为单一 TS 引擎、终局无 .sh;并收窄发布集合」(人 2026-10-07 裁定)。起因:发布门禁的升级演练只测"上一个版本"一个形状,且 2026-10-07 实测已发现一个形状(0.16.0 init 过的项目)升级后 validate 仍红;"升级总能得到匹配新版本的配置"只有靠多个历史形状才能钉住。判据权威定义:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-333 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`(退出 0 = 达成)。

做法:用历史发布 tag(至少 v0.14.0、v0.15.0、v0.16.0;若 v0.10/v0.11 的 init 能在当前机器重建则尽量纳入)真实运行该 tag 的 init 来生成夹具:对每个 tag,用 `plugin/scripts/publish-dist-branch.sh`(在一次性 clone 里,release 形态)构建插件树,在临时 HOME 下装并在 scratch 项目里跑该版本的 init,取出产生的 `.quay/config.yml` 放进 `plugin/test/fixtures/init-matrix/v<版本>/config.yml`,并写 `PROVENANCE`(tag、构建命令、init 命令、生成日期;不得手写或手改夹具内容)。新增测试 `plugin/test/init-upgrade-matrix.test.mjs`:对每个版本夹具,先注入一条用户注释、一个用户自定义的兼容值(例如 loop.test_command 改成自定义、serve.port)和一个未知顶层键,再用当前 `quay init` 升级,断言:校验通过(`quay config validate` 与 MCP `config_validate`)、注入的注释/自定义值/未知键保留、退役键(native path/mcp_entry)消失、二次运行字节不变。再提供一个生成夹具的复现脚本或 README 说明(放在夹具目录里),使新增版本夹具有固定做法。

## AC
- [x] AC-333 的判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-333 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`。
- [x] 取假:把当前 init 的升级退回只做四个项目值(不补版本级默认)后,矩阵测试对至少一个历史版本变红(附实跑输出);把某个夹具换成另一个版本的字节后"夹具互不相同"一段变红。
- [x] 夹具真实性:每个 `PROVENANCE` 记录的 tag 在 `git tag` 中存在;完成记录里贴出生成每个夹具时的命令与输出,证明夹具来自该 tag 的真实 init 运行而不是手写。
- [x] 测试耗时与隔离:`node --experimental-strip-types --test plugin/test/init-upgrade-matrix.test.mjs` 退出 0,不访问网络,不触碰真实 ~/.claude 与真实项目;`bash scripts/test.sh --for-task gap-init-upgrade-matrix-historical-real-outputs-must-validate-and-preserve` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:矩阵测试在发布形态产物构建(`bash plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify` 不 push)之后对全部历史夹具通过;并把"新增版本夹具的固定做法"写进 `plugin/test/fixtures/init-matrix/README.md`,下次发布按它加一个夹具。仅 fixture 绿不算完成。

## Touches
- `plugin/test/init-upgrade-matrix.test.mjs` (new)
- `plugin/test/fixtures/init-matrix/README.md` (new)
- `plugin/test/fixtures/init-matrix/v0.14.0/config.yml` (new)
- `plugin/test/fixtures/init-matrix/v0.14.0/PROVENANCE` (new)
- `plugin/test/fixtures/init-matrix/v0.15.0/config.yml` (new)
- `plugin/test/fixtures/init-matrix/v0.15.0/PROVENANCE` (new)
- `plugin/test/fixtures/init-matrix/v0.16.0/config.yml` (new)
- `plugin/test/fixtures/init-matrix/v0.16.0/PROVENANCE` (new)
- `tasks/gap-init-upgrade-matrix-historical-real-outputs-must-validate-and-preserve.md`

## Evidence

### AC-1 — AC-333 判据实跑
在 worktree 内实跑判据本体（criteria 文本由 `quay goal show AC-333 --json` 取出后交给 `bash`）：
`AC333_EXIT=0`（矩阵测试存在、`plugin/test/fixtures/init-matrix/` 下 3 个版本目录各含 config.yml+PROVENANCE、三个 config.yml 的 sha256 有 3 个不同值、测试全绿）。

### AC-3 — 夹具真实性（每个夹具 = 该 tag release 形态产物的真实 init 输出）
三个 tag 都在 `git tag` 中（`git tag | grep -E '^v0\.(14|15|16)\.0$'` 三条全命中）。
生成流程（每个 tag 相同；完整可复现步骤见 `plugin/test/fixtures/init-matrix/README.md`）：

1. `git worktree add --detach /tmp/quay-init-matrix-gen/src-<tag> <tag>`
2. `cd src-<tag> && bash plugin/scripts/publish-dist-branch.sh --branch dist-<tag>`（release 形态，**不 push**）
   → `[publish-dist-branch] orphan commit ready:` v0.14.0 `0f41925dcf4b7ade521d33431c254454d8c8b274`；
     v0.15.0 `db99dd85864f03a3b879979d7ba9d7fe03c6acfa`；v0.16.0 `33c37d85ed232cd44238be87f61bc7607f9ea349`
3. `git worktree add --detach /tmp/quay-init-matrix-gen/dist-<tag> dist-<tag>`（物化产物树）
4. 一次性 scratch git 仓库里跑 **该 tag 自己的** init：
   `bash dist-<tag>/scripts/quay-init.sh --root <scratch> --plugin-root dist-<tag> --test-command "npm test" --auto-commit-skip`
   → 三个 tag 均 `exit 0`，输出 `wrote: .quay/config.yml (…)`
5. 逐字节拷贝 `<scratch>/.quay/config.yml` → 夹具（未手写、未手改；sha256 记进 PROVENANCE）

| tag | config.yml sha256 | 该 tag 的形态特征 |
|---|---|---|
| v0.14.0 | `bddf5c80826b1da6fe59e50594e289be96587947f244624093336c7c23899533` | `providers.native.path = ${PLUGIN_ROOT}/vendor/quay-native`（插件根绝对路径绑定） |
| v0.15.0 | `67a9ada76c508a93eb1ade9bd426221dfebb5597e5e9fffaf8cb983e2919ab26` | `providers.native.path = <ws>/.quay/plugin/vendor/quay-native`（项目内 symlink 绑定） |
| v0.16.0 | `21ab8b18f35a9bdbeaddeb32a47d2d478b5096d2cca7a9796046f9e234fd999d` | 无 path/mcp_entry（Core 从 plugin root 解析；退役键已不存在） |

三个形状互不相同 → 夹具两两不同（AC-333 的 `sha256sum … | sort -u | wc -l ≥ 2` 满足）。
`config.yml` 里的绝对路径是上述 scratch 布局，**记录而非消毒**（夹具必须是真实输出）；重跑同样步骤得同样字节。

### AC-4 — 测试与隔离
`node --experimental-strip-types --test plugin/test/init-upgrade-matrix.test.mjs` → `pass 8 / fail 0`。
不访问网络：测试只 spawn 本地 Core CLI 与本地 MCP stdio server，workspace 一律 `mkdtemp` 于 `os.tmpdir()`；
`CLAUDE_PLUGIN_ROOT` 在子进程 env 中被显式删除（插件根从运行中的 Core 模块 `selfPluginRoot` 解析），
故不触碰真实 `~/.claude`，也不写任何真实项目。
`bash scripts/test.sh --for-task gap-init-upgrade-matrix-historical-real-outputs-must-validate-and-preserve` → `SCOPED_EXIT=0`，
执行了矩阵测试文件（输出含 8 个用例全绿）在内的 ≥1 个测试文件。

### AC-2 — 取假（两条都实跑过）
① **退回只做四个项目值（不补版本级默认）**：把 `packages/quay/src/init.ts` `upgradeConfigContent` 的
`LOOP_VERSION_DEFAULTS` 填充循环临时改为遍历空对象后重跑矩阵测试：
```
✖ v0.14.0 … (214ms)   AssertionError: v0.14.0: `quay init` upgrade failed (1)
    error: loop.board — Missing required field "board" (provider name, e.g. "native")
    error: loop.gates — Missing required field "gates" (gate name or list, e.g. ["acceptance"])
✖ v0.15.0 … (205ms)   （同上）
✖ v0.16.0 … (192ms)   （同上）
ℹ pass 5 / fail 3
```
三个历史版本全部变红（≥1 个即满足）。恢复后 `ℹ pass 8 / fail 0`；`git diff --stat packages/quay/src/init.ts` 为空。
② **把一个夹具换成另一个版本的字节**：`cp v0.15.0/config.yml v0.16.0/config.yml` 后重跑：
```
✖ fixtures: PROVENANCE config-sha256 matches the fixture bytes it describes
✖ fixtures are pair-wise distinct — 夹具互不相同 (a copy would masquerade as a second release)
ℹ pass 6 / fail 2
```
"夹具互不相同"一段变红（`PROVENANCE` 记录的 sha 校验同时变红）。恢复后 sha256 回到
`21ab8b18…999d`，测试回绿。

### DoD — 发布形态产物构建之后全绿
在 worktree 内：`bash plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify`（**不 push**）
→ `PUBLISH_EXIT=0`（`dist-closure gate OK (directory): 112 referenced dist bundles all present`、
`orphan commit ready: b681804b80f6f63dc28117f215b4dd92a4fd276c`）。
随后 `node --experimental-strip-types --test plugin/test/init-upgrade-matrix.test.mjs` → `pass 8 / fail 0`。
"新增版本夹具的固定做法"已写入 `plugin/test/fixtures/init-matrix/README.md`（含清理步骤与三条硬要求）。
