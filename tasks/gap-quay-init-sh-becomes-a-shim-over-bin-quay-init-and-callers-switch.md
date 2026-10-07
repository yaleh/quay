---
id: gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch
title: quay-init.sh 退化为调用 bin/quay init 的垫片（≤40
  行），skill/README/release.yml/验证脚本改调 CLI，退役 laydown 闭包棘轮
status: ready
labels:
  - gap
  - priority:p2
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script
goal_ac: AC-332
---
## Proposal
GOAL-029「init 统一为单一 TS 引擎、终局无 .sh;并收窄发布集合」(人 2026-10-07 裁定)。已定决策:终局无 .sh,过渡期把 `quay-init.sh` 缩成调用 `bin/quay init` 的垫片(方向:脚本→CLI,不是 CLI→脚本);不再有 --reconcile/--force。判据权威定义:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-332 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`(退出 0 = 达成)。

现状(已读):调用方有 `plugin/skills/init/SKILL.md`(`bash "${CLAUDE_PLUGIN_ROOT}/scripts/quay-init.sh"`)、`README.md`(手动命令)、`.github/workflows/release.yml`(verify-plugin-channel 两处)、`plugin/scripts/verify-plugin-channel-assertions.ts`(升级演练的重跑 init,约 730 行)、`plugin/scripts/real-target-verify.sh`、`plugin/scripts/verify-deliver-coldstart.sh`、`test/cold-start-e2e.sh`、`test/cold-start-oneliner-e2e.sh`、`packages/quay/src/cli/help.ts` 的 `QUAY_INIT_REL`、`plugin/scripts/config-key-consumer-check.ts` 的 `WRITER_REL`(把脚本登记为配置键"写入者")、`quay-init-closure-assertion.ts`/`quay-init-closure-ratchet.ts`/`docs/analysis/quay-init-closure-ratchet.baseline.json`(laydown 闭包棘轮),另有大量测试 spawn 脚本。`bin/quay` 垫片已负责解析 node(处理 nvm 下 PATH 无 node)。

修法:`plugin/scripts/quay-init.sh` 缩成 ≤40 行垫片,`exec "<插件根>/bin/quay" init "$@"`,并把旧参数映射到新参数面(`--all`/`--loop` 忽略并打印弃用提示,`--plugin-root` 等照传;被删除的 `--force` 给明确报错);skill、README、release.yml、`verify-plugin-channel-assertions.ts`、`real-target-verify.sh`、`test/cold-start*.sh` 逐个改调 `bin/quay init`(注意 skill 所在上下文里插件根来自 `${CLAUDE_PLUGIN_ROOT}`,以及发布门禁里 scratch 项目的 `--test-command` 显式传入);`config-key-consumer-check` 的写入者面改指 `packages/quay/src/init.ts`;`cli/help.ts` 的 `QUAY_INIT_REL` 随之更新或删除;确认没有调用方后退役 laydown 闭包棘轮(`quay-init-closure-ratchet.ts`、`quay-init-closure-assertion.ts`、其基线 json 与 pre-commit 守卫④的接线,同时更新 capability-catalog 声明与 `sh-census` 例外清单);垫片保留一个发布周期后再删(删除不在本任务内)。

## AC
- [ ] AC-332 的判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-332 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`。
- [ ] 取假:把垫片扩回 >40 行、或让 SKILL.md 再次出现 quay-init.sh 后,判据对应分支变红(附实跑输出)。
- [ ] 契约保持:通过垫片运行的既有 `plugin/test/quay-init*.test.mjs` 用例(经 `bash plugin/scripts/quay-init.sh …`)全部仍通过,且 `quay-init.sh --all --loop` 打印弃用提示但行为等价于 `bin/quay init`。
- [ ] 全仓检索:`grep -rn "quay-init\.sh" plugin packages/quay/src .github README.md test --include=*.md --include=*.ts --include=*.mjs --include=*.sh --include=*.yml` 排除测试夹具/历史归档/垫片自身后,每一处命中在完成记录里逐条说明(已切换/有意保留及理由),不得有未说明的调用方。
- [ ] 棘轮退役:`quay-init-closure-ratchet`/`quay-init-closure-assertion` 的所有接线(pre-commit 守卫④、runner-static-gate、capability-catalog、CI)清理干净,`node --no-warnings --experimental-strip-types plugin/scripts/capability-catalog.ts` 或其 `.sh` 入口无报错;`bash scripts/test.sh --for-task gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:发布门禁 `release.yml` 的 `verify-plugin-channel` 在不再出现 quay-init.sh 的新写法下,用发布形态产物本地演练(`--scope user` 与 `--scope project` 各一次)全部断言通过,升级演练 `--upgrade-from <v0.16.0 重建产物>` 通过;原始输出贴进完成记录(不触发真实 release.yml,不在真实 ~/.claude 上操作)。仅 fixture 绿不算完成。

## Touches
- `plugin/scripts/quay-init.sh`
- `plugin/skills/init/SKILL.md`
- `README.md`
- `.github/workflows/release.yml`
- `plugin/scripts/verify-plugin-channel-assertions.ts`
- `plugin/scripts/real-target-verify.sh`
- `test/cold-start-e2e.sh`
- `test/cold-start-oneliner-e2e.sh`
- `packages/quay/src/cli/help.ts`
- `plugin/scripts/config-key-consumer-check.ts`
- `plugin/scripts/quay-init-closure-assertion.ts`
- `plugin/scripts/quay-init-closure-ratchet.ts`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/sh-census-baseline.json`
- `plugin/test/quay-init.test.mjs`
- `plugin/test/verify-plugin-channel-assertions.test.mjs`
- `plugin/test/quay-init-closure-ratchet.test.mjs`
- `tasks/gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch.md`
