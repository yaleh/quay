---
id: gap-arch-quay-init-sh-python-heredocs-to-native
title: shell→TS（SPEC Phase 5.1 残余）：quay-init.sh 的 8 个内嵌 python3 heredoc 收进原生
  init.ts——gap-quay-init-native-reconcile 的「载体迁移暂缓」部分
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**`gap-quay-init-native-reconcile`（done）的 DoD 明写「载体迁移暂缓」：它把 `quay-init.sh` 从 2959 行缩到 2400 行、并给了 CLI/MCP 原生的 `init` 与 `--reconcile` 两个面（同一个 `runInit`），但 **`.sh` 至今仍是 `/quay:init` skill 实际执行的载体**（`plugin/skills/init/SKILL.md:16、:46` 自述 “Not yet wired into the script below”）。census 实测它仍内嵌 `node`+`python3`，有 8 个 `python3 … <<` heredoc（`quay-init.sh` 行 224/396/460/613/1056/1563/2059/2215 一带）。本任务把这 8 个 python3 heredoc 的职责收进原生实现，使 `.sh` 不再内嵌 python3。**

**⚠️ 一个必须先回答的设计点（SPEC-quay-init-reconcile §4 开放问题 4，至今未裁定）**：`quay-init.sh` 是**自举入口**——它要在 quay 还没装好时就能跑（`ensure_vendor_runtime` 自举），而原生 `runInit` 依赖已安装的 quay。所以「.sh 能否被**完全**删除，还是收缩成一个极小的自举 helper」是真问题。**本任务的范围只到「.sh 不再内嵌 python3」，不裁定整文件是否删除**；实现者须在 notes 里给出：自举路径今天依赖哪几个 heredoc、迁移后自举是否仍成立（在一个**没有 quay 的干净环境**里实测，⛔ 不得只在开发检出里验）。若发现某个 heredoc 在自举阶段不可替代，把它列为**有理由的保留项**并如实报告，而不是硬迁。

**冲突面**：`quay-init.sh` 同时被 `gap-arch-tsify-cross-machine-verify-sh` 调用（只碰调用点，优先零改动）。本任务是 `quay-init.sh` 的唯一改写者，其它任务不得改它的正文。**每个 heredoc 一个提交**，便于二分。

## AC

- [ ] AC1（枚举，先于改动）贴出 8 个 python3 heredoc 的清单：行号、作用、输入/输出契约、迁移落点（`init.ts` 里哪个函数 / 或「自举不可替代，保留」+ 理由）。缺一个即不合格。
- [ ] AC2（characterization 先于改写，取假）在**未改动**的旧 `quay-init.sh` 上先落盘：对一个临时 workspace 跑 `init`，把产生的**六文件面**（`.quay/config.yml`、`.quay/profiles.yml`、`tasks/`、`.gitignore`、`.claude/launch.settings.json`、`.claude/settings.json`）的内容与退出码钉住；对旧脚本注入一处行为改动该测试必须红，撤销后绿。两次输出贴进 notes。（既有 `plugin/test/quay-init*.test.mjs` 8 个文件先跑一遍，明确哪些已覆盖，缺口补测。）
- [ ] AC3（等价）迁移前后，同一组输入（全新目录 / 已有配置 / 损坏配置 / `--reconcile` / `--dry-run`，至少 5 类）产生的六文件面与退出码逐项一致（贴对照表）。
- [ ] AC4（目标读数）`sh-census-check.ts --json` 中 `plugin/scripts/quay-init.sh` 的 `embedded` 不含 `python3`（若某 heredoc 被有理由保留，则该条 AC 以 `NOT-EVALUATED` 标注并列出保留项，⛔ 不得用放宽判据顶替）；`plugin/sh-census-baseline.json` 只降不升地同步；前后读数各贴一次。
- [ ] AC5（自举，生产载体，硬规则 4 推论三）在一个**没有预装 quay 的干净环境**（新用户目录 + 只有 npm-pack 产物/插件 cache）里，从 `/quay:init` skill 的真实入口跑一遍，六文件面齐全（贴运行输出）；关掉 fixture 后仍成立。
- [ ] AC6（文案不成假话）`plugin/skills/init/SKILL.md:16、:46` 关于「逻辑在 quay-init.sh」「Not yet wired」的表述按落地后事实改写；`git diff` 可见。
- [ ] AC7（闭包棘轮与回归面）`plugin/test/quay-init-closure-ratchet.test.mjs` 与 `quay-init-laydown-closure.test.mjs` 全绿（改 `quay-init.sh` 会令闭包棘轮 stale，需按既有 re-anchor 流程重锚并写明）；`scripts/test.sh --for-task gap-arch-quay-init-sh-python-heredocs-to-native` 全绿。

## DoD

真实落地：从干净环境经真实入口跑通 `/quay:init`（AC5），六文件面与迁前逐项一致（AC3），census 中 `quay-init.sh` 不再内嵌 python3 或对保留项如实标注未评估（AC4）。自举是否仍成立有实测答案，而不是断言。

## Touches

- plugin/scripts/quay-init.sh
- packages/quay/src/init.ts
- packages/quay/src/cli/init.ts
- plugin/skills/init/SKILL.md
- plugin/test/quay-init.test.mjs
- plugin/test/quay-init-characterization.test.mjs (new)
- plugin/test/quay-init-closure-ratchet.test.mjs
- plugin/test/quay-init-laydown-closure.test.mjs
- plugin/sh-census-baseline.json
- plugin/scripts/capability-catalog-declarations.json
- tasks/gap-arch-quay-init-sh-python-heredocs-to-native.md

（`quay-init.sh` 改动会令 `plugin/quay-init-closure-baseline.json` 一类锚点 stale——实现者按既有 re-anchor 流程处理，并把实际触及的锚点文件在同一次编辑里补进本清单。）
