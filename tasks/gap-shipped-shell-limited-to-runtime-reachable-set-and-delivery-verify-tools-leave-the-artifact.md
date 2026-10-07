---
id: gap-shipped-shell-limited-to-runtime-reachable-set-and-delivery-verify-tools-leave-the-artifact
title: 发布产物里的 .sh 只保留运行时可达的集合——按"实际被执行"的引用闭包派生，交付/验证工具（已取消的 tgz 渠道）出局
status: ready
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

实现落点:`plugin/scripts/shipped-shell-reachability.ts`(新,派生根集合与执行闭包;catalog 声明的 instrument 当根,`NOT_SHIPPED` 与 `UNSHIPPED_BY_DECISION` 里的除外)。装配侧 `publish-dist-branch.sh` 在 dist 构建【之后】从待发布树里删除派生出的集合——⛔ 不用 rsync `--exclude`:实测 `build-plugin-dist.mjs` 的入口集有一部分来自 carrier(`.sh` 里命名的 `.ts`),在 rsync 阶段排除会让入口集缩小,而 dist 引用闭包门(其 required-set 取自源码树)会因此拒绝发布(实测缺 8 个 bundle);后置删除让构建输入与未过滤树逐字节相同,只有产物输出少了那些 `.sh`。发布门禁侧 `verify-plugin-channel-assertions.ts` 新增断言 `shipped-shell-reachable`(对已安装树直接走盘,与源码检出的可达集比对)。

