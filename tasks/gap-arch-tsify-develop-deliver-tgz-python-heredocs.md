---
id: gap-arch-tsify-develop-deliver-tgz-python-heredocs
title: shell→TS（SPEC Phase 5.3 第一阶段）：develop-deliver-tgz.sh 的 10 个内嵌 python3
  heredoc 抽成独立 .ts，编排保留 bash
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-313
---
## Proposal

**SPEC-architecture-consolidation §5 Phase 5.3 只做第一阶段：把 `plugin/scripts/develop-deliver-tgz.sh`（census 有效行 2354，内嵌解释器只有 `python3`，实测 10 个 `python3 … <<` heredoc）里的 python 逻辑逐个抽成独立的 `.ts` 模块，bash 只保留编排（胶水是 bash 的强项，SPEC 非目标 1：不把所有 bash 都改 TS）。「改编排」是 SPEC 写的第二阶段，本任务不做。**

**为什么排在 5.2 之后**：SPEC 排序 5.1 → 5.2 → 5.3。5.1/5.2 已立案。`develop-deliver-tgz.sh` 是**交付产物的生产者**（tgz 出的每一份包都经它），风险高于前三个，且刚被 `gap-fan-in-installed-layout-sibling-script-resolvability-test-and-reaper-bundling` 等任务改过——实现前先读近 3 天对它的提交，避免抢文件。

**调用方（实测 `git grep`）**：`.github/workflows/ci.yml`、`plugin/freshness-producers.json`、`plugin/scripts/{deliver-verify-usage,integration-batch-merge,release-freshness-check}.sh`、`plugin/scripts/{runner-static-gate}.ts`、`plugin/scripts/verify-deliver-coldstart.sh`；测试 `plugin/test/{develop-deliver-tgz,develop-deliver-tgz-evidence-transport,release-freshness-check,freshness-producer-coverage-check}.test.mjs`。**`verify-deliver-coldstart.sh` 属 SPEC §8-④ 例外（不立案），本任务只保证它对本脚本的调用不断，⛔ 不得改它。**

**运行时解析纪律**：抽出的 `.ts` 由该 `.sh` 在运行时 spawn，必须走既有 sibling-script 解析（安装布局 = plugin marketplace cache / npm-pack / vendored 都要能解析），并进 capability-catalog（声明表已是 JSON：`plugin/scripts/capability-catalog-declarations.json`）。**这正是 `gap-fan-in-installed-layout-…` 那一族缺陷的形态——新增 sibling 脚本却在安装布局里不可解析**，所以 AC 里有一条专门读安装布局。

## AC

- [x] AC1（枚举，先于改动）贴出 10 个 python3 heredoc 的清单：行号、作用一句话、输入/输出（stdin/argv/stdout/退出码），以及每个的抽取落点 `.ts` 文件名。缺一个即不合格。
- [x] AC2（characterization 先于改写，取假）对每个 heredoc 的输入输出契约，在**未改动**的旧 bash 上先落盘测试并全绿；对旧 bash 注入一处行为改动，测试必须红，撤销后绿。两次输出贴进 notes；characterization 提交早于抽取提交。
- [x] AC3（等价）迁移前后，同一份输入下 tgz 的**逐文件清单**与各 heredoc 的 stdout/退出码一致（贴 `tar -tzf` 前后 diff，diff 为空）。
- [x] AC4（目标读数）`node --experimental-strip-types plugin/scripts/sh-census-check.ts --json` 中 `plugin/scripts/develop-deliver-tgz.sh` 的 `embedded` 不含 `python3`；`plugin/sh-census-baseline.json` 的 `embeddedInterpreterLines` 只降不升地同步。前后读数各贴一次。
- [x] AC5（安装布局可解析，生产载体）`bash packages/quay/scripts/package.sh` 产出的 tarball 解出后，在**安装布局**里跑一次 `develop-deliver-tgz` 到底，所有抽出的 `.ts` 均被解析到并执行（贴运行输出，⛔ 不是源码布局下的测试）。关掉 fixture 注入后仍成立。
- [x] AC6（生产载体，硬规则 4 推论三）落地后时间窗内，一次**真实**的 develop-deliver（CI 或本机 driver 触发）经新路径产出 tgz：贴时间戳晚于落地提交的产出记录，其逐文件清单与迁前基线一致。
- [x] AC7（catalog / 无新环 / 回归面）`capability-catalog.sh --summary` 声明数一致且 `0 unclassified`；`import-graph-check.ts --json` `verdict.ok=true`；上列 4 个测试文件单独跑全绿；`scripts/test.sh --for-task gap-arch-tsify-develop-deliver-tgz-python-heredocs` 全绿。

