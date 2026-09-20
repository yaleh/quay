---
id: gap-arch-quay-init-sh-python-heredocs-to-native
title: shell→TS（SPEC Phase 5.1 残余）：quay-init.sh 的 8 个内嵌 python3 heredoc 收进原生
  init.ts——gap-quay-init-native-reconcile 的「载体迁移暂缓」部分
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-314
---
## Proposal

**`gap-quay-init-native-reconcile`（done）的 DoD 明写「载体迁移暂缓」：它把 `quay-init.sh` 从 2959 行缩到 2400 行、并给了 CLI/MCP 原生的 `init` 与 `--reconcile` 两个面（同一个 `runInit`），但 **`.sh` 至今仍是 `/quay:init` skill 实际执行的载体**（`plugin/skills/init/SKILL.md:16、:46` 自述 "Not yet wired into the script below"）。census 实测它仍内嵌 `node`+`python3`，有 8 个 `python3 … <<` heredoc（`quay-init.sh` 行 224/396/460/613/1056/1563/2059/2215 一带）。本任务把这 8 个 python3 heredoc 的职责收进原生实现，使 `.sh` 不再内嵌 python3。**

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

## Notes（实现者填：AC1 枚举 + 各 AC 证据）

### AC1 — 枚举（先于改动，实测 12 处，不只是 8 个 heredoc）

`grep -n python3 plugin/scripts/quay-init.sh` 在改动前给出 **12 个命令位置**：任务正文点的 8 个 heredoc 之外，还有 4 个 `python3 -c` 单行——**AC4 的判据是全量 `embedded` 不含 python3，所以 12 个都必须走**。逐个落点（全部迁进 `packages/quay/src/init.ts`，由新兄弟 `plugin/scripts/quay-init-steps.ts` 分发）：

| 原行 | 形态 | 作用 | 契约 | 迁移落点 |
|---|---|---|---|---|
| 224 | heredoc | `read_existing_loop_value <key>`：读已有 config 的 `loop.<key>` | argv: cfg+key → stdout 一个值（缺/坏 ⇒ 空），exit 0 | `readExistingLoopValue` |
| 271 | `-c` | 读 `plugin.json` 的 `version` | argv → stdout，坏 ⇒ 调用方兜 `unknown` | `readJsonField` |
| 272 | `-c` | 读 `plugin.json` 的 `name` | 同上，兜 `quay` | `readJsonField` |
| 312 | `-c` 块 | `detect_test_command` 的 package.json 梯级：`scripts.test` 是非空字符串？ | exit 0/1（**谓词**，不打印） | `hasNpmTestScript` |
| 396 | heredoc | `ensure_loop_config`：合并/更新 4 个 fast-mode 值，值未变则**不写** | argv 6 个；stdout 三态报告行；改写整个 YAML 文档 | `ensureLoopConfig` |
| 460 | heredoc | `ensure_provider_carrier_env`：按缩进把缺的 carrier 键插进 `providers.native.env` | argv 3 个；逐键报告行；**行级**插入，绝不 yaml 往返 | `ensureProviderCarrierEnv` |
| 613 | heredoc | `migrate_stale_mcp_entry`：把陈旧/悬空/legacy 的 provider 绑定迁到插件 vendored 运行时；退役无引用且陈旧的 `.quay/runtime` | argv 7 个；四态 fate 行 + `migrated:`/`would-migrate:` 行；改写整个 YAML 文档 | `migrateStaleMcpEntry` |
| 1056 | heredoc | `_derive_loop_scripts_once` 的依赖闭包定点迭代 | argv: out+pluginRoot+neverLaydown；重写 out 文件 | `deriveLoopScriptsClosure` |
| 1442 | `-c` | 读 `vendor/quay/package.json` 的 `version`（与 bundle 内嵌版本比对） | argv → stdout，坏 ⇒ 空 | `readJsonField` |
| 1563 | heredoc | `verify_provider_runtime_existence` 读 `mcp_entry[1]` | argv → stdout（缺 ⇒ 空） | `providerEntryFile` |
| 2059 | heredoc | `write_claude_settings`：读改写 `.claude/settings.json` | argv: dst+pluginName；`json.dump(indent=2)`+换行 | `writeClaudeSettings` |
| 2215 | heredoc | 读 `loop.worktree_root`（与 224 同契约，原先是第二份内联副本） | 同 224 | `readExistingLoopValue`（复用，不再有两份） |

