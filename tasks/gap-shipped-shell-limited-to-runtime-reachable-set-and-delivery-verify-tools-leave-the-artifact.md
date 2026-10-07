---
id: gap-shipped-shell-limited-to-runtime-reachable-set-and-delivery-verify-tools-leave-the-artifact
title: 发布产物里的 .sh 只保留运行时可达的集合——按"实际被执行"的引用闭包派生，交付/验证工具（已取消的 tgz 渠道）出局
status: todo
labels:
  - gap
  - priority:p2
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-shipped-plugin-tree-excludes-dev-only-content-and-has-a-shrink-only-size-ratchet
goal_ac: AC-335
---
## Proposal
GOAL-029「init 统一为单一 TS 引擎、终局无 .sh;并收窄发布集合」(人 2026-10-07 裁定)。起因:2026-10-07 发布前演练发现发布产物 184 个 .sh/36910 行,验证/交付工具被当作产品发出;根因是 `plugin/scripts/publish-dist-branch.sh` 的 rsync 默认全发。判据权威定义:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-335 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`(退出 0 = 达成)。

现状(已读,0.17.0 产物):184 个 `.sh`/36910 行;去掉 `checker-mutation-cases` 后 91 个/28723 行,其中发布/交付/验证工具(`verify-deliver-coldstart.sh` 9111 行、`develop-deliver-tgz.sh` 3078 行、`deliver-verify-usage.sh`、`cross-machine-verify.sh`、`real-target-verify.sh`、`sync-vendor.sh`、`publish-dist-branch.sh`、`release-branch-finish.sh`、`sync.sh`,按文件名判断)共 9 个/14128 行,服务于已被人 2026-09-16 取消的 npm/tgz 渠道或发布构建本身;≥300 行的大文件 18 个/20465 行;≤60 行的薄封装 28 个/1004 行;36 个 shell 调用 node 跑 .ts/.js。对"可达"做过一次文本引用闭包(从 skills/workflows/loop/bin/agents 出发,54 个 .sh/24776 行),但它会高估(散文提到脚本名也算)。

修法:派生"运行时实际会被执行"的 shell 集合,其余不随产物发出。根必须包括:`bin/quay`、`.mcp.json`、skills 的围栏命令、workflow 发出的命令、`scripts/dist` 入口、Core 里 `resolvePluginScript*`/`resolveKernelShellSibling` 的字面量、以及 `plugin/scripts/capability-catalog-declarations.json` 声明的 instrument(`quay instrument` 暴露的那批检查器是产品功能,不能凭"以 -check.sh 结尾"就删,必须把 catalog 声明当根)。不维护文件名清单——集合由闭包派生,例外要写原因。判定为出局的工具仍留在仓库(开发用),只是不进产物;`verify-deliver-coldstart.sh`、`develop-deliver-tgz.sh` 直接判定出局(渠道已取消)。排除规则接入前置任务(发布产物结构性排除与体量棘轮)建立的排除机制与体量棘轮,并在 `shipped-set.test.mjs` 的基线里反映新的下降。

## AC
- [ ] AC-335 的判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-335 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`。
- [ ] `plugin/test/shipped-shell-reachability.test.mjs` 在 55 秒内通过:从上述根集合派生可达 shell 集合,断言产物里每个 `.sh` 都在其中,且 `verify-deliver-coldstart.sh`、`develop-deliver-tgz.sh` 不在产物中。取假:往产物塞一个无人引用的 `orphan-tool.sh` 后红;把 capability-catalog 声明的某个 instrument 的 `.sh` 排除后红(证明 catalog 根有效);恢复 `verify-deliver-coldstart.sh` 后红(附实跑输出)。
- [ ] 完成记录里贴出改前改后读数:产物 `.sh` 文件数与行数(改前 184/36910;前置任务之后的读数;本任务之后的读数),以及被判出局的每个 `.sh` 及其原因(无引用/渠道已取消);并列出"文本提到但不被执行"的例子,证明闭包按执行引用而不是按散文提及派生。
- [ ] 无活消费者被排除:用新构建重跑整套演练(init 全新与升级、driver、serve、`quay instrument` 列表与至少三个 instrument 的实跑、cold-start 门禁),原始读数贴进完成记录;`bash scripts/test.sh --for-task gap-shipped-shell-limited-to-runtime-reachable-set-and-delivery-verify-tools-leave-the-artifact` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:新的发布形态产物里 `.sh` 只剩运行时可达集合,体量棘轮基线随之下调并入库;`verify-plugin-channel-assertions` 在 project 与 user 两种 scope 下全部 PASS;改前改后读数贴进完成记录(不触发真实 release.yml,不在真实 ~/.claude 上操作)。仅 fixture 绿不算完成。

## Touches
- `plugin/scripts/publish-dist-branch.sh`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/scripts/verify-plugin-channel-assertions.ts`
- `plugin/test/shipped-shell-reachability.test.mjs`
- `plugin/test/shipped-set.test.mjs`
- `plugin/sh-census-baseline.json`
- `tasks/gap-shipped-shell-limited-to-runtime-reachable-set-and-delivery-verify-tools-leave-the-artifact.md`
