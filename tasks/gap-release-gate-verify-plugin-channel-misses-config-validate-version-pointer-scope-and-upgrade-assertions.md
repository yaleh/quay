---
id: gap-release-gate-verify-plugin-channel-misses-config-validate-version-pointer-scope-and-upgrade-assertions
title: 发布门禁 verify-plugin-channel 只证明"装得上、driver 活、serve 有 HTTP 响应"，放过了 init 后
  config validate 失败、版本不一致、指引链接、serve 独立 scope 等真实回归——把这些断言做成同一份可本地复演的实现并接进门禁
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
**背景(人 2026-10-06 同意)**:发布与安装的唯一渠道是 Claude Code plugin(README "Install channels: what changed on 2026-09-16":人 2026-09-16 裁定取消 npm 与 SEA release,「按照 claude code plugin 发布和安装。CI 应当按此设计。」);`.github/workflows/release.yml` 的 `verify-plugin-channel` job 是唯一发布门禁。

**门禁现状(已读 release.yml,约 80-272 行)**:在 tag 的树上用 `plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify`(不 push)构建 → `git archive` 取出 → 在 scratch 项目里 `claude plugin marketplace add` + `claude plugin install quay@quay --scope project -y` → `CLAUDE_PLUGIN_ROOT=<安装目录> bash <安装目录>/scripts/quay-init.sh --all --loop …` → 起 promotion 与 worker 两个 driver 并断言 `driver status --json` 的 `alive == 1` → `quay serve --host 127.0.0.1 --port <随机>` 并轮询 HTTP。它**没有**检查:
1. init 完成后 `quay config validate` 与 MCP `config_validate`——**真实回归已放过**:0.16.0 的 init 去掉了 native 的 `mcp_entry`,而 validator 仍要求必填,官方 init 后立即 validate 失败(任务 gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver);
2. `quay --version` / `plugin.json` / `VERSION` 三者一致且不含 `-dev`(0.14.0 缓存实测 `quay --version` 输出 0.14.0-dev,因为 bundle 内嵌值在 stamp 之前生成;任务 gap-release-bundle-embeds-dev-version-after-stamp);
3. `.quay/plugin` 指向安装目录、config 不含 native 的 `path`/`mcp_entry`(任务 gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it);
4. `driver status --json` 的 `loaded_version`/`pointer`/`path_quay_version` 读数;
5. serve 宿主的 cgroup 是独立 `quay-serve-*.scope`、`.quay/serve.log` 有输出、`quay server status` 的 `loaded_version`(任务 gap-serve-host-spawned-in-caller-session-cgroup-dies-when-cloudcli-restarts 及相关);
6. user scope 安装形态(门禁只测 `--scope project`,而作者本机与多数使用者是 user scope);
7. 升级路径(装上一个已发布版 → 以新构建更新 → 重跑 `/quay:init`):README "Upgrading the quay plugin" 的步骤,历史上最常出问题的路径。
门禁只证明"能装、能起、有响应",读数与"产物正确"之间隔着上面这些未检查项(硬规则 3b / 4c:判据没覆盖要验的量)。

**修法**:
(A) 新增**一份**断言实现(⛔ 不把断言内联写进 release.yml 的 YAML run 块,避免只能在 CI 上跑、本地无法复演、且每个断言写两遍):一个可独立运行的脚本,输入为 `--installed <插件安装目录> --project <scratch 项目目录> --scope user|project`,逐条输出断言 id 与 `PASS`/`FAIL`/`NOT-EVALUATED`(读不到输入 ⇒ `NOT-EVALUATED` 并给原因,⛔ 不与 PASS 同形),任一 FAIL 退出非 0,存在 NOT-EVALUATED 时退出码与全 PASS 可区分。断言集合至少覆盖上面 1-6 项;每条断言写明它读的是什么直接量(版本取各目录的 `VERSION`/`plugin.json`,⛔ 不用被测对象自报)。
(B) `release.yml` 的 `verify-plugin-channel` 在现有步骤之后调用该脚本,**对 `--scope project` 与 `--scope user` 各装一遍并各跑一次**(user scope 在 GitHub 托管 runner 或 tokyo-alpha 上是否可行未验证,实现者先实测;不可行则在 job 注释里写明原因,并保留本地复演入口)。
(C) 升级演练(第 7 项)提供**本地模式**:`--upgrade-from <上一版已构建的插件树>`;CI 里是否运行需要私有仓库认证,本任务只要求本地可复演并有夹具测试,CI 集成不在范围。
(D) 该脚本也是"发布前本地演练"的入口:README 或 `plugin/skills/init/SKILL.md` 旁的发布文档补一段"发布前如何本地运行该脚本"。⛔ 不新增第二套发布门禁。
注意:断言所覆盖的若干任务(config-validate、serve 独立 scope、serve loaded_version、workflow `pluginRoot`)在本任务写作时可能尚未落地——这会让**真实发布门禁**在它们落地前为红,这是预期且正确的;但**套件里的测试**必须用夹具,不得依赖未落地的功能。

