---
id: gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver
title: 0.16.0 init 不再写 native 的 path/mcp_entry，但 config validate 与 MCP
  config_validate 仍把 mcp_entry 当必填——官方 init 后立即 validate 失败（两套裁判分叉）
status: needs-human
labels:
  - gap
  - defect
  - priority:p1
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**症状(2026-10-06 在 cantus 实测,quay 0.16.0)**:`/quay:init` 把 `.quay/config.yml` 的 `providers.native.path` 与 `providers.native.mcp_entry` 迁移删除(日志理由:native provider 由 plugin root 解析);init 后 `.quay/plugin` 正确指向 user-scope 0.16.0、`task list`/`goal list`/`adr list` 均正常;但同版本的 `.quay/plugin/bin/quay config validate --root .` 与 MCP `config_validate` 都报 `providers.native — Enabled provider "native" is missing mcp_entry (must be a non-empty array)`。官方 init 的输出契约与官方 validator 互相矛盾。

**机制(已读代码)**:
1. 运行时:`packages/quay/src/config.ts` 的 `withNativeDefaults(providerId, entry)` 在 `providerId === "native"` 且 `path`/`mcp_entry` 缺省时,用 `resolvePluginRoot()`(`plugin-root.ts`)补出 `<插件根>/vendor/quay-native` 与 `["node", <dir>/dist/quay-native.js, "mcp"]`。所以运行时接受省略。
2. 验证器:`packages/quay/src/config-validate.ts` 的 `checkProviders`(约 227-243 行)读**原始 YAML**,对每个 `enabled: true` 的 provider 要求非空 `mcp_entry` 数组;该文件在合入 pointer 任务时不在 Touches 内,未同步。CLI 与 MCP 两个入口共用该检查(两处报错原文一致)。
3. 两套裁判:同一份 config,运行时的判断(经 `withNativeDefaults`)与验证器的判断(原始解析)各写一份,必然分叉。
4. 检查空转风险:`packages/quay/src/init.ts` 的 `providerEntryFile`(约 1796 行)在没有 `mcp_entry` 时返回空串;`plugin/scripts/quay-init.sh` 约 1261 行 verify-provider-runtime-existence 在此情形输出 "no mcp_entry path found … nothing to verify" 并通过——native 的 runtime 存在性检查现在对省略形态是假绿(与"查过且合格"同形,硬规则 3b)。`plugin/scripts/provider-binding-resolvability-check.ts` 与 `plugin/scripts/quay-init-closure-ratchet.ts` 也引用 `mcp_entry`,是否同类空转**尚未读**,本任务须先调查。
5. 解析失败:`mcp-server.ts:75`、`cli/shared.ts:176/198`、`serve.ts:619` 直接解构 `provider.mcp_entry`;`withNativeDefaults` 在插件根不可解析时原样返回,此时解构会抛 TypeError 而非清晰错误(读代码判断,未运行验证)。

**目标契约**:
- native provider 缺 `path`/`mcp_entry` ⇒ 合法,由 Core 经 `plugin-root.ts` 推导。
- 自定义 provider(非 native)缺 `mcp_entry` ⇒ 仍报错。
- 旧项目显式的 `path`/`mcp_entry` ⇒ 继续接受(不再由 init 生成);native 显式路径含 `/cache/quay/quay/<版本>/` ⇒ 给**警告**(版本被冻结,可删除以跟随插件);显式路径不存在 ⇒ 错误。
- native 且插件根不可解析 ⇒ 返回清晰、稳定的错误(稳定错误码 `native-provider-unresolvable`,信息含"省略了 path/mcp_entry 但找不到插件根"与修复提示),⛔ 不得 TypeError/崩溃,⛔ 不得发明路径。
- **单一裁判**:验证器复用运行时的 `withNativeDefaults`(或同一导出的解析函数)判断 provider 是否具备可启动的 `mcp_entry`,不再自己写一份。
- `/quay:init` 完成后立即 `config validate` 与 MCP `config_validate` 必须通过。
- `init.ts` 约 404-417 行模板注释/生成内容、`.quay/config.yml.example` 等文档中凡仍把 `mcp_entry` 描述为 native 必填之处同步更新。