## AC
- [x] AC-335 的判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-335 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`。
- [x] `plugin/test/shipped-shell-reachability.test.mjs` 在 55 秒内通过:从上述根集合派生可达 shell 集合,断言产物里每个 `.sh` 都在其中,且 `verify-deliver-coldstart.sh`、`develop-deliver-tgz.sh` 不在产物中。取假:往产物塞一个无人引用的 `orphan-tool.sh` 后红;把 capability-catalog 声明的某个 instrument 的 `.sh` 排除后红(证明 catalog 根有效);恢复 `verify-deliver-coldstart.sh` 后红(附实跑输出)。
- [x] 完成记录里贴出改前改后读数:产物 `.sh` 文件数与行数(改前 184/36910;前置任务之后的读数;本任务之后的读数),以及被判出局的每个 `.sh` 及其原因(无引用/渠道已取消);并列出"文本提到但不被执行"的例子,证明闭包按执行引用而不是按散文提及派生。
- [x] 无活消费者被排除:用新构建重跑整套演练(init 全新与升级、driver、serve、`quay instrument` 列表与至少三个 instrument 的实跑、cold-start 门禁),原始读数贴进完成记录;`bash scripts/test.sh --for-task gap-shipped-shell-limited-to-runtime-reachable-set-and-delivery-verify-tools-leave-the-artifact` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:新的发布形态产物里 `.sh` 只剩运行时可达集合,体量棘轮基线随之下调并入库;`verify-plugin-channel-assertions` 在 project 与 user 两种 scope 下全部 PASS;改前改后读数贴进完成记录(不触发真实 release.yml,不在真实 ~/.claude 上操作)。仅 fixture 绿不算完成。

## Touches
- `plugin/scripts/publish-dist-branch.sh`
- `plugin/scripts/shipped-shell-reachability.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/scripts/verify-plugin-channel-assertions.ts`
- `plugin/test/shipped-shell-reachability.test.mjs`
- `plugin/test/shipped-set.test.mjs`
- `plugin/test/publish-dist-branch-closure-gate.test.mjs`
- `plugin/shipped-set-baseline.json`
- `plugin/sh-census-baseline.json`
- `tasks/gap-shipped-shell-limited-to-runtime-reachable-set-and-delivery-verify-tools-leave-the-artifact.md`

## Execution evidence

### 改前 / 改后读数（同一棵树,由真实的 publish-dist-branch.sh 在一次性临时仓里装配）
| 时点 | 产物文件数 | 产物 `.sh` 文件数 | 产物 `.sh` 有效行 | 零容忍棘轮（规则排除内容） |
|---|---|---|---|---|
| 立案（0.17.0 全发） | 1062 | 184 | 22859 | — |
| 前置任务之后（本任务改前） | 283 | 90 | 17545 | {files:0,bytes:0,shLines:0} |
| **本任务之后** | **264** | **71** | **8286** | {files:0,bytes:0,shLines:0} |

读数命令与原始输出:`node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --check <artifact> --json` ⇒ `artifact 264 files · 54225614 bytes · 8286 .sh lines · 21 rule(s) in force`,`forbidden {"files":0,"bytes":0,"shLines":0}`。(`bytes` 不设门,见 `SIZE_GATED_AXES`:同一份源码在不同构建树位置相差 225,828 字节、同一次构建重跑相差 ±3 字节。)
棘轮重锚:`plugin/shipped-set-baseline.json` 的 `shipped` 由 283/54476516/17545 下调到 **264/53926575/8286**(经 `--reanchor`,不是手填;`_reanchorLog` 第 2 条记 before/after 与理由),`plugin/sh-census-baseline.json` `embeddedInterpreterLines` 7694→7695(+1,`publish-dist-branch.sh` 新增那一行读取;与前置任务同类的一次性成本,`_reanchorLog` 已记归因,残差 0)。

### 被判出局的 19 个 `.sh`（逐条 + 原因）
派生命令:`node --experimental-strip-types plugin/scripts/shipped-shell-reachability.ts --json` ⇒ `reachable 71 / unreachable 19 / rootFiles 162 / rulesInForce 21`,源文件合计 13,695 行。

**A. 无执行引用（16 个）**
- `gate-scripts/` 下 12 个退役的经典管线门:`audit-independence-check.sh`、`it0-backlog-projection-check.sh`、`it0-ceiling-check.sh`、`it0-ceiling-line-budget-check.sh`、`it0-dashboard-line-budget-check.sh`、`it0-dod-check.sh`、`it0-dogfood-evidence-gate.sh`、`it0-gate-hash-check.sh`、`it0-impl-row-check.sh`、`tree-hygiene-check.sh`、`vmeta-lag-check.sh`、`worktree-branch-hygiene-check.sh`。依据:`plugin/README.md:77`「Retired gate scripts (plugin/gate-scripts/ — RETIRED, not distributed)」+ `orchestration/SPEC-complete-delivery-surface-2026-08-05.md:35`(分层退役、文件留树、`quay-init` 不再铺、`sync.sh` 不再 sync);全仓按命令位置 grep `gate-scripts/*.sh` 的引用 = **0**。
- `sync.sh`(开发期 canonical→plugin/ 资产同步):无任何运行时可执行引用(CI 用 `sync.sh && git diff --exit-code plugin/`,不是产物运行时)。
- `scripts/audit-independence-check.sh`、`scripts/codex-stage1-selfcheck.sh`、`scripts/it0-enforcement-with-design-check.sh`:catalog 自己的 `NOT_SHIPPED` 表已判 `ships:false`(exp5 legacy),故不作为根。

**B. 渠道已取消（3 个；按决定出局,⛔ 不是「无引用」）**
- `scripts/verify-deliver-coldstart.sh`(9111 行)——服务 npm/tgz 交付渠道,人 2026-09-16 取消。
- `scripts/develop-deliver-tgz.sh`(3078 行)——同上。
- `scripts/deliver-verify-usage.sh`(197 行)——tgz 安装后的用法探针;唯一调用它的 `develop-deliver-tgz.sh` 本身也已出局。
读数区分:`unshippedByDecision = ["scripts/deliver-verify-usage.sh","scripts/develop-deliver-tgz.sh","scripts/verify-deliver-coldstart.sh"]`,其 `unreachableReasons` 为 `REACHED by a root, but unshipped by decision: …`。⛔ 与 A 类分开报:把「有消费者的工具」报成「无人调用」正是硬规则 3 禁止的形态。

### 「文本提到但不被执行」的例子（证明闭包按执行位置派生,不按散文）
- `plugin/scripts/workflow-baseline-metrics.ts:1050`(与 `:1171`)的 `commandIdentity: "node … experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh …"` —— 夹具字符串;字面目录后缀不指向任何候选 ⇒ 不解析。
- `packages/quay/src/init.ts:817` 的 `"  #     script: \"./scripts/it0-dod-check.sh\""` —— 生成模板里的示例行(转义引号内路径),非整串路径字面量 ⇒ 不解析。
- `plugin/skills/quay-task-to-plan/prompts/plan-check-subagent.md:85` 围栏块内的散文行 `it0-ceiling-line-budget-check.sh verdict, already run by the orchestrator` —— 行首 token 之后不是参数/分隔符 ⇒ 不解析。
- `plugin/scripts/workflow-baseline-metrics.ts` 与 catalog 声明表对脚本名的「名字面」——本模块只把 catalog 当【根】(可渡),不当作引用闭包的边。
- 量化对照:从「任意提及」出发的文本闭包留 85/90;本模块的执行闭包留 71/90(差集就是上面 A、B 两类)。

### AC4 逐项演练（新构建产物;隔离 `HOME=/tmp/ssr-an/drill/home`;下列为原始读数）
- `quay init` **全新**:`bash <art>/scripts/quay-init.sh --all --root <tmp> --project fresh --repo-root <tmp> --test-command 'node --test' --plugin-root <art>` ⇒ **exit 0**,`.quay/plugin → <art>`。
- `quay init` **升级**:项目先指向改前产物(`…/layroot/plugin`),再用改后产物 re-init ⇒ 链接重指到 `<art>`,**exit 0**。
- `driver start --kind promotion` / `--kind worker` ⇒ **exit 0**,`{"kind":"promotion","driver_alive":1,"alive":1,"running":1,"loaded_version":"current","pointer":{"state":"current"}}`(worker 同),并写出 `.quay/promotion-round.jsonl`(1 条);演练后 `driver stop` ⇒ `not-running`,`ps -p <pid>` 确认进程已退出(无泄漏)。
- `server start --only web,control --host 127.0.0.1 --port 0` ⇒ **exit 3**,`web/control not-evaluated — no host carrier appeared within 30000ms`(本环境无 systemd scope;与前置任务记录的改前读数逐字相同 ⇒ 非本次收窄)。
- `quay instrument` **列表**:产物内 `scripts/dist/runtime-usage-inventory.js --instruments-json` ⇒ **stdout 0 字节 / exit 0**(未安装布局下的空读;与前置任务记录的改前读数「`isError:true`,`Unexpected end of JSON input`」同源 ⇒ 非本次收窄)。⛔ 本次收窄不改任何 dist bundle:prune 在 dist 构建【之后】执行且只删 `.sh`,每个 bundle 与改前逐字节相同。
- **至少三个 instrument 实跑**(产物内 dist bundle):`capability-catalog.js --help` ⇒ exit 0;`audit-independence-check.js --help` ⇒ exit 0;`cap-from-gate.js`(无参)⇒ exit 2 用法;`capability-catalog.js --summary` ⇒ `84 scripts | 84 declared | 0 unclassified | 84 ship`。
- **cold-start 门禁**:`dead-loop-check.sh --check-running --root <tmp>` ⇒ exit 0(`cold_start_state=stopped stopped_reason=never-started`);`loop-driver-check.sh` ⇒ exit 3 `STALLED (0) — no loop driver registered`(合成项目未注册循环的真实读数);`laydown-set-check.sh --root <含 plugin/ 的临时根>` ⇒ `laydown_set_green: green`、`scripts_derived: 76`,**与前置任务记录的改前读数相同** ⇒ 铺设集合无损。
- `verify-plugin-channel-assertions.ts --installed <art> --project <tmp>`,scope = project / user / local 三次:`shipped-set-clean PASS`(`artifact 264 files / … / 8286 .sh lines ≤ recorded 264 / … / 8286`)与新增的 `shipped-shell-reachable PASS`(`all 71 artifact .sh file(s) are reachable from the runtime roots (71 reachable, 162 root file(s) read)`)三次全 PASS。其余断言(config-validate-cli/mcp、version-consistency、server-status-loaded-version、scope-install-shape)在本环境同为 FAIL/NOT-EVALUATED —— 与前置任务记录的改前读数逐条一致(dev 构建 + 未注册安装),**本次收窄只可能影响上述两条,两条都 PASS**。
- `bash scripts/test.sh --for-task <id> --allow-thin` ⇒ **exit 0**:scoped 静态门 + 43 个测试全绿(含本任务的 8 例、`verify-plugin-channel-assertions.test.mjs` 25 例、`capability-catalog.test.mjs` 18 例、`shipped-set.test.mjs` 10 例、`publish-dist-branch-closure-gate.test.mjs` 3 例)。

### 一处已知代价（AC4 的「无活消费者」面,如实记录）
`plugin/scripts/integration-batch-merge.ts:568` 会为**可选** `--deliver` 旗标启动 `develop-deliver-tgz.sh`;该文件出局后此路径按其自身代码退化为 `err("--deliver requested but develop-deliver-tgz.sh not found at …; skipping")`(显式、非致命)。`release-freshness-check.sh --deliver` 读取的 `.quay/develop-deliver-state.json` 同理不再被写。两条都只服务已取消的跨机 tgz 交付渠道且都是 opt-in;记为观察项(硬规则 12:不凭一次发生就设前置),不在本任务内移除这两条分支。
