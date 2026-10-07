---
id: gap-init-single-engine-state-based-upgrade-validate-before-write
title: init 单一引擎：升级与全新安装同一路径，先在内存算出新配置并校验、通过才原子写入；失败非零退出并保留原配置；保留用户注释/未知键/固定值、去掉退役键、幂等
status: todo
labels:
  - gap
  - defect
  - priority:p1
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-329
---
## Proposal
GOAL-029「init 统一为单一 TS 引擎、终局无 .sh;并收窄发布集合」(人 2026-10-07 裁定)。起因:2026-10-07 发布前演练发现已有项目升级后 `quay config validate` 仍红(`bash quay-init.sh` 的升级不补版本级 `loop.board`/`loop.gates`;只有 `quay init --reconcile`/MCP init 会补)。已定决策:终局无 .sh,过渡期 `quay-init.sh` 缩成调用 `bin/quay init` 的垫片;不再有 --reconcile/--force;状态自动决定(不存在→全新、可解析→升级、解析不了→备份重建);升级失败非零退出并保留原配置(先在内存算出新配置并校验,通过才原子写);未知键保留并警告;用户自己的不兼容值默认失败并指明,`--drop-incompatible` 才删。判据权威定义:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-329 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`(退出 0 = 达成)。

机制现状(已读):升级有两套引擎。`plugin/scripts/quay-init.sh` 对已有配置依次走 `migrate_stale_mcp_entry`/`ensure_provider_carrier_env`/`ensure_loop_config`/`reconcile-config` 四步,每步各写一次文件,不可能做到事务;`ensure_loop_config` 的写入者 `pyYamlDump` 会重新序列化整份文档;`quay init --reconcile`/MCP init 走 `packages/quay/src/init.ts` 的 `reconcileConfigContent`(含 `SERVE_VERSION_DEFAULTS`)。校验器 `packages/quay/src/config-validate.ts` 只能读磁盘文件,不能校验一段候选文本;`init` 自己从不运行校验。

修法:在 `init.ts` 里把 `runInit` 变成唯一引擎,按配置状态自动决定:absent → 全新;valid → 升级流水线(provider 绑定迁移=删除 native 的 path/mcp_entry、carrier 环境、四个项目值[已有值优先,不被检测覆盖]、版本级 loop 默认值[LOOP_VERSION_DEFAULTS,含 board/gates]、已登记的退役键删除[新增一份只增不减的退役键登记表,带原因]、`.quay/plugin` 链接刷新放在配置写成功之后);corrupt → 备份(`.quay/config.yml.corrupt-<ts>`)后从默认重建。全程用 YAML Document API 在内存里编辑(保留注释,不再用整份重新序列化的 pyYamlDump),算出候选文本后用一个能接收文本的校验函数(把 config-validate.ts 的检查抽成 `validateConfigText` 或等价物,CLI `config validate`、MCP `config_validate` 与 init 共用同一函数,不得各写一份)校验,通过才 tmp+rename 原子写;不通过则非零退出、原配置字节不变、报告指明是哪条问题。未知键保留并给出警告(需要"已知键"登记表,可复用 `plugin/scripts/config-key-consumer-check.ts` 的枚举能力);用户自己的不兼容值(例如 loop.gates 引用解析不到的 gate 名)默认失败并指明,`--drop-incompatible` 才删。`--dry-run` 只报告不写。本任务不删除 --reconcile/--force 标志,也不改 serve 默认值与对外参数面(留给后续任务);但 plain `quay init`(无任何标志)对已有配置必须升级而不是报 "already exists"。

## AC
- [ ] AC-329 的判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-329 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`。
- [ ] 取假:把"校验不过才不写"改成"先写后校验"后,AC-329 判据最后一段(含无法解析 loop.gates 的配置 ⇒ 非零且字节不变)变红(附实跑输出);把 init 改回对已有配置报 "already exists" 后判据第一段变红。
- [ ] 单一裁判:`grep -n "checkLoopRequired\|checkProviders" packages/quay/src/config-validate.ts` 的检查函数只有一份实现,被 CLI `config validate`、MCP `config_validate` 与 init 的候选文本校验三处共用(先打印改前基线命中并说明);新增测试断言"init 的校验结果 ⇔ `config validate` 对同一文本的结果"。
- [ ] 单元/集成测试(真 `.quay/config.yml` 的临时 workspace):①旧配置(含多行注释、未知键、用户固定值、旧 native path/mcp_entry、缺 loop.board/gates)升级后注释与未知键保留、退役键删除、版本级默认补齐;②二次运行字节不变;③loop.gates 指向不存在 gate ⇒ 非零、原文件字节不变、报告指明;④`--drop-incompatible` 时删除该值并成功;⑤corrupt 配置 ⇒ 备份并重建;⑥`--dry-run` 不写。`node --experimental-strip-types --test` 对相关测试文件退出 0。
- [ ] 既有测试迁移:因升级行为变化而变红的 `plugin/test/quay-init*.test.mjs` 与 `packages/quay/test/init.test.mjs` 用例按新契约更新(保留其原意图,不得删除用例换绿),完成记录列出每个被改用例与理由。
- [ ] `quay-init.sh` 若被改动须行数中性(sh-census 零余量)并重新锚定 `docs/analysis/quay-init-closure-ratchet.baseline.json`(`node --no-warnings --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --reanchor`);`bash scripts/test.sh --for-task gap-init-single-engine-state-based-upgrade-validate-before-write` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:在发布形态的构建产物上(`bash plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify` 不 push → `git archive` → 临时 HOME 下 `claude plugin marketplace add`+`install --scope user`),对一个由上一版(v0.16.0 tag 重建产物)init 过的真实形态项目运行当前 `quay init`,升级后 `quay config validate` 与 MCP `config_validate` 均通过,二次运行字节不变;原始读数贴进完成记录(不在真实 ~/.claude 上操作)。仅 fixture 绿不算完成。

## Touches
- `packages/quay/src/init.ts`
- `packages/quay/src/config-validate.ts`
- `packages/quay/src/cli/init.ts`
- `plugin/scripts/quay-init-steps.ts`
- `packages/quay/test/init.test.mjs`
- `packages/quay/test/config-validate.test.mjs`
- `packages/quay/test/mcp-config-validate.test.mjs`
- `plugin/test/quay-init.test.mjs`
- `plugin/test/quay-init-characterization.test.mjs`
- `plugin/test/quay-init-config-env-keys.test.mjs`
- `plugin/test/quay-init-stable-plugin-link.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-init-single-engine-state-based-upgrade-validate-before-write.md`