**不在范围**:修复上述被断言的缺陷本身(各有任务);改变门禁的触发方式(`workflow_dispatch` only)与 runner;npm/SEA 渠道。

<!-- dedup-ref -->相关(追溯,非前置):gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver、gap-release-bundle-embeds-dev-version-after-stamp、gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it、gap-serve-host-spawned-in-caller-session-cgroup-dies-when-cloudcli-restarts(各自被本任务的断言覆盖,本任务不修它们);gap-first-green-release-and-master-ff(done,门禁与 advance-master 的来源)。

## Touches
- `.github/workflows/release.yml`
- `plugin/scripts/verify-plugin-channel-assertions.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/verify-plugin-channel-assertions.test.mjs`
- `README.md`
- `tasks/gap-release-gate-verify-plugin-channel-misses-config-validate-version-pointer-scope-and-upgrade-assertions.md`

## AC
- [ ] 新增 `plugin/scripts/verify-plugin-channel-assertions.ts`(若实现者选择别的语言/位置,须在完成记录说明原因,且仍满足新增脚本的全部登记门:capability-catalog 六张表、outline 等;参照 `plugin/scripts/capability-catalog.sh` 头注释的条目格式),输入 `--installed`/`--project`/`--scope`,逐条输出断言 id 与 PASS/FAIL/NOT-EVALUATED;输出末尾打印 `passed=<n> failed=<n> not-evaluated=<n>`。
- [ ] `plugin/test/verify-plugin-channel-assertions.test.mjs` 用夹具(临时"安装目录"与 scratch 项目)覆盖每条断言的 PASS 与 FAIL 两面:①config 缺 `mcp_entry` 且 validator 拒绝 ⇒ FAIL;②`quay --version` 输出含 `-dev` 而 `plugin.json` 无 ⇒ FAIL;③`.quay/plugin` 指向别的版本目录 ⇒ FAIL;④serve 宿主 cgroup 不是 `quay-serve-*.scope` ⇒ FAIL;⑤读不到输入(安装目录缺 plugin.json)⇒ NOT-EVALUATED 且退出码与全 PASS 不同。`node --experimental-strip-types --test plugin/test/verify-plugin-channel-assertions.test.mjs` 退出 0。取假:把某条断言的判定改成恒 PASS 后对应 FAIL 用例红(附实跑输出)。套件内测试只用夹具,不依赖未落地的功能。
- [ ] 真样本干跑:对本机已安装的 0.16.0(`~/.claude/plugins/cache/quay/quay/0.16.0`)与一个已 init 的 scratch 项目实跑该脚本,把完整输出贴进完成记录;**已知会因 0.16.0 的 validator 回归而在 config validate 断言上 FAIL**——该 FAIL 必须真实出现(证明断言能抓到已放过的回归,而不是零命中)。
- [ ] `release.yml` 的 `verify-plugin-channel` 在现有步骤后调用该脚本;`grep -n "verify-plugin-channel-assertions" .github/workflows/release.yml` 命中调用点,且断言逻辑**不**内联在 YAML 里(`grep -c "config validate" .github/workflows/release.yml` 的断言相关命中为 0;先打印改前基线)。对 `--scope project` 与 `--scope user` 的处理按修法(B)落实,user scope 不可行时 job 注释写明实测原因。
- [ ] 本地复演入口:README(或发布文档)写明命令;在一次性 clone 中按文档从 `publish-dist-branch.sh --branch plugin-channel-verify` 构建 → `git archive` → 临时 HOME 下装 → 跑脚本,把完整命令与输出贴进完成记录(⛔ 不在真实 `~/.claude` 上操作,不 push,不触发真实 `release.yml`)。
- [ ] 升级演练本地模式:`--upgrade-from <上一版插件树>`,夹具测试覆盖"链接指向旧版 ⇒ init 后指向新版 ⇒ validate 通过"的断言序列及其 FAIL 面。
- [ ] 登记与棘轮:新增脚本触发的 capability-catalog 六张表、outline、sh-census(若涉及 `.sh`)、import-graph 等静态检查全部通过;`bash scripts/test.sh --for-task gap-release-gate-verify-plugin-channel-misses-config-validate-version-pointer-scope-and-upgrade-assertions` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:对一个真实构建的发布形态插件树(release/* 形态,版本已 stamp),在隔离环境里按 project 与 user 两种 scope 安装并跑该脚本,读数全为 PASS;而对 0.16.0 这类已知有回归的产物跑同一脚本,config validate 等断言真实 FAIL。门禁里的调用与本地复演使用同一份实现。仅 fixture 绿不算完成。