**不在范围**:重新设计 provider schema;改写已完成的 gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it;`loop.board`/`loop.gates` 默认值缺口(另案)。

<!-- dedup-ref -->相关(追溯,非前置):gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it(done,引入 `withNativeDefaults` 与 init 迁移,其 Touches 漏了 config-validate.ts 且无"init 后 validate 通过"的 AC);gap-config-provider-path-frozen-to-versioned-cache-dir(done)。

## Touches
- `packages/quay/src/config-validate.ts`
- `packages/quay/src/config.ts`
- `packages/quay/src/init.ts`
- `packages/quay/src/mcp-server.ts`
- `packages/quay/src/cli/shared.ts`
- `packages/quay/src/serve.ts`
- `packages/quay/README.md`
- `plugin/scripts/quay-init.sh`
- `plugin/scripts/quay-init-steps.ts`
- `plugin/scripts/provider-binding-resolvability-check.ts`
- `plugin/scripts/quay-init-closure-ratchet.ts`
- `plugin/scripts/adr016-screen-use-check.ts`
- `.quay/config.yml.example`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `packages/quay/test/config-validate.test.mjs`
- `packages/quay/test/mcp-config-validate.test.mjs`
- `packages/quay/test/init.test.mjs`
- `plugin/test/provider-binding-resolvability-check.test.mjs`
- `plugin/test/quay-init-closure-ratchet.test.mjs`
- `plugin/test/adr016-screen-use-check.test.mjs`
- `plugin/sh-census-baseline.json`
- `tasks/gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver.md`

