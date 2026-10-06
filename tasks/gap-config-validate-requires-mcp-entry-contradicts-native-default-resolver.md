---
id: gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver
title: 0.16.0 init 不再写 native 的 path/mcp_entry，但 config validate 与 MCP
  config_validate 仍把 mcp_entry 当必填——官方 init 后立即 validate 失败（两套裁判分叉）
status: todo
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
- `plugin/scripts/quay-init.sh`
- `plugin/scripts/provider-binding-resolvability-check.ts`
- `plugin/scripts/quay-init-closure-ratchet.ts`
- `.quay/config.yml.example`
- `packages/quay/test/config-validate.test.mjs`
- `packages/quay/test/mcp-config-validate.test.mjs`
- `packages/quay/test/init.test.mjs`
- `plugin/test/provider-binding-resolvability-check.test.mjs`
- `plugin/test/quay-init-closure-ratchet.test.mjs`
- `plugin/sh-census-baseline.json`
- `tasks/gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver.md`

## AC
- [ ] 往返测试(`packages/quay/test/init.test.mjs` 或同目录新增用例):用真 `.quay/config.yml` 的临时 workspace,先造一份含 native 显式 `path`/`mcp_entry` 与多行注释的旧 config,跑 init 迁移,再立即调用 `config validate`(CLI)与 MCP `config_validate`,两者都必须 exit 0 / 无 error;同时对一个全新 workspace 的 init 输出做同样断言。`node --experimental-strip-types --test packages/quay/test/init.test.mjs packages/quay/test/config-validate.test.mjs packages/quay/test/mcp-config-validate.test.mjs` 退出 0。取假:把 `checkProviders` 改回原样后往返用例红(附实跑输出)。
- [ ] 验证器用例(`config-validate.test.mjs` 与 `mcp-config-validate.test.mjs` 各覆盖):native 无 `path`/`mcp_entry` ⇒ 无 error;自定义 provider(如 id `github`)enabled 且缺 `mcp_entry` ⇒ error 且字段为 `providers.github`;native 显式 `mcp_entry` ⇒ 继续通过;native 显式路径含 `/cache/quay/quay/<版本>/` ⇒ 仅 warning;native 显式路径不存在 ⇒ error。
- [ ] 稳定错误:在插件根不可解析的夹具下(注入使 `resolvePluginRoot()` 返回 null),native 省略 `path`/`mcp_entry` 时,`config validate` 与 `mcp-server`/`cli/shared`/`serve` 的 provider 拉起路径都返回含稳定码 `native-provider-unresolvable` 的错误,且进程不以 TypeError 退出:断言 stderr/返回值不含 `TypeError` 与 `is not iterable`,退出码为约定的非 0 值。
- [ ] 单一裁判:新增断言 `grep -n "mcp_entry" packages/quay/src/config-validate.ts` 中不再存在对原始 YAML `mcp_entry` 的独立必填判断(先打印改前基线命中与前 3 条以证明谓词能命中);并加一个性质测试:对一组配置语料(native 省略/显式、自定义缺/有、插件根可/不可解析),"验证无 error" ⇔ "`activeProvider()` 得到非空 `mcp_entry`"。
- [ ] 不空转:迁移后(native 省略 `mcp_entry`)的 `quay-init.sh` verify-provider-runtime-existence 必须检查插件根解析出的 `<插件根>/vendor/quay-native/dist/quay-native.js` 存在:文件存在 ⇒ OK;删除该文件 ⇒ 失败(非 0);插件根不可解析 ⇒ 输出 `NOT-EVALUATED` 且与 OK 可区分。⛔ 不得再对省略形态输出 "nothing to verify" 通过。取假:恢复旧行为后"删除文件仍通过"的用例红(附实跑输出)。
- [ ] 调查并落实同类空转:对 `plugin/scripts/provider-binding-resolvability-check.ts` 与 `plugin/scripts/quay-init-closure-ratchet.ts` 各用一份"native 省略 path/mcp_entry"的 config 夹具实跑,把输出原文贴进完成记录,逐一给出结论"空转/非空转"。若空转 ⇒ 在本任务内修复并在 `plugin/test/provider-binding-resolvability-check.test.mjs`、`plugin/test/quay-init-closure-ratchet.test.mjs` 增加用例(取假红);若非空转 ⇒ 记录证据即可,无需改动。
- [ ] 文档与注释同步:`grep -n "mcp_entry" packages/quay/src/init.ts .quay/config.yml.example` 中,凡把 `mcp_entry` 描述为 native 必填之处已改为"native 可省略,由插件根推导;自定义 provider 必填";`packages/quay` 与 `plugin` 下其它文档(grep `mcp_entry` 于 `*.md`)若存在同类描述需一并更新,并在完成记录里列出命中与处理结果。
- [ ] `quay-init.sh` 是 sh-census 棘轮收费文件:改动后代码行数不高于改前基线(行数中性或净减),`plugin/sh-census-baseline.json` 同步;`bash scripts/test.sh --for-task gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver` 退出 0 且执行了 ≥1 个测试文件。
- [ ] 读生产载体:在本机一个已被 0.16.0 init 迁移过的真实项目副本(或 cantus 的只读拷贝到临时目录)上,用修复后的 `quay config validate --root <dir>` 与 MCP `config_validate` 实跑,读出无 `missing mcp_entry` 错误;原文贴进完成记录。该 AC 在撤销 `checkProviders` 改动后必须变红(负控制)。

## DoD
真实落地:一个刚被 0.16.0 `/quay:init` 迁移过的真实第三方项目,init 完成后立即运行 `quay config validate` 与 MCP `config_validate` 均通过;自定义 provider 缺 `mcp_entry` 仍被拒;插件根不可解析时得到稳定错误码而非崩溃;provider runtime 存在性检查在 runtime 文件缺失时真实失败。仅 fixture 绿不算完成。