**没有「自举不可替代」的保留项**：见下面的 AC5——12 处全部可迁，`.sh` 现在 `embedded=[node]`。

### AC5 补充（Proposal 点名必须回答的设计点）

- **自举路径原先依赖哪几个 heredoc**：`read_existing_loop_value`（224，在 240/247 行于 **source 期**就会跑）、271/272（plugin 版本/名）、2215（worktree_root）、以及 `write_claude_settings`（2059）——即**前四个**是自举必需的，其余在写路径中才跑。
- **迁移后自举仍成立，实测**：`bash packages/quay/scripts/package.sh` 出真 npm-pack 产物 → 解包到独立目录 → `env -i HOME=<新目录> PATH=<只有 node+git+coreutils 的 PATH，且最前面放一个 `exit 127` 的 python3/python 假体>` → 从 SKILL.md 记录的真实入口跑 `bash <plugin>/scripts/quay-init.sh --root <proj> --plugin-root <plugin> --test-command … --repo-root … --worktree-root … --auto-commit-skip`：**rc=0，六文件面齐全，python3 假体一次都没被调用（grep 计数 0）**。自举不依赖 quay 预装：交付面 `plugin/scripts/dist/quay-init-steps.js` 由 esbuild 打成自包含（`yaml` 已内联），`ensure_target_branch_model` 用的 vendored `dist/quay.js` 本就在包里。
- **一个实测缺陷（已修）**：`.sh` 里若把目录变量写成**带花括号**的 `${SCRIPT_DIR}`，staged 改写的那条规则**只改路径、保留 `--experimental-strip-types`**（去标志的是无花括号那条），于是产物里跑的是 `node --no-warnings --experimental-strip-types .../dist/quay-init-steps.js`——Node <22.6 直接不可用。改成无花括号 `$SCRIPT_DIR/…`（本仓库其它 `.sh` 的既有写法）后，产物里是 `node --no-warnings "$SCRIPT_DIR/dist/quay-init-steps.js"`。

## Touches

- plugin/scripts/quay-init.sh
- plugin/scripts/quay-init-steps.ts (new)
- packages/quay/src/init.ts
- plugin/skills/init/SKILL.md
- plugin/test/quay-init-characterization.test.mjs (new)
- plugin/test/quay-init-loop.test.mjs
- plugin/test/quay-init.test.mjs
- plugin/test/quay-init-closure-ratchet.test.mjs
- plugin/test/quay-init-laydown-closure.test.mjs
- plugin/sh-census-baseline.json
- docs/analysis/quay-init-closure-ratchet.baseline.json
- plugin/scripts/capability-catalog-declarations.json
- tasks/gap-arch-quay-init-sh-python-heredocs-to-native.md

（实现时实际触及的清单：`packages/quay/src/cli/init.ts`、`plugin/test/quay-init-closure-ratchet.test.mjs`、`plugin/test/quay-init-laydown-closure.test.mjs` **未改**（原清单的预判），但保留在清单里是因为它们是本改动的回归面、scoped 门应跑；实际**新增**的是 `plugin/scripts/quay-init-steps.ts`、`plugin/test/quay-init-characterization.test.mjs`、`plugin/test/quay-init-loop.test.mjs`（heredoc 扫描器的空泛守卫按落地后事实改判据形态）与 `docs/analysis/quay-init-closure-ratchet.baseline.json`（闭包棘轮机械重锚，见 AC7）。）