## AC
- [x] 往返测试(`packages/quay/test/init.test.mjs` 或同目录新增用例):用真 `.quay/config.yml` 的临时 workspace,先造一份含 native 显式 `path`/`mcp_entry` 与多行注释的旧 config,跑 init 迁移,再立即调用 `config validate`(CLI)与 MCP `config_validate`,两者都必须 exit 0 / 无 error;同时对一个全新 workspace 的 init 输出做同样断言。`node --experimental-strip-types --test packages/quay/test/init.test.mjs packages/quay/test/config-validate.test.mjs packages/quay/test/mcp-config-validate.test.mjs` 退出 0。取假:把 `checkProviders` 改回原样后往返用例红(附实跑输出)。
- [x] 验证器用例(`config-validate.test.mjs` 与 `mcp-config-validate.test.mjs` 各覆盖):native 无 `path`/`mcp_entry` ⇒ 无 error;自定义 provider(如 id `github`)enabled 且缺 `mcp_entry` ⇒ error 且字段为 `providers.github`;native 显式 `mcp_entry` ⇒ 继续通过;native 显式路径含 `/cache/quay/quay/<版本>/` ⇒ 仅 warning;native 显式路径不存在 ⇒ error。
- [x] 稳定错误:在插件根不可解析的夹具下(注入使 `resolvePluginRoot()` 返回 null),native 省略 `path`/`mcp_entry` 时,`config validate` 与 `mcp-server`/`cli/shared`/`serve` 的 provider 拉起路径都返回含稳定码 `native-provider-unresolvable` 的错误,且进程不以 TypeError 退出:断言 stderr/返回值不含 `TypeError` 与 `is not iterable`,退出码为约定的非 0 值。
- [x] 单一裁判:新增断言 `grep -n "mcp_entry" packages/quay/src/config-validate.ts` 中不再存在对原始 YAML `mcp_entry` 的独立必填判断(先打印改前基线命中与前 3 条以证明谓词能命中);并加一个性质测试:对一组配置语料(native 省略/显式、自定义缺/有、插件根可/不可解析),"验证无 error" ⇔ "`activeProvider()` 得到非空 `mcp_entry`"。
- [x] 不空转:迁移后(native 省略 `mcp_entry`)的 `quay-init.sh` verify-provider-runtime-existence 必须检查插件根解析出的 `<插件根>/vendor/quay-native/dist/quay-native.js` 存在:文件存在 ⇒ OK;删除该文件 ⇒ 失败(非 0);插件根不可解析 ⇒ 输出 `NOT-EVALUATED` 且与 OK 可区分。⛔ 不得再对省略形态输出 "nothing to verify" 通过。取假:恢复旧行为后"删除文件仍通过"的用例红(附实跑输出)。
- [x] 调查并落实同类空转:对 `plugin/scripts/provider-binding-resolvability-check.ts` 与 `plugin/scripts/quay-init-closure-ratchet.ts` 各用一份"native 省略 path/mcp_entry"的 config 夹具实跑,把输出原文贴进完成记录,逐一给出结论"空转/非空转"。若空转 ⇒ 在本任务内修复并在 `plugin/test/provider-binding-resolvability-check.test.mjs`、`plugin/test/quay-init-closure-ratchet.test.mjs` 增加用例(取假红);若非空转 ⇒ 记录证据即可,无需改动。
- [x] 文档与注释同步:`grep -n "mcp_entry" packages/quay/src/init.ts .quay/config.yml.example` 中,凡把 `mcp_entry` 描述为 native 必填之处已改为"native 可省略,由插件根推导;自定义 provider 必填";`packages/quay` 与 `plugin` 下其它文档(grep `mcp_entry` 于 `*.md`)若存在同类描述需一并更新,并在完成记录里列出命中与处理结果。
- [x] `quay-init.sh` 是 sh-census 棘轮收费文件:改动后代码行数不高于改前基线(行数中性或净减),`plugin/sh-census-baseline.json` 同步;`bash scripts/test.sh --for-task gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver` 退出 0 且执行了 ≥1 个测试文件。
- [x] 读生产载体:在本机一个已被 0.16.0 init 迁移过的真实项目副本(或 cantus 的只读拷贝到临时目录)上,用修复后的 `quay config validate --root <dir>` 与 MCP `config_validate` 实跑,读出无 `missing mcp_entry` 错误;原文贴进完成记录。该 AC 在撤销 `checkProviders` 改动后必须变红(负控制)。

## DoD
真实落地:一个刚被 0.16.0 `/quay:init` 迁移过的真实第三方项目,init 完成后立即运行 `quay config validate` 与 MCP `config_validate` 均通过;自定义 provider 缺 `mcp_entry` 仍被拒;插件根不可解析时得到稳定错误码而非崩溃;provider runtime 存在性检查在 runtime 文件缺失时真实失败。仅 fixture 绿不算完成。

## Evidence
**本轮(worker 续做,2026-10-06)——第 3 轮:前两轮 suite-red 的真因已定位并修复(落在本任务 delta 之外)**

前两轮 `exited-not-landed` 的 suite-red 是同一条断言:`plugin/test/adr016-screen-use-check.test.mjs:139` 的 `AssertionError: the vanished file must be RETURNED, not swallowed`(真因日志 `.quay/fan-in-suite-gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver~wk-prod-anchor~1791289501665-d89a49.log:14797`),`actual` 比 `expected` 多一条 `{rel:"tmp/workflow-journal-selftest-nzFRwk/plugin/scripts/gate-script-lib.sh",reason:"ENOENT"}`。