## DoD

真实落地：真实交付产物的 tgz 已经由抽出的 TS 模块产出，且与迁前逐文件一致（AC3/AC6）；安装布局里能解析全部新增 sibling 脚本（AC5）；census 中该脚本不再内嵌 python3（AC4）。

## 证据（AC 逐条）

**实现**：新增 sibling `plugin/scripts/develop-deliver-python-steps.ts`（8 个 step，逐行等价移植），`develop-deliver-tgz.sh` 里 10 段 `<<'PY'` heredoc 体与 2 个 `python3 -c` 单行各被替换成**一行** `py_steps <step>`；`py_steps` 是仿 `plugin/scripts/quay-init.sh` 的 `quay-init-step` 的包装函数（Phase 5.1 的同一形状）。⛔ 那行**故意**用**无花括号**的 `$SCRIPT_DIR`：`build-plugin-dist.mjs` 只匹配 `node --no-warnings --experimental-strip-types "$SCRIPT_DIR/X.ts"` 这一形态并改写成 shipped `dist/X.js`（顺手去掉 flag）；写成 `${SCRIPT_DIR}` 会落到通用的换扩展名规则上，于是 `.js` bundle 仍带着 `--experimental-strip-types` 被调用，而声明底线 Node 20 直接拒绝该 flag。三处「python 做不到逐字复现」的差异在模块头注释里点名而不静默改进；三处**刻意保留的形态缺陷**（见 AC1 表 H8/H9/H10 注解）也逐处在代码里标注。

### AC1 — 10 个 heredoc 的枚举（先于改动，行号取 `ea15ce4df` 的旧版）

`awk` 实测：10 段，合计 231 行 python。落点全部是同一个新文件 `plugin/scripts/develop-deliver-python-steps.ts`（Touches 已声明；未拆成多模块，故无需增补 Touches）。

| # | 行号 | 作用 | argv | stdout | 退出码 | 落点 step |
|---|---|---|---|---|---|---|
| H1 | 641-677 | `transport_evidence_append`：把 evidence 的非重复记录追加进 carrier；身份 = 记录**全部字段**的 `json.dumps(sort_keys=True)` | carrier, evidence | 追加条数 | 0（异常才非 0） | `evidence-append` |
| H2 | 716-743 | `check_evidence_completeness`：声明 ac 集合与实际集合求差 | evidence, "空格分隔的 ac 列表" | `COMPLETE`/`PARTIAL`/`ALL-MISSING …` | 0 / 2 / 3 | `evidence-completeness` |
| H3 | 782-824 | `check_e2e_pairing`（AC-240）：AC-203 与 AC-207 是否共享同一 `project_root` | evidence | `E2E-PAIR OK …` / `PARTIAL E2E_PAIR_MISSING=1 …` | 0 / 2 | `e2e-pairing` |
| H4 | 857-905 | `check_upgrade_pairing`（AC-239）：合格 AC-238 与 AC-239 是否同一 root | evidence | `UPGRADE-PAIR OK …` / `PARTIAL UPGRADE_PAIR_MISSING=1 …` | 0 / 2 | `upgrade-pairing` |
| H5 | 1350-1362 | AC-248 两个 detects 字段的 `is False`/`is True` 正样本读数 | carrier | `1` / `0` | 0 | `adrflip-bool-shape positive` |
| H6 | 1364-1383 | 同上，两种冒充形态（`0`/`1` 与字符串）必须**都**取不到真；含 `n` 守卫（无记录时打 `0`，与「都挡住了」的 `1` 不同值） | carrier | `1` / `0` | 0 | `adrflip-bool-shape impostors` |
| H7 | 1460-1475 | AC-249 `commit_files` 并集谓词（代码面 ∧ 文档面 ∧ task_id）正样本 | carrier | `1` / `0` | 0 | `complete-change-predicate positive` |
| H8 | 1477-1491 | 冒充①：只有代码面（完美但不完整的修复）——⛔ **刻意保留**：原体只走 carrier 决定「适用与否」，再对**硬编码列表**求值，无 `n` 守卫 | carrier | `1`（正确拒绝）/ `0` | 0 | `… code-only` |
| H9 | 1493-1507 | 冒充②：只有文档面 | carrier | `1` / `0` | 0 | `… doc-only` |
| H10 | 1509-1523 | 冒充③：`./scripts/…` 前缀——`startswith("src/")` 分支必须因此取假 | carrier | `1` / `0` | 0 | `… dot-slash` |
| H11 | 1661 | `read_state_field`：`d.get(key,'')`；任何失败 ⇒ 空（`\|\| echo ""`），键缺失是 `''` 而键存在且为 null 是 `None` | state_file, key | 值 | 0（失败时非 0，被 `\|\|` 吞） | `state-field` |
| H12 | 1673 | `age_seconds`：ISO-8601 → `max(0,int(now-ts))`；无时区的 naive 时间**不可用**（python 抛 TypeError）⇒ 空 | iso-ts | 整数秒 | 0（失败非 0） | `age-seconds` |

