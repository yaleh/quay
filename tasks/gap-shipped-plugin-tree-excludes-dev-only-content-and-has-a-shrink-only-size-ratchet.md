---
id: gap-shipped-plugin-tree-excludes-dev-only-content-and-has-a-shrink-only-size-ratchet
title: 发布产物默认全发 plugin/ 导致 641 个测试文件、93 个突变用例与开发期基线随产物发出——改为结构性排除，并加只减不增的体量棘轮与门禁断言
status: todo
labels:
  - gap
  - defect
  - priority:p1
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-334
---
## Proposal
GOAL-029「init 统一为单一 TS 引擎、终局无 .sh;并收窄发布集合」(人 2026-10-07 裁定)。起因:2026-10-07 发布前演练发现发布产物 66 MB/1062 个文件,其中 184 个 .sh/36910 行、641 个测试文件(11.7 MB)、93 个 checker-mutation-cases,验证/交付工具被当作产品发出。判据权威定义:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-334 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`(退出 0 = 达成)。

根因(已读):`plugin/scripts/publish-dist-branch.sh` 第 114 行 `rsync -a --exclude='.git' "${PLUGIN_DIR}/" "${WORK}/"` 把整个 plugin/ 默认全发,唯一的减法是第 137 行删除原始 `.ts`(保留 `runner-static-gate.ts`)。实测(0.17.0 发布形态产物):66 MB、1062 个文件;`test/` 11.7 MB/641 个文件(564 个 `*.test.*`);`scripts/checker-mutation-cases/` 93 个文件;`fixtures/`、`test/fixtures/`;`sh-census-baseline.json`、`sh-census-exceptions.txt`、`test-isolation-violations.txt`、`touches-post-content-violators.txt`、`test-framework-policy-exemptions.txt`、`import-graph-baseline.json`、`freshness-producers.json` 等开发期数据;已 grep Core 源码(`packages/quay/src`)未发现运行时读取这些基线/违规清单的地方,skills/workflows/loop 文档里出现的 `plugin/test/` 字样判断是开发树路径说明,但未逐处核对。

修法:把 rsync 改为带排除,排除规则按目录/模式划定(不维护文件名清单):`test/`、`fixtures/`、`scripts/checker-mutation-cases/`、基线/例外/违规清单类数据(按文件名模式)等,放在一处可检查的排除规则里(实现者选择形式,例如被 publish-dist-branch.sh 读取的一个检查入库的模式文件,并被测试读取而不是复制一份);新增只减不增的棘轮:对产物的文件数、字节数、`.sh` 行数设基线(检查入库),增长即红(仿 `plugin/scripts/sh-census-check.ts` 的做法与 reanchor 流程);在发布门禁断言脚本 `plugin/scripts/verify-plugin-channel-assertions.ts` 加一条断言 `shipped-set-clean`(产物里无 `*.test.*`、无 test/ 与 fixtures/、无 checker-mutation-cases),并在 `release.yml` 沿用已有调用点。必须验证没有活消费者被排除:收窄后用新构建重跑整套演练(init、driver start/status、serve、`quay instrument` 列表、cold-start 门禁、`laydown-set-check`),并确认现有"dist 引用闭包"门禁(只覆盖 dist bundle)之外没有新的 ERR_MODULE_NOT_FOUND/ENOENT。

## AC
- [ ] AC-334 的判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-334 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`。
- [ ] `plugin/test/shipped-set.test.mjs` 在 55 秒内通过:它在一次性 clone 或临时目录里构建发布形态产物(不得在主检出里创建分支/worktree,不得 push,不得联网安装依赖——复用现有 node_modules 或 `--offline`),断言产物无 `*.test.*`、无 `test/`、`fixtures/`、`checker-mutation-cases`、无基线/例外/违规清单,并断言文件数/字节数/`.sh` 行数 ≤ 入库基线。取假:恢复 `rsync` 全量后该测试红;往产物目录塞一个 `foo.test.mjs` 后红(附实跑输出)。
- [ ] 棘轮可 reanchor:基线只减不增,增长时失败信息指明是哪个量(文件数/字节/.sh 行数)与超出多少,reanchor 命令写在失败信息里。
- [ ] 无活消费者被排除:完成记录里贴出对新构建产物逐项演练的原始读数——`quay init` 全新与升级、`quay driver start --kind promotion|worker`+`driver status`、`quay server start`+`server status`、`quay instrument` 列表、`verify-plugin-channel-assertions.ts` 全部 PASS、`laydown-set-check.sh` 对产物的结果(与改前对比)。
- [ ] 断言接线:`grep -n "shipped-set-clean" plugin/scripts/verify-plugin-channel-assertions.ts` 命中,`release.yml` 调用该脚本;`bash scripts/test.sh --for-task gap-shipped-plugin-tree-excludes-dev-only-content-and-has-a-shrink-only-size-ratchet` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:新的发布形态产物体量与文件数相对 0.17.0(66 MB/1062 个文件)显著下降(预期去掉约 11.7 MB、约 640 个测试文件、约 8 千行突变夹具 shell),`verify-plugin-channel-assertions` 在 project 与 user 两种 scope 下 11 条断言(含新增的 shipped-set-clean)全 PASS;改前改后读数贴进完成记录(不触发真实 release.yml,不在真实 ~/.claude 上操作)。仅 fixture 绿不算完成。

## Touches
- `plugin/scripts/publish-dist-branch.sh`
- `plugin/scripts/verify-plugin-channel-assertions.ts`
- `packages/quay/scripts/build-plugin-dist.mjs`
- `.github/workflows/release.yml`
- `plugin/test/shipped-set.test.mjs`
- `plugin/test/verify-plugin-channel-assertions.test.mjs`
- `plugin/sh-census-baseline.json`
- `tasks/gap-shipped-plugin-tree-excludes-dev-only-content-and-has-a-shrink-only-size-ratchet.md`