**机制**:`adr016-screen-use-check.ts` 的 `SKIP_DIRS` 不含 `tmp`,整树 walk 于是走进被 gitignore 的 repo-root `tmp/`(`.gitignore` 自述:"repo-root tmp/ is RUNTIME residue, not source");而 `run-identity.ts` / `stage-receipt.ts` / `workflow-journal.ts` 三个兄弟 selftest 都在 `<cwd>/tmp/` 下 mkdtemp 夹具,并把真 `plugin/scripts/gate-script-lib.sh` **拷贝**进去。walk 列出该拷贝后,夹具自身的 rm 落在 walk 与 read 之间 ⇒ 冒出**第二个** `unreadable` ENOENT,令"恰好一条"的 deepEqual 变红——失败原因与被测性质(消失文件是否被上报)无关。`fs-walk.ts` 的 `buildFileIndex` 早已为此剪掉 `tmp`,本检查器是漏剪的兄弟(硬规则 5b)。

**修复**:`SKIP_DIRS` 增 `"tmp"`(该集合按 basename 逐层剪枝;`git ls-files | grep -E '(^|/)tmp/'` 计数 = 0 ⇒ 不丢任何 tracked 文件);新增一条扫描面测试。

**实跑读数**:
- 绿:`node --no-warnings --experimental-strip-types --test plugin/test/adr016-screen-use-check.test.mjs` → `tests 19 / pass 19 / fail 0`。
- 取假(负控制,用 `cp` 备份还原,⛔ 未用 repo-global 的 `git stash`):从 `SKIP_DIRS` 摘掉 `"tmp"` 后同一命令 → `pass 18 / fail 1`,唯一红项正是新增的扫描面测试,`AssertionError: tmp/ is runtime residue, not the repo — scanning it double-counts a fixture copy of a real script`;还原后回 `19/19`。
- 生产载体(真树对照,同一 worktree):实放 `tmp/workflow-journal-selftest-nzFRwk/plugin/scripts/gate-script-lib.sh` 后跑 `adr016-screen-use-check.ts --root . --json` → `files_scanned: 156`;删掉该夹具后 → `files_scanned: 156`(**计数不变** ⇒ 该拷贝确未进入扫描面);两次均 `violations: 0`、`unreadable: []`,`--root .` 裸跑 `EXIT=0`。
- 本任务自带用例仍绿:`node --no-warnings --experimental-strip-types --test packages/quay/test/init.test.mjs packages/quay/test/config-validate.test.mjs packages/quay/test/mcp-config-validate.test.mjs` → `tests 127 / pass 127 / fail 0`。

**delta-relatedness 提示的处置**:机械判定把该红标为 UNRELATED(失败文件不在 Touches 内)。该判定是对的(它不是本任务 delta 引起的),但仍阻塞落地,故按 "foreign deterministic suite red ⇒ self-fix + widen Touches" 处理,而非当作环境噪声重掷。

**Touches 扩边说明**:`plugin/scripts/adr016-screen-use-check.ts` 与 `plugin/test/adr016-screen-use-check.test.mjs` 不在本任务原 Touches 内,但前两轮 fan-in suite-red 的真因落在此处,故纳入。二者与本任务的 config/init 改动无耦合。

### 补记(2026-10-06 续做第 4 轮)——AC6 / AC9 的原文读数(此前轮次只勾选、未落原文)

**AC6 — 两个同类检查器的实跑结论。** 夹具 `/tmp/ac6-fixture-lOUbBz/.quay/config.yml` 全文仅:

```
providers:
  native:
    enabled: true
    tasks_dir: "./tasks"
```

① `plugin/scripts/provider-binding-resolvability-check.ts --root <夹具>` 原文:

```
provider binding resolvability — /tmp/ac6-fixture-lOUbBz/.quay/config.yml
  [NOT-EVALUATED ] native: no-mcp-entry  token=null
NOT-EVALUATED: provider-binding-resolvability-check: no enabled provider with a judgeable runtime binding (1 provider(s), 1 not-evaluated) — nothing was judged
EXIT=3
```

结论:**非空转**。"无绑定可判"走独立取值 `NOT-EVALUATED`(exit 3),与 PASS(exit 0)/合格 不同形(硬规则 3b/6)。本任务在 `plugin/test/provider-binding-resolvability-check.test.mjs` 补了一条回归用例(scoped 门实跑可见:`native provider that OMITS path/mcp_entry is NOT-EVALUATED (exit 3), never PASS`)。