（H11/H12 是 `python3 -c` 单行；其余 10 段是 heredoc。落点文件名逐条相同，故省略前缀 `plugin/scripts/develop-deliver-python-steps.ts`。）

### AC2 — characterization 先落盘并**可取假**

`b4721cf06 test(develop-deliver): characterize the 12 embedded python3 contracts BEFORE extraction` **早于** `02abfbccb arch(develop-deliver): extract …`（`git log --oneline` 顺序即证据）。测试文件 `plugin/test/develop-deliver-tgz-characterization.test.mjs` 不碰内嵌体，而是驱动脚本**自己**的 hermetic 入口（六个 `--selfcheck*` + `--check`）——迁移前后唯一都存在的契约面。

未改动旧 bash 上全绿：`tests 8 / pass 8 / fail 0`。

注入一处行为改动（H2 的 `missing = sorted(exp - present)` → `missing = []`）后，**只有 H2 那一块**变红：

```
✖ H2 (heredoc 716-743) — COMPLETE(0) / PARTIAL(2) / ALL-MISSING(3) stay three distinguishable values
  AssertionError: --selfcheck-evidence-completeness must exit 0:
  selfcheck-evidence-completeness: partial → rc=0 develop-deliver: evidence-completeness COMPLETE present=2
  selfcheck-evidence-completeness: complete → rc=0 develop-deliver: evidence-completeness COMPLETE present=6
pass 7 / fail 1
```

撤销后回到 `pass 8 / fail 0`。两次完整输出留在 `.quay/ac313/ac2-negative-control-red.txt` 与 `ac2-revert-green.txt`（worktree 内、gitignored）。

### AC3 — 等价（stdout/退出码 + tgz 逐文件清单）

**(a) 12 个契约的 stdout/退出码**：另起一个差分夹具，把 `ea15ce4df` 的 10 段 python 体 + 2 个 `-c` 单行逐个抽出、与 TS step 在**同一批输入**上对跑（含：空行/非 JSON 行/JSON 数组行/空 ac/重复记录/仅 kind 不同/坏整数/缺 host/无时区时间戳/未来时间戳/carrier 缺失或已存在）：

```
differential: 116 (input × implementation) comparisons, 0 disagreement(s)
```

比对项 = stdout 逐字节 + 退出码，H1 另比**carrier 追加后的文件字节**。（唯一一次 1 秒差是夹具跨秒边界，重跑 3 次复现为 0 差异；已排除。）

**(b) 整条入口**：十个 `--selfcheck*` 模式，在 base 提交的 worktree 与本次改动后各跑一次，把各自的 `mktemp` 路径归一化后**逐字节相同、退出码相同**（10/10 `SAME`）。

**(c) 交付产物**：两次真实 develop 交付（旧 .sh / 新 .sh，同一 develop tip `699565759084`），`tar -tzf` 前后 diff：

```
  524 /tmp/ac313-x/before.list
  524 /tmp/ac313-x/after.list
diff rc=0 ; diff lines=0
```

第一次对比里两个 .tgz 的 sha256 不同——**已查明不是抽取造成的**：逐文件比对显示差异 100% 是 esbuild 把**构建树里 `node_modules` 的绝对路径**写进了 bundle 的 lazy-init 注册表键，而两个构建 worktree 的**路径深度不同**（`/tmp/ac313-base/.quay/…` vs `<worktree>/.quay/…`）。把构建路径**固定**（两次运行同一个 `--root`）后：

