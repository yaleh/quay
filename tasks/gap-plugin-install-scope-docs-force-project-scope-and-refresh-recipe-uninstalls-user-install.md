---
id: gap-plugin-install-scope-docs-force-project-scope-and-refresh-recipe-uninstalls-user-install
title: 面向其它项目的安装文档把 project scope 当唯一正路，刷新配方会卸载使用者的 user scope 安装；升级流程无文档
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**机制**:面向第三方项目的安装/刷新说明把 `--scope project` 写成唯一正确做法,而 AC-161 的判据代码(`goals/AC-161-user-level-marketplace-only.md`)只拦 quay 的 **dev 渠道**(quay-dev / 目录源)与 `env` 里的 quay 路径,**明确允许** 用户级 `enabledPlugins["quay@quay"]`(发布渠道)。文档比判据严。人 2026-10-06 裁定:对其它应用 quay 驱动开发的项目,**不应强调 project scope 安装**;使用者在本机做 user scope 安装;AC-161 与 SPEC §4b 的适用范围限定为 quay 自己的 dev 渠道(该裁定的文档部分已由人另行提交,不在本任务)。

**已读到的具体位置(2026-10-06)**:
1. `plugin/skills/init/SKILL.md`(约 85-129 行):"Always pass `--scope`" 并给三步配方——查记录所在 scope → 在该 scope **卸载** → `install --scope project -y`。对已 user scope 安装的使用者,照做就是卸载其 user 安装并换成 project 安装。
2. `README.md`(约 246-252 行):`claude plugin install quay@quay --scope project`,并把 user scope 写成"只有你确实需要才用"。
3. `plugin/scripts/quay-init.sh`(约 1811-1827 行,安装说明 heredoc,只打印不执行):同样 `--scope project` 与卸载再装配方,并称 `--scope user` 会让 AC-161 变红(与判据代码不符)。
4. 升级流程:仓库内只有 `init/SKILL.md:129` 一处提到 `plugin update --scope project` 在版本不变时不重建;没有"升级已安装项目"的步骤文档,也没有"升级后重跑 `/quay:init` 以刷新 `.quay/plugin` 链接"的说明(该链接由 gap-config-provider-path-frozen-to-versioned-cache-dir 引入,已 done)。

**修法**:(1) 文档改为 scope 中立:说明 user scope = 整机一个版本、升级一处;project/local scope = 按项目开关或固定版本;不再写 "Always project"。(2) 删除"卸载再装到 project"配方,改为"先 `claude plugin list --json` 查记录所在 scope,再在**该 scope** 原地 `claude plugin update quay@quay --scope <scope>`,更新后重跑 `/quay:init` 刷新 `.quay/plugin` 链接";`plugin update` 在 user 与 project 两种 scope 下的真实行为必须先实测再写入文档。(3) `quay-init.sh` 的安装说明 heredoc 同步改为检测已有 scope、已安装则不跨 scope 卸载重装;去掉"`--scope user` 会让 AC-161 变红"的不实表述,仅对 quay-dev 目录源保留禁令。⛔ `quay-init.sh` 是 sh-census 棘轮收费文件,代码行数只降不升,改动必须行数中性或净减。

<!-- dedup-ref -->相关(追溯,非前置):gap-ac161-5th-regression-refresh-recipe-not-scope-complete(done,配方的来源);gap-config-provider-path-frozen-to-versioned-cache-dir(done,引入 `.quay/plugin` 链接);gap-ac264-quay-fleet-project-scope-plugin-only-deployment(project scope 的单项目部署)。

## Touches
- `README.md`
- `plugin/skills/init/SKILL.md`
- `plugin/scripts/quay-init.sh`
- `plugin/test/quay-init.test.mjs`
- `plugin/sh-census-baseline.json`
- `tasks/gap-plugin-install-scope-docs-force-project-scope-and-refresh-recipe-uninstalls-user-install.md`

## AC
- [ ] `grep -nE "Always pass .--scope.|只有你确实需要|scope user only if you mean it" README.md plugin/skills/init/SKILL.md` 命中数为 0(先打印命中前 3 条以证明谓词对改前文本能命中;改前基线读数贴进完成记录)。
- [ ] `plugin/skills/init/SKILL.md` 与 `README.md` 中不再出现"卸载后 `install --scope project -y`"的连续配方:`grep -n "uninstall quay@quay --scope" plugin/skills/init/SKILL.md plugin/scripts/quay-init.sh` 命中数为 0。
- [ ] `plugin/test/quay-init.test.mjs` 新增用例:捕获 `quay-init.sh` 的安装说明输出,断言其不含 `uninstall quay@quay`、不含"reddens the STANDING goal AC-161"、且含"update"与"/quay:init"升级提示;`node --experimental-strip-types --test plugin/test/quay-init.test.mjs` 退出 0。取假:把说明改回原卸载配方后该用例红(附实跑输出)。
- [ ] 实测记录:在本机对一个 user scope 安装与一个 project scope 安装各实跑一次 `claude plugin update quay@quay --scope <scope>`(或在临时 CLAUDE_CONFIG_DIR 下),把命令、退出码、前后 `installed_plugins.json` 该条目差异原文贴进完成记录;文档中的升级步骤必须与该实测一致。
- [ ] `bash plugin/scripts/sh-census-check.ts` 对应检查(或 `bash scripts/test.sh --for-task gap-plugin-install-scope-docs-force-project-scope-and-refresh-recipe-uninstalls-user-install`)退出 0,且 `quay-init.sh` 的代码行数不高于改前基线。

## DoD
真实落地:一个 user scope 安装了 quay@quay 的真实使用者,按改写后的 README / `/quay:init` 说明完成一次升级,全程没有被引导卸载其 user 安装,升级后 `.quay/plugin` 指向新版本目录。仅文档文本变化而无实测记录不算完成。