② `plugin/scripts/quay-init-closure-ratchet.ts` 原文(夹具读不到基线 ⇒ 独立第三态;真树 ⇒ 正常棘轮):

```
$ ... quay-init-closure-ratchet.ts --gate --root <夹具>
NOT-EVALUATED: quay-init-closure-ratchet: NOT-EVALUATED — baseline file missing (docs/analysis/quay-init-closure-ratchet.baseline.json); run --reanchor to create it (a checker that cannot read its baseline is never conflated with "≤ baseline")
EXIT=3
$ ... quay-init-closure-ratchet.ts --gate --root <worktree 真树,基线在>
PASS: quay-init laydown footprint 3 files / 1022 bytes ≤ baseline 3 files / 1022 bytes (shrink-only holds)
EXIT=0
```

结论:**非空转,且与本任务的 mcp_entry 面无关**。`grep -n "mcp_entry" plugin/scripts/quay-init-closure-ratchet.ts` 仅 1 条命中(`:84` 注释,讲 state 文件里嵌了随机绝对路径);该棘轮判的是 quay-init laydown 的文件数/字节数,不做 provider 绑定判定,读不到基线时给 `NOT-EVALUATED`(exit 3),从不与"≤ baseline"同形。按 AC6 的二分 ⇒ "非空转 ⇒ 记录证据即可,无需改动"(该文件不在本任务 diff 内)。

**AC9 — 真实生产载体(cantus)实跑。** 载体 `/data/home/yale/work/cantus`(真实第三方项目,已被 0.16.0 init 迁移:`providers.native` 无 `path`/`mcp_entry`,`.quay/plugin -> ~/.claude/plugins/cache/quay/quay/0.16.0`)。用修复后的 worktree 代码跑:

```
$ node --experimental-strip-types packages/quay/bin/quay.js config validate --root /data/home/yale/work/cantus
Config valid.
EXIT=0
$ node ... quay.js config validate --json --root /data/home/yale/work/cantus
[]
EXIT=0
```

MCP `config_validate` 路径(`mcp-handlers.ts` 是该函数 `validateConfig({workspaceRoot})` 的薄透传,同一真实 config):

```
validateConfig(workspaceRoot=/data/home/yale/work/cantus)
{ "ok": true, "issues": [] }   EXIT=0
```

**负控制(取假)**:用 `cp` 备份 `config-validate.ts`,把 `checkProviders` 临时改回"读原始 YAML 的 `mcp_entry`"后,同一 CLI 跑同一 cantus:

```
error: providers.native — Enabled provider "native" is missing mcp_entry (must be a non-empty array)
  suggestion: Add mcp_entry: ["node", "./bin/<provider>.ts", "mcp"] to this provider
1 error(s) found.
EXIT=1
```

还原(cp,md5 与备份一致 `4b803ff1c62e729a30416eb65ab37e3d`)后回 `Config valid.` / EXIT=0 ⇒ AC9 的取假判据成立。

**本轮落地前的门**:预合并 `git merge --no-edit develop` 干净(无冲突);scoped 门 `bash scripts/test.sh --for-task <id> --allow-thin` → `tests 286 / pass 286 / fail 0`,EXIT=0;`plugin/test/adr016-screen-use-check.test.mjs` → `19/19`。
## Needs-Human

**执行 2026-10-06T13:35:26.985Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：the exited-not-landed failure could not be attributed in 2 consecutive rounds (bounded to at most one retry; no mechanical fan-in result on the outcome ⇒ no suite ran) — infra/contract suspected, not an implementable defect (parser attributed no failing file (failure-line count unavailable on this judgment)); stopping instead of spending another worker session
- 失败步/判词：adopted orphan worker exited (exit code unobservable) — task status=ready (not done) and leftover worktree task/gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver still present
- run_id：wk-prod-anchor