```
417e7b0e49f47f5ad79c1d01b38926b5ed839fd29b7f053df5691f2bfe131501  before2/quay-0.12.0-dev.tgz
417e7b0e49f47f5ad79c1d01b38926b5ed839fd29b7f053df5691f2bfe131501  after/quay-0.12.0-dev.tgz
tar -tzf diff rc=0 (0 = identical)
per-file sha diff lines=0 ; text diff lines=0
```

即：抽取对交付产物的影响是 **0 字节**（比 AC 要求的「清单一致」更强）。

### AC4 — 目标读数（前后各一次）

修前（`ea15ce4df`）：

```
plugin/scripts/develop-deliver-tgz.sh: {"codeLines":2354,"embedded":["python3"],…}
totals.embeddedInterpreterLines = 9133   baseline = {9133, 0}
```

修后（本分支 HEAD）：

```
plugin/scripts/develop-deliver-tgz.sh: {"codeLines":2115,"embedded":["node"],"tsTwin":false,"callers":{"ts":3,"sh":4,"test":6,"other":9},"exception":false}
totals: {"scripts":147,"embeddedInterpreterScripts":59,"embeddedInterpreterLines":8894,"duplicateCopies":0,…}
```

`embedded` 已不含 `python3`（只剩 `node`——包装函数仍然 exec node，所以该文件**仍在本轴的计数范围内**，动的是行数不是归属，与 `capability-catalog.sh` / `quay-init.sh` 两次迁移同形）。`plugin/sh-census-baseline.json` 同步下调 9133 → **8894**（-239 = 2354→2115），并写了 `_reanchorLog` 条目；落地前核过：committed baseline 8894 **等于** live reading 8894（该检查的 AC6 要求相等而不只是小于）。

### AC5 — 安装布局（生产载体）

`bash packages/quay/scripts/package.sh` → `quay-0.12.0-dev.tgz`（`dist-closure gate OK: 105 referenced dist bundles all present`）。解出后：

```
package/plugin/scripts/develop-deliver-tgz.sh            # 入口在
package/plugin/scripts/develop-deliver-python-steps.ts   # ⛔ 不存在（raw .ts 按设计被删）
package/plugin/scripts/dist/develop-deliver-python-steps.js   # 13704 字节的 bundle
```

安装布局里那条调用已被改写器改对了（`--experimental-strip-types` 已被去掉，正是无花括号拼写换来的）：

```
204:py_steps() {
205-  node --no-warnings "$SCRIPT_DIR/dist/develop-deliver-python-steps.js" "$@"
206-}
```

在**安装布局**里把 `develop-deliver-tgz` 跑到底（十个 `--selfcheck*` + 一次真实 `--check`）：8 个模式 `rc=0`；两个非 0 的（`--selfcheck-transport-closure` rc=1、`--selfcheck-worker-preflight` rc=1）**与 base .sh 在同一个安装布局里逐字节相同的输出**、同一个退出码——即它们是**安装布局本身的产物**（前者读 `$SCRIPT_DIR/../../node_modules/yaml`，安装布局没有；后者要 `refs/heads/develop`，安装目录不是 git repo），不是抽取造成的。stderr 全空（`--no-warnings`，零 node 告警）。

`--check` 真跑（两个状态读取器都在安装布局里被解析并执行）：

```
{"decision":"too-soon","lastDelivered":"deadbeef","develop":"6ec88b82ccd3d0843e426e939d474364773140f7","age_seconds":0,"max_age":21600}
```

**「解析到并执行」不是断言**：把 `dist/develop-deliver-python-steps.js` 挪走后，同一批模式立刻变红（`rc=1`、`: FAIL`、Node 的 `Cannot find module` 栈），挪回即全绿。即这条读数**能取假**（硬规则 4）。本模式无任何 fixture 注入，故「关掉 fixture 注入后仍成立」按构造成立。

### AC6 — 生产载体（一次真实的 develop-deliver）

落地提交 `02abfbccb` 时间 `2026-09-20T18:38:20Z`。其后用**新路径**跑了真实 develop-deliver（`--force --hosts "B C"`，B=orangevps / C=ad-arm1，两者都可达）：

