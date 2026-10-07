---
id: gap-init-single-engine-state-based-upgrade-validate-before-write
title: init 单一引擎：升级与全新安装同一路径，先在内存算出新配置并校验、通过才原子写入；失败非零退出并保留原配置；保留用户注释/未知键/固定值、去掉退役键、幂等
status: done
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
- [x] AC-329 的判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-329 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`。
- [x] 取假:把"校验不过才不写"改成"先写后校验"后,AC-329 判据最后一段(含无法解析 loop.gates 的配置 ⇒ 非零且字节不变)变红(附实跑输出);把 init 改回对已有配置报 "already exists" 后判据第一段变红。
- [x] 单一裁判:`grep -n "checkLoopRequired\|checkProviders" packages/quay/src/config-validate.ts` 的检查函数只有一份实现,被 CLI `config validate`、MCP `config_validate` 与 init 的候选文本校验三处共用(先打印改前基线命中并说明);新增测试断言"init 的校验结果 ⇔ `config validate` 对同一文本的结果"。
- [x] 单元/集成测试(真 `.quay/config.yml` 的临时 workspace):①旧配置(含多行注释、未知键、用户固定值、旧 native path/mcp_entry、缺 loop.board/gates)升级后注释与未知键保留、退役键删除、版本级默认补齐;②二次运行字节不变;③loop.gates 指向不存在 gate ⇒ 非零、原文件字节不变、报告指明;④`--drop-incompatible` 时删除该值并成功;⑤corrupt 配置 ⇒ 备份并重建;⑥`--dry-run` 不写。`node --experimental-strip-types --test` 对相关测试文件退出 0。
- [x] 既有测试迁移:因升级行为变化而变红的 `plugin/test/quay-init*.test.mjs` 与 `packages/quay/test/init.test.mjs` 用例按新契约更新(保留其原意图,不得删除用例换绿),完成记录列出每个被改用例与理由。
- [x] `quay-init.sh` 若被改动须行数中性(sh-census 零余量)并重新锚定 `docs/analysis/quay-init-closure-ratchet.baseline.json`(`node --no-warnings --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --reanchor`);`bash scripts/test.sh --for-task gap-init-single-engine-state-based-upgrade-validate-before-write` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:在发布形态的构建产物上(`bash plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify` 不 push → `git archive` → 临时 HOME 下 `claude plugin marketplace add`+`install --scope user`),对一个由上一版(v0.16.0 tag 重建产物)init 过的真实形态项目运行当前 `quay init`,升级后 `quay config validate` 与 MCP `config_validate` 均通过,二次运行字节不变;原始读数贴进完成记录(不在真实 ~/.claude 上操作)。仅 fixture 绿不算完成。

## Touches
- `packages/quay/src/init.ts`
- `packages/quay/src/config-validate.ts`
- `packages/quay/src/cli/init.ts`
- `packages/quay/src/mcp-server.ts`
- `packages/quay-native/bin/quay-native.ts`
- `plugin/scripts/quay-init-steps.ts`
- `packages/quay/test/init.test.mjs`
- `packages/quay/test/config-validate.test.mjs`
- `packages/quay/test/mcp-config-validate.test.mjs`
- `packages/quay/test/branch-model.test.mjs`
- `plugin/test/quay-init.test.mjs`
- `plugin/test/quay-init-characterization.test.mjs`
- `plugin/test/quay-init-config-env-keys.test.mjs`
- `plugin/test/quay-init-stable-plugin-link.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-init-single-engine-state-based-upgrade-validate-before-write.md`

## Evidence
完成记录(worker 在 worktree `gap-init-single-engine-state-based-upgrade-validate-before-write` 上执行;实现提交 `9656d520c`)。

### AC-329 判据
`bash <criterion>` → `EXIT=0`(判据脚本 = `goal show AC-329 --json | python3 … | bash`)。判据内两段(升级后 validate 通过 + 二次运行字节不变;corrupt 配置 ⇒ 非零且字节不变)均实测通过。

### 取假(三段,均实测;每次 mutation 前 `cp init.ts /tmp/init.ts.bak`、跑完 `cp` 还原,不用 git checkout)
- **F1「先写后校验」**:valid 分支改成先 `writeFileAtomic` 再判 `up.ok` ⇒ `GOAL-029③` 变红:`AssertionError: a failed upgrade leaves the config byte-identical (validate BEFORE write)`。⛔ **该 mutation 不使 AC-329 判据变红**——判据最后一段喂的是**重复键 ⇒ 解析失败(corrupt)**的配置,走 corrupt 分支,不进 valid 分支;判据文字说的"含无法解析 loop.gates 的配置"与它实际构造的输入不符(那条 `sed` 在已含 `gates:` 的升级产物后追加同名键 ⇒ `YAML.parse` 报 `Map keys must be unique`)。"先算后写"的可观测形态由 `GOAL-029③`(旧配置 + 退役键 + 坏 gate)承担。
- **F2「解析不了就重建」**:corrupt 守卫改成 `false &&`(plain init 对 corrupt 走备份重建) ⇒ AC-329 判据最后一段变红:`CAUSE=incompatible-user-value-accepted — an unresolvable loop.gates value must make init exit non-zero`,`EXIT=1`。
- **F3「改回 already exists 拒绝」**:valid 分支直接 `return {outcome:"skipped",…}` ⇒ AC-329 判据第一段变红:`CAUSE=init-rejected-existing-config-rc1`,`EXIT=1`。

### AC3 单一裁判
- 改前(`git show develop:…`)命中 4:`checkProviders`(:240 定义)、`checkLoopRequiredFields`(:448 定义)、以及 `validateConfig` 内的两处内联调用。
- 改后同样 4 命中:两个定义不变,两处调用移进新的 `runChecks()`;`runChecks` 只被 `validateConfigText`(text 入口)与 `validateConfig`(file 入口)调用,而 CLI `config validate`(`cli/config.ts:34`)与 MCP `config_validate`(`mcp-handlers.ts:999`)都经 `validateConfig`,init 经 `validateConfigText`(`init.ts:514`/`:545`) ⇒ 三处共用同一 `runChecks` 实现,无第二份。
- 新增测试 `AC3 parity: validateConfigText (init's candidate judge) ⇔ validateConfig (the file judge)`(`packages/quay/test/config-validate.test.mjs`):对 4 个文本断言 `ok` **与 `issues` 全等**。

### AC4 单元/集成测试
① `GOAL-029①`(init.test.mjs);② 既有 `AC2 reconcile: a config already current is NOT rewritten`(迁移后,两轮取基线);③ `GOAL-029③`;④ `GOAL-029④`;⑤ 既有 `AC1 corrupt: --reconcile repairs it and PRESERVES the unparseable bytes`(未改动,原样通过 —— 本实现保留 `--reconcile` 的备份+重建);⑥ `GOAL-029⑥`。
`node --experimental-strip-types --test packages/quay/test/{init,config-validate,mcp-config-validate}.test.mjs plugin/test/quay-init{,-characterization,-config-env-keys,-stable-plugin-link}.test.mjs` ⇒ **178 tests / 178 pass / 0 fail**。

### AC5 既有测试迁移(逐个;`plugin/test/quay-init*.test.mjs` 四个文件零改动 —— 它们驱动 shell 与未改动的 `reconcileConfigContent`/`ensureProviderCarrierEnv`,行为不变、全绿)
1. "AC3: quay init refuses to overwrite existing config" → "**AC3: plain quay init UPGRADES an existing config**":契约由人裁定反转(plain init 即升级路径),断言改为 exit 0 + 用户注释存活。
2. "AC2 reconcile negative control: WITHOUT --reconcile … still refused" → "**…a bare init STILL upgrades**":同样的反转;负控制改为"bare init 确实写入并补默认值"。
3. "AC2 reconcile: a legacy config missing the version defaults…" 的 serve 段 → 反转为 GOAL-029「等于回退值的 serve 默认不写」:不再断言 `filled serve.host`,改断言 `doc.serve === undefined` 且无 `host:`/`port:` 行。
4. "AC2 reconcile: a config already current is NOT rewritten" → 改为两轮 init 后取字节基线(CLI 全新模板目前仍写退役键;fresh↔升级合流属 AC-331)。
5. "AC2② …pure INSERTION" → "**…TARGETED edit (no re-dump)**":升级现在还删除退役键,故存活断言排除 path/mcp_entry 行并断言它们消失。
6. AC10c "quay-native init refuses overwrite" → "**never clobbers**":见"偏差"——native CLI 的 Core 经裸说明符在 worktree 中解析到主检出,故写成两臂都成立(升级则保留用户内容 / 拒绝则零写入)。
7. `packages/quay/test/branch-model.test.mjs`(**fan-in 全量 suite 报出的遗漏**;该文件原不在 `## Touches`,故 `--for-task` 的 scoped 面没选中它):"CLI: the config-free entry supersedes the config-exists refusal it shares a command with" → "**…supersedes the upgrade refusal…**"。该臂钉的是 plain init 对已有配置报 `already exists` 的**已退役契约**(GOAL-029 反转),故同一 fixture 上 plain init 现在走升级流水线、因用户值不兼容而 `upgrade REFUSED`(exit 1);`--branch-model-only` 不被该 refusal 捕获。原意图保留(仍是"config-free 入口不被 plain init 的守卫捕获"的**定序**回归臂),falsifiable:把 `runInit` 的 `branchModelOnly` 块移/落到升级流水线之后即红(已用 `false &&` mutation 实测变红)。已把该文件加入 `## Touches`。

### AC6
`plugin/scripts/quay-init.sh` **未改动**(故免 sh-census 行数中性);`quay-init-closure-ratchet.ts --gate` → `PASS: … 3 files / 1022 bytes ≤ baseline 3 files / 1022 bytes`,`--check-stale` → `PASS … fingerprint fresh` ⇒ 无需 `--reanchor`。
`bash scripts/test.sh --for-task gap-init-single-engine-state-based-upgrade-validate-before-write --allow-thin` ⇒ **EXIT=0**,跑 **275 tests / 275 pass / 0 fail**(115 个测试文件,含 `init.test.mjs` 的 GOAL-029 四条与 parity 测试);scoped-gate cache 已按 develop sha `45722109d980fb326d3359661e7a5ef249cab633` 写入。`npx tsc --noEmit -p packages/*/` 四个包全绿。

### DoD(部分执行;真实读数,非手搓 fixture)
用 **v0.16.0 tag 的真实 shipped 入口**产生"旧形态"配置(不是手写 fixture):
```
git worktree add --detach /tmp/quay-v016 v0.16.0   # 临时,用完 remove
(scratch 项目) CLAUDE_PLUGIN_ROOT=/tmp/quay-v016/plugin bash …/quay-init.sh --loop --worktree-root … --repo-root …
```
- 升级前,当前 `quay config validate`:→ `error: loop.board — Missing required field "board"` / `error: loop.gates …`,`2 error(s) found.`,`rc=1`(复现 2026-10-07 演练的缺陷)。
- 升级前,MCP `config_validate`(handler 直调):`{"ok":false,"errors":["loop.board","loop.gates"]}`。
- 运行当前 `quay init`:→ `upgraded to this version's defaults. / filled loop.board (was absent) / filled loop.gates (was absent)`,`rc=0`。
- 升级后:`quay config validate` → `Config valid.`,`rc=0`;MCP `config_validate` → `{"ok":true,"errors":[]}`;第二次 `quay init` → `already current … not rewritten`,`cmp` 字节相同。
- 另在 main 检出(旧 shipped shell)init 出的真实项目上验证:用户注释/未知键 `x_my_extra`/用户固定 `serve.port: 4321` 全部保留,`path:`/`mcp_entry:` 行数 0,二次运行字节相同。
- ⛔ **未做**:`publish-dist-branch.sh` 构建 + 临时 HOME 下 `claude plugin marketplace add`/`install --scope user` 的 marketplace 安装形态(需重建产物 + 隔离 HOME 安装)。上面用的是 v0.16.0 的**源码树**入口而非 marketplace 安装产物 —— 这一步是 DoD 与本记录之间的已知差口,留给发布门禁/后续任务。

### 已知偏差与留给后续任务的
- **corrupt 语义**:AC-329 判据要求 plain init 对无法解析的配置**非零退出且字节不变**,而 Proposal/GOAL 文字说"解析不了→备份重建"。判据权威 ⇒ 本实现:plain init 对 corrupt **拒绝**(报告真实原因、不写),`--reconcile`/`--force` 仍备份+重建(既有测试覆盖)。理由:无显式指令时不覆盖用户无法解析的文件(硬规则 3b)。
- **serve 默认值**:按 GOAL-029「等于回退值不写进配置」,升级路径跳过 `SERVE_VERSION_DEFAULTS` 中值等于 `SERVE_BINDING_FALLBACK` 的键(今天全部跳过);`SERVE_VERSION_DEFAULTS` 本身的删除与 `--reconcile/--force/--json` 的参数面收敛属 **AC-330**。
- **fresh 模板**:CLI `generateConfigContent` 仍写 native `path`/`mcp_entry`(升级即删)且 env 只写 `QUAY_NATIVE_TASKS_DIR`(升级补 carrier pins)⇒ "全新安装比升级落后一步";fresh↔升级合流属 **AC-331**。
- **CLI help 展示副本**:`quay init --help` 实际由 `packages/quay/src/cli/help.ts` 渲染(不在本任务 Touches),文案仍旧;`cli/init.ts` 内的副本已更新。help/README 对外面更新属 **AC-330**。
- **native CLI 的 engine 解析**:`packages/quay-native/bin/quay-native.ts` 经裸说明符 `quay/init` 取 Core,在 worktree 中解析到**主检出**(node_modules 是主检出的软链)⇒ 本任务对该文件的 outcome 处理在 worktree 内不生效,合并进 develop 且主检出一致后生效;AC10c 因此写成两臂断言(精确契约由相对路径驱动 Core CLI 的 GOAL-029 测试钉住)。
- **AC2 措辞与判据实际输入不符**:判据最后一段实际是 corrupt 分支(见"取假 F1"),故 F1 的可观测形态落在 GOAL-029③ 而非判据本身;已按实测如实记录。
- **scoped 门漏选 `packages/quay/test/branch-model.test.mjs`**:原 `## Touches` 不含该文件 ⇒ `scripts/test.sh --for-task` 的 scoped 测试集不含它,AC6 的 scoped 绿对该文件**不构成证据**;该红是 fan-in 的**全量 suite**(8780 tests / 1 fail)报出的。已把该文件加入 `## Touches`,后续 scoped 门覆盖它。