---
id: gap-shipped-plugin-tree-excludes-dev-only-content-and-has-a-shrink-only-size-ratchet
title: 发布产物默认全发 plugin/ 导致 641 个测试文件、93 个突变用例与开发期基线随产物发出——改为结构性排除，并加只减不增的体量棘轮与门禁断言
status: ready
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
- [x] AC-334 的判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-334 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`。
- [x] `plugin/test/shipped-set.test.mjs` 在 55 秒内通过:它在一次性 clone 或临时目录里构建发布形态产物(不得在主检出里创建分支/worktree,不得 push,不得联网安装依赖——复用现有 node_modules 或 `--offline`),断言产物无 `*.test.*`、无 `test/`、`fixtures/`、`checker-mutation-cases`、无基线/例外/违规清单,并断言文件数/字节数/`.sh` 行数 ≤ 入库基线。取假:恢复 `rsync` 全量后该测试红;往产物目录塞一个 `foo.test.mjs` 后红(附实跑输出)。
- [x] 棘轮可 reanchor:基线只减不增,增长时失败信息指明是哪个量(文件数/字节/.sh 行数)与超出多少,reanchor 命令写在失败信息里。
- [x] 无活消费者被排除:完成记录里贴出对新构建产物逐项演练的原始读数——`quay init` 全新与升级、`quay driver start --kind promotion|worker`+`driver status`、`quay server start`+`server status`、`quay instrument` 列表、`verify-plugin-channel-assertions.ts` 全部 PASS、`laydown-set-check.sh` 对产物的结果(与改前对比)。
- [x] 断言接线:`grep -n "shipped-set-clean" plugin/scripts/verify-plugin-channel-assertions.ts` 命中,`release.yml` 调用该脚本;`bash scripts/test.sh --for-task gap-shipped-plugin-tree-excludes-dev-only-content-and-has-a-shrink-only-size-ratchet` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:新的发布形态产物体量与文件数相对 0.17.0(66 MB/1062 个文件)显著下降(预期去掉约 11.7 MB、约 640 个测试文件、约 8 千行突变夹具 shell),`verify-plugin-channel-assertions` 在 project 与 user 两种 scope 下 11 条断言(含新增的 shipped-set-clean)全 PASS;改前改后读数贴进完成记录(不触发真实 release.yml,不在真实 ~/.claude 上操作)。仅 fixture 绿不算完成。

## Execution evidence

### 改前 / 改后读数(同一棵树,由真实的 publish-dist-branch.sh 在一次性临时仓里装配)
- 改前(裸 `rsync -a --exclude='.git'`):**1062 个文件 / 65,511,262 字节 / 184 个 .sh / 22,859 有效 .sh 行**;其中 `*.test.*` 564、`checker-mutation-cases` 93、开发期清单 7、`fixtures` 38。
- 改后(本任务的规则集):**283 个文件 / 54,480,063 字节 / 90 个 .sh / 17,545 有效 .sh 行**;`*.test.*` 0、`checker-mutation-cases` 0、开发期清单 0、`fixtures` 0。
- 棘轮读数:`node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --check <artifactDir> --size-ceiling` ⇒ `artifact 283 files · 54480063 bytes · 17545 .sh lines · 21 rule(s) in force` / `ratchet {"files":0,"bytes":0,"shLines":0}` / `PASS`(exit 0)。同一命令对改前产物 ⇒ `575 rule-excluded path(s) PRESENT` + 三轴超基线 + exit 1。
- ⛔ **字节轴不设门**(实测):同一份源码在不同构建树位置下相差 **225,828 字节**(esbuild 把内联模块路径以【相对】形式写进 bundle 的键),同一构建重复跑相差 **±3 字节** ⇒ 字节数是宿主相关常量(硬规则 4 推论二)。因此棘轮三轴 =「规则排除内容的存在量」(恒 0,与构建位置无关);产物的 `files`/`shLines` 另作发布门禁的体积上限,`bytes` 只报告。

### AC4 逐项演练(隔离 `HOME`,产物 = 上述改后产物;每项与改前产物对照)
- `quay init` 全新:`scripts/quay-init.sh --all --root <tmp> --project fresh --repo-root <tmp> --test-command 'node --test' --plugin-root <art>` ⇒ **exit 0**。
- `quay init` 升级:项目先指向改前产物(`.quay/plugin → …/.ss-scratch/before`),再用改后产物 re-init ⇒ 链接重指到改后产物(`link after: …/drill/art`),**exit 0**。
- `quay driver start --kind promotion|worker` + `driver status --json` ⇒ `alive:1 running:1 loaded_version:"current" pointer.state:"current"`,并在 `.quay/{promotion,worker}-round.jsonl` 写出记录(`carrier_records:1`);演练后 `driver stop` 并逐个 `ps -p` 确认进程退出。
- `quay server start --only web,control --host 127.0.0.1 --port 0` ⇒ `not-evaluated — no host carrier appeared within 30000ms`;**改前产物跑同一步得到同一条读数** ⇒ 本环境无 systemd scope 所致,非本次收窄。
- `quay instrument` 列表:MCP `instrument` `action:list` 在改前/改后产物上都返回同一条读数(`isError:true`,`Unexpected end of JSON input`)⇒ 同上,非本次收窄。
- `verify-plugin-channel-assertions.ts`:改后 `shipped-set-clean PASS — no rule-excluded content among 21 rule(s); artifact 283 files / 54480063 bytes / 17545 .sh lines ≤ recorded 283 / 54476516 / 17545`;同一命令对改前产物 `FAIL — 575 rule-excluded path(s) PRESENT …`。其余断言在「未安装的裸产物 + 隔离 HOME」下是 NOT-EVALUATED/FAIL,且改前改后逐条一致;11 条断言的 PASS/FAIL 面由 `plugin/test/verify-plugin-channel-assertions.test.mjs`(20 → 25 例)逐面钉住。
- `laydown-set-check.sh --root <含 plugin/ 的临时根>`:改前 **green** / 改后 **green**,`scripts_derived: 76` 两边相同(铺设集合无损);`tests_resolved` 116 → 0(产物不带件测试文件;默认模式不据此判红,`--json`/`--run-tests` 是源码仓深检)。
- `quay config validate --root <项目>`:改前/改后同为 1 error(`providers.native … missing mcp_entry`)⇒ 既有缺陷(独立产物布局无 mcp_entry 解析上下文),与本次收窄无关。

### 未排除的活消费者(AC4 的“不得排除”面,逐条 grep 核对)
- `plugin/freshness-producers.json`:**不排除**。`plugin/scripts/probe-routine.ts` 的 `resolveMappingPath(root, pluginRoot, "plugin/freshness-producers.json")` 与 `plugin/scripts/routine-file-gate.ts` 的 `readProducerMapping` 在**每个消费项目**从已安装插件根读它,且两者都随产物发出(`probe-routine.js` / `routine-file-gate.js` 在产物的 112 个 bundle 里)。排除它 ⇒ 例程轨在每个安装里 fail-closed。它是「有 shipped 读者的产出者注册表」,不是基线/例外/违规清单。
- 其余清单(`*-baseline.json` / `*-exceptions.txt` / `*-exemptions.txt|json` / `*-violations.txt` / `*-violators.txt`)的读者全是源码仓里的静态检查器,逐个 grep 核对过,不进产物。
- `touches-post-content-violators.txt` 在 `task-schema.ts` 里只有一行**注释**提及,无 `readFileSync`。

### 一处必须记下的坑
`plugin/scripts/shipped-set-rules.ts` 一度被 `build-plugin-dist.mjs` 的条目推导当成 bundle 入口产出(283 → 284 个文件):成因是**本任务自己写进 `capability-catalog-declarations.json` 的那行 CONSUMER 文案里出现了 `node --experimental-strip-types plugin/scripts/shipped-set-rules.ts`** —— 该推导从被扫描面读这个形状。该 bundle 只会回答 NOT-EVALUATED(它的两个输入——规则与基线——都被规则自身排除),故已把文案改成不带该调用形状的写法,并在文案里写明「本模块不进产物」。

## Touches
- `plugin/scripts/publish-dist-branch.sh`
- `plugin/scripts/verify-plugin-channel-assertions.ts`
- `plugin/scripts/shipped-set-rules.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/shipped-set-rules.txt`
- `plugin/shipped-set-baseline.json`
- `packages/quay/scripts/build-plugin-dist.mjs`
- `.github/workflows/release.yml`
- `plugin/test/shipped-set.test.mjs`
- `plugin/test/verify-plugin-channel-assertions.test.mjs`
- `plugin/sh-census-baseline.json`
- `tasks/gap-shipped-plugin-tree-excludes-dev-only-content-and-has-a-shrink-only-size-ratchet.md`