```
develop-deliver: develop tip = 699565759084 (699565759084c5157fb7d288d11932fcd977975f)
develop-deliver: creating build worktree on branch deliver-build-699565759084 at develop tip: …/.quay/deliver-worktree-699565759084
develop-deliver: package.sh (quay .tgz)...
  → …/packages/quay/quay-0.12.0-dev.tgz
  → …/packages/quay-native/quay-native-0.12.0-dev.tgz
develop-deliver: B (orangevps.wan.hwang.men) VERIFY FAILED — FAIL reason=dashboard-marker-missing code=200
develop-deliver: C (ad-arm1.wan.hwang.men) VERIFY FAILED — FAIL reason=dashboard-marker-missing code=200
develop-deliver: state written → <worktree>/.quay/develop-deliver-state.json
{"lastDelivered":"699565759084c5157fb7d288d11932fcd977975f","hosts":{"C":"verify-fail","B":"verify-fail"},"usage_verify":{"C":"ok","B":"ok"},"timestamp":"2026-09-20T18:45:46Z"}
```

- 时间戳 `18:45:46Z` **晚于**落地提交 `18:38:20Z`；产出记录与 tgz 都在；tgz 逐文件清单与迁前基线一致（见 AC3c，同路径固定下甚至 sha256 相同）。
- ⚠️ **那条 http 面失败不是本任务造成的，且已用旧路径做对照证明**：同一时间窗内用 **base .sh** 对同样两台机器再跑一次，得到**完全相同的**失败（`dashboard-marker-missing code=200` × 2，rc=1）。成因在产品侧：判据找的字面量 `<title>Dashboard</title>` 已不在源码里，`packages/quay/src/serve-dashboard.ts:1403` 现在渲染 `<title>${pageTitle("Dashboard", opts.identity, opts.lang)}</title>`——即 `verify_http_surface` 的标记相对产品**已过期**。这是本任务 Touches 之外的既有缺陷，在此**点名而不夹带修**（该函数是纯 bash+curl，本次抽取未触碰它）。`usage_verify` 两台都是 `ok`。

### AC7 — catalog / 无新环 / 回归面

```
capability-catalog: 350 scripts | 350 declared | 0 unclassified | 345 ship     rc=0
import-graph: {"ok":true,"over":[],"baselineRaised":[],"headBaseline":{"valueSccs":0,"typeSccs":0,"reverseEdges":0},…}
```

新脚本的六行声明（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER）已进 `capability-catalog-declarations.json`；首次提交时因 QUESTION 值里带反引号被 `AC5 no-command-substitution` 挡下，改为纯文本后通过。

测试：`develop-deliver-tgz` / `develop-deliver-tgz-evidence-transport` / `develop-deliver-tgz-characterization` / `release-freshness-check` / `freshness-producer-coverage-check` 五个文件一起跑 `tests 65 / pass 65 / fail 0`。

`bash scripts/test.sh --for-task gap-arch-tsify-develop-deliver-tgz-python-heredocs --allow-thin` → **rc=0**（scoped 静态层 + 该任务的测试子集，`tests 34 / pass 34 / fail 0`）。

⚠️ **一处必须随之调整的既有测试**（在 Touches 内）：`develop-deliver-tgz-evidence-transport.test.mjs` 里有一个隔离夹具，把 `check_evidence_completeness()` 从源码**切片**出来在 `set -e` 下单独跑。该函数此前自足（判定来自 PATH 上的 `python3`），现在要经 `py_steps` 去 sibling CLI——夹具因此补两行：定义 `SCRIPT_DIR`、并把 `py_steps` **也从同一份源码切片**（⛔ 不重打一份，否则第二份会漂移、这个控制会静默停止测产品）。断言的仍是同三件事（`ALL-MISSING` / `VERDICT=1` / `AFTER-VERDICT`），没有放宽。

## Touches

- plugin/scripts/develop-deliver-tgz.sh
- plugin/scripts/develop-deliver-python-steps.ts (new)
- plugin/test/develop-deliver-tgz-characterization.test.mjs (new)
- plugin/test/develop-deliver-tgz.test.mjs
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- plugin/sh-census-baseline.json
- tasks/gap-arch-tsify-develop-deliver-tgz-python-heredocs.md

（若实现者把抽出的 `.ts` 拆成多个模块，新增文件仍属本任务 Touches，须在同一次编辑里补进本清单。实现未拆分：10 个 heredoc + 2 个 `-c` 全部落在 `plugin/scripts/develop-deliver-python-steps.ts` 一个文件里，故无需增补。）
