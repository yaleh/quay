---
id: gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script
title: CLI 单独完成全新安装的完整闭集写入与项目值检测（把 quay-init.sh 的写入者与检测搬进 TS，遗留检查直接删除而不是搬）
status: todo
labels:
  - gap
  - priority:p2
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-init-surface-unified-no-reconcile-no-force-json-report-serve-defaults-unwritten
goal_ac: AC-331
---
## Proposal
GOAL-029「init 统一为单一 TS 引擎、终局无 .sh;并收窄发布集合」(人 2026-10-07 裁定)。已定决策:终局无 .sh,过渡期 `quay-init.sh` 缩成调用 `bin/quay init` 的垫片(方向:脚本→CLI,不是 CLI→脚本);状态自动决定。判据权威定义:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-331 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`(退出 0 = 达成)。

现状(已读):`quay-init.sh` 的 `write_config`(新装 heredoc)、`detect_test_command`、`detect_tmux_session`、`validate_worktree_root`、`write_profiles_template`、`ensure_gitignore`、`ensure_runtime_artifacts_gitignore`、`write_template`(launch.settings.json)、`write_claude_settings`、`print_install_steps`、`auto_commit_laid_down`、`ensure_target_branch_model` 是 CLI 缺的职责;`init.ts` 已有 `writeClaudeSettings`、`ensureBranchModel`、`refreshProjectPluginLink`;CLI 当前全新写入缺 `.claude/settings.json`、`.gitignore`、`goals/`、安装说明、检测与自动提交(实测 `quay init --root <空仓库>` 缺 `.claude/settings.json`)。脚本里的遗留检查(`derive_loop_scripts`/`verify_referenced_landed`/`compute_drift_report`/`compute_dependency_closure_gaps`/`report_closed_set_state`/闭集指纹/`ensure_vendor_runtime`——后者仅开发树需要)不搬,直接删除;删除前确认其消费者:`plugin/scripts/laydown-set-check.sh` 目前 `source` 脚本取 `derive_loop_scripts`,需改为调用 TS 步骤(`quay-init-steps.ts derive-loop-scripts` 已存在)。

修法:在 `init.ts`/`cli/init.ts` 补齐全新安装的全部写入(config 对空文档应用与升级相同的流水线,不再保留与升级分叉的第二个 heredoc 写者)、检测(测试命令来自 package.json scripts.test 等、tmux 会话、worktree 根校验)、`.gitignore`(含运行时状态条目)、profiles/launch.settings 模板、`goals/` 与 `tasks/` 目录、`.claude/settings.json`、安装说明文本、可选 `--auto-commit-config`、`.quay/plugin` 链接;给 CLI 补齐 `--project`、`--test-command`、`--tmux-session`、`--worktree-root`、`--repo-root`、`--plugin-root`、`--auto-commit-config` 等参数(语义与现脚本一致)。全新写入与升级共用同一份"默认值表"(镜像测试 `plugin/test/quay-init.test.mjs` 对 heredoc 与 `LOOP_VERSION_DEFAULTS` 的钉住随 heredoc 消失而改为对单一来源的断言)。

## AC
- [ ] AC-331 的判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-331 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`。
- [ ] 取假:删掉 `.claude/settings.json` 的写入或 goals/ 目录创建后判据对应分支变红(附实跑输出)。
- [ ] 契约等价:对同一组输入(含 `--test-command`/`--tmux-session`/`--worktree-root`/无 tmux 主机/不可检测测试命令),CLI 的全新安装输出的闭集文件与既有 `plugin/test/quay-init*.test.mjs` 对脚本断言的内容等价——这些测试改为通过 CLI 跑同一组断言并全部通过(逐个列出迁移的用例,保留原意图,不得删用例换绿)。
- [ ] `plugin/scripts/laydown-set-check.sh` 不再 `source` `quay-init.sh`;`grep -n "quay-init.sh" plugin/scripts/laydown-set-check.sh` 排除注释后命中数为 0(先打印改前基线);`node --experimental-strip-types --test plugin/test/laydown-set-check.test.mjs` 不比改前更红(该文件在 develop 上本就有 1 个失败,2026-10-07 实测 8/9,完成记录里写明改前改后读数)。
- [ ] 遗留检查删除的证据:完成记录列出被删除的每个函数及其消费者检索结果(grep 命中数),确认无活消费者。
- [ ] `bash scripts/test.sh --for-task gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:用发布形态产物对一个只有 package.json 的空 git 仓库(临时目录,隔离 HOME)运行 CLI `init` 的全新安装,闭集全部写出、`quay config validate` 与发布门禁断言脚本 `plugin/scripts/verify-plugin-channel-assertions.ts --installed … --project … --scope user` 通过(其中 init 仍可经脚本垫片或直接经 CLI 完成);原始输出贴进完成记录。仅 fixture 绿不算完成。

## Touches
- `packages/quay/src/init.ts`
- `packages/quay/src/cli/init.ts`
- `packages/quay/src/branch-model.ts`
- `plugin/scripts/quay-init-steps.ts`
- `plugin/scripts/laydown-set-check.sh`
- `plugin/test/quay-init.test.mjs`
- `plugin/test/quay-init-tmux-detection.test.mjs`
- `plugin/test/quay-init-loop.test.mjs`
- `plugin/test/laydown-set-check.test.mjs`
- `packages/quay/test/init.test.mjs`
- `tasks/gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script.md`
