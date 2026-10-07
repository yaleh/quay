---
id: gap-init-surface-unified-no-reconcile-no-force-json-report-serve-defaults-unwritten
title: init 对外面统一：CLI 与 MCP 去掉 --reconcile/--force，init --json 给结构化报告，等于回退值的
  serve 默认值不写入配置
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
goal_ac: AC-330
---
## Proposal
GOAL-029「init 统一为单一 TS 引擎、终局无 .sh;并收窄发布集合」(人 2026-10-07 裁定)。起因:2026-10-07 发布前演练发现已有项目升级后 `quay config validate` 仍红,且 init 有两套对外面(脚本与 CLI/MCP)。已定决策:终局无 .sh;不再有 --reconcile/--force;状态自动决定;`serve:` 默认值(等于回退值)不写进配置。判据权威定义:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-330 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`(退出 0 = 达成)。

现状:`packages/quay/src/cli/init.ts` 有 `--force`/`--reconcile` 标志及 "already exists" 拒绝分支;`quay init --help`(由 `packages/quay/src/cli/help.ts` 提供)不展示 --reconcile 但标志存在;MCP `init` 工具带 `reconcile` 参数且默认 true;`SERVE_VERSION_DEFAULTS` 让 reconcile 往已有配置补 `serve.host: 0.0.0.0`/`serve.port: 0`,而全新脚本安装不写 `serve:` 段(两者不一致,实测 `quay init --reconcile --dry-run` 会报 `filled serve.host`);另有为脚本加的 `reconcileConfigContent(raw,{serve:false})` 开关。

修法:CLI 与 MCP 都不再有 --reconcile/--force(旧标志给明确的弃用报错或一版弃用别名,实现者选,但 help 与源码不得再把它们当模式宣传);`--all`/`--loop` 接受但忽略并打印弃用提示;`init --json` 在 stdout 输出一份可解析 JSON 报告(结果、补了哪些键、迁移了哪些、警告、校验是否通过、`.quay/plugin` 链接状态);MCP `init` 原样返回同一份报告;删除 `SERVE_VERSION_DEFAULTS`、reconcile 中的 serve 补写与 `{serve:false}` 开关,全新安装与升级都不写等于回退值的 serve 默认(`resolveServeBinding` 的回退字面量保持单一定义,不得引入第二处默认值);用户自己固定的 serve 值原样保留;同步更新 `plugin/skills/init/SKILL.md`、README 中对 --reconcile/--force 的描述。

## AC
- [ ] AC-330 的判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-330 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`。
- [ ] 取假:恢复 MCP init 的 reconcile 参数后判据变红;恢复 `SERVE_VERSION_DEFAULTS` 后"全新配置不含 serve: 段"一段变红(附实跑输出)。
- [ ] `grep -rn -- "--reconcile" packages/quay/src plugin/skills README.md` 排除历史说明(带"已移除"字样的变更记录)后命中数为 0(先打印改前基线与前 3 条命中,证明谓词能命中)。
- [ ] 测试:`init --json` 的字段契约、MCP init 无 reconcile 参数且返回同一报告、旧标志的弃用行为、用户固定的 serve.port/host 升级后原样保留、全新与升级都不写 serve 默认;`node --experimental-strip-types --test` 对应测试文件退出 0;`bash scripts/test.sh --for-task gap-init-surface-unified-no-reconcile-no-force-json-report-serve-defaults-unwritten` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:用发布形态产物(`bash plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify` 不 push → `git archive` → 临时 HOME 下安装)对一个已有 `serve:` 固定值的真实形态配置运行 `quay init`,serve 值原样保留且没有新增 host/port;`quay init --json` 的输出被一个独立消费者(例如 python json.load)解析成功,原始输出贴进完成记录。仅 fixture 绿不算完成。


- `packages/quay/src/cli/init.ts`
- `packages/quay/src/cli/help.ts`
- `packages/quay/src/init.ts`
- `packages/quay/src/mcp-server.ts`
- `packages/quay/src/branch-model.ts`
- `packages/quay/src/mcp-handlers.ts`
- `packages/quay-native/bin/quay-native.ts`
- `plugin/skills/init/SKILL.md`
- `plugin/scripts/config-key-consumer-check.ts`
- `plugin/test/config-key-consumer-check.test.mjs`
- `README.md`
- `packages/quay/test/init.test.mjs`
- `packages/quay/test/mcp-server.test.mjs`
- `tasks/gap-init-surface-unified-no-reconcile-no-force-json-report-serve-defaults-unwritten.md`

## Test-Files
- `packages/quay/test/init.test.mjs`
- `packages/quay/test/mcp-server.test.mjs`
- `packages/quay/test/branch-model.test.mjs`
- `plugin/test/config-key-consumer-check.test.mjs`
