---
id: gap-init-upgrade-matrix-historical-real-outputs-must-validate-and-preserve
title: 升级矩阵：最近发布版本的真实 init 输出经当前 init 后校验通过、用户自定义值与注释保留、幂等
status: ready
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
- [ ] AC-333 的判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-333 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`。
- [ ] 取假:把当前 init 的升级退回只做四个项目值(不补版本级默认)后,矩阵测试对至少一个历史版本变红(附实跑输出);把某个夹具换成另一个版本的字节后"夹具互不相同"一段变红。
- [ ] 夹具真实性:每个 `PROVENANCE` 记录的 tag 在 `git tag` 中存在;完成记录里贴出生成每个夹具时的命令与输出,证明夹具来自该 tag 的真实 init 运行而不是手写。
- [ ] 测试耗时与隔离:`node --experimental-strip-types --test plugin/test/init-upgrade-matrix.test.mjs` 退出 0,不访问网络,不触碰真实 ~/.claude 与真实项目;`bash scripts/test.sh --for-task gap-init-upgrade-matrix-historical-real-outputs-must-validate-and-preserve` 退出 0 且执行了 ≥1 个测试文件。

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
