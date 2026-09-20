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

- [x] AC1（枚举，先于改动）贴出 8 个 python3 heredoc 的清单：行号、作用、输入/输出契约、迁移落点（`init.ts` 里哪个函数 / 或「自举不可替代，保留」+ 理由）。缺一个即不合格。
- [x] AC2（characterization 先于改写，取假）在**未改动**的旧 `quay-init.sh` 上先落盘：对一个临时 workspace 跑 `init`，把产生的**六文件面**（`.quay/config.yml`、`.quay/profiles.yml`、`tasks/`、`.gitignore`、`.claude/launch.settings.json`、`.claude/settings.json`）的内容与退出码钉住；对旧脚本注入一处行为改动该测试必须红，撤销后绿。两次输出贴进 notes。（既有 `plugin/test/quay-init*.test.mjs` 8 个文件先跑一遍，明确哪些已覆盖，缺口补测。）
- [x] AC3（等价）迁移前后，同一组输入（全新目录 / 已有配置 / 损坏配置 / `--reconcile` / `--dry-run`，至少 5 类）产生的六文件面与退出码逐项一致（贴对照表）。
- [x] AC4（目标读数）`sh-census-check.ts --json` 中 `plugin/scripts/quay-init.sh` 的 `embedded` 不含 `python3`（若某 heredoc 被有理由保留，则该条 AC 以 `NOT-EVALUATED` 标注并列出保留项，⛔ 不得用放宽判据顶替）；`plugin/sh-census-baseline.json` 只降不升地同步；前后读数各贴一次。
- [x] AC5（自举，生产载体，硬规则 4 推论三）在一个**没有预装 quay 的干净环境**（新用户目录 + 只有 npm-pack 产物/插件 cache）里，从 `/quay:init` skill 的真实入口跑一遍，六文件面齐全（贴运行输出）；关掉 fixture 后仍成立。
- [x] AC6（文案不成假话）`plugin/skills/init/SKILL.md:16、:46` 关于「逻辑在 quay-init.sh」「Not yet wired」的表述按落地后事实改写；`git diff` 可见。
- [x] AC7（闭包棘轮与回归面）`plugin/test/quay-init-closure-ratchet.test.mjs` 与 `quay-init-laydown-closure.test.mjs` 全绿（改 `quay-init.sh` 会令闭包棘轮 stale，需按既有 re-anchor 流程重锚并写明）；`scripts/test.sh --for-task gap-arch-quay-init-sh-python-heredocs-to-native` 全绿。
- [x] AC8（本改动的真实副作用：全量 suite 回归面）本改动第一次让安装路径**读出 `plugin/` 之外**（步骤逻辑在 `packages/quay/src/init.ts`），于是 `install-config-driven-e2e.test.mjs` A1 的「冻结插件副本」不再完备，全量 suite 唯一红点即此。fixture 补齐它真正要读的两份输入（Core src + `yaml`）并在**同一棵树**上取假（去掉那行 A1 必红、复现原报错；加回绿）。

## DoD

真实落地：从干净环境经真实入口跑通 `/quay:init`（AC5），六文件面与迁前逐项一致（AC3），census 中 `quay-init.sh` 不再内嵌 python3 或对保留项如实标注未评估（AC4）。自举是否仍成立有实测答案，而不是断言。

## Notes（AC1 枚举 + 各 AC 证据）

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

**没有「自举不可替代」的保留项**：见 AC5——12 处全部可迁，`.sh` 现在 `embedded=[node]`。

### AC2 — characterization（先于改写、钉住、且实测可取假）

- **既有 8 个 `plugin/test/quay-init*.test.mjs` 先跑一遍**：`quay-init` / `quay-init-loop` / `quay-init-config-env-keys` / `quay-init-tmux-detection` / `quay-init-closure-ratchet` / `quay-init-laydown-closure` / `quay-init-install-fixture-wipe` 共 **58 用例全绿**（改动后复跑同样全绿）。它们已覆盖：七项闭集写面、provider map + loop 参数、carrier env 四键、`.claude/settings.json` 的 enable + MCP 预批、install steps 文案、dry-run 不写、tmux 三态、失败时的 written/unwritten 报告、legacy bare-PATH 迁移 + 陈旧 runtime 退役 + byte-current 不外写。**缺口**＝没有任何一条钉住**六文件面的字节**（它们断言的是结构/字段），也没有一条覆盖「loop 值真的变了 ⇒ 整份重写」与「损坏 config」两条路径 ⇒ 新增 `plugin/test/quay-init-characterization.test.mjs`（6 用例）。
- **钉子取自未改动的旧脚本**：`git show HEAD:plugin/scripts/quay-init.sh` 与改后脚本在**同一组 fixtures、同一 workspace 路径**上各跑一遍，六文件面逐字节相同 ⇒ 钉进去的 sha256 就是旧行为的读数，不是改后自证。
- **取假（两个方向都实测）**：
  - 注入 1（六文件面）：把 `fork_baseline: develop` 改成 `trunk` → `AC2 — a FRESH install pins the closed-set surface and exit code` 与 `AC2 — the fresh-install config carries…` **两红**；撤销 → 6/6 绿.
  - 注入 2（重写路径）：把 `ensureLoopConfig` 写出的 `worktree_root` 追加 `-MUTATED` → `AC3 — an EXISTING legacy config…` **红**（它断言 loop 未变时**不写**）；撤销 → 6/6 绿。
- 结论：测试不是恒真回声——把被钉住的行为改一处，它必红。

### AC3 — 等价（迁移前 vs 迁移后，逐项对照）

对照方法：同一 workspace 路径（避免 config 里内嵌绝对路径造成的假差异）、同一旧/新脚本、同一组 flag，跑完逐字节 diff 六文件面 + runtime 目录去向 + 备份目录 + exit code。**stdout 里两处非确定量（每次新建 repo 的 commit sha、`BACKUP_TS`）已归一化**，其余逐字比较。

| # | 输入类 | 旧 rc | 新 rc | 六文件面 | runtime/backups | stdout |
|---|---|---|---|---|---|---|
| 1 | 全新目录 | 0 | 0 | **逐字节相同** | 无/无 | 相同 |
| 2 | 已有配置（本工具生成的当前态，重跑） | 0 | 0 | 逐字节相同 | 无/无 | 相同 |
| 3 | 已有配置 + legacy bare-PATH 绑定 + 陈旧 `.quay/runtime` | 0 | 0 | 逐字节相同（含**整份 YAML 重写**：注释被丢、`mcp_entry` 变块序列、路径去引号） | 相同（退役→备份） | 相同 |
| 4 | 已有配置 + carrier 键缺失（行级插入路径） | 0 | 0 | 逐字节相同 | 无/无 | 相同 |
| 5 | 损坏配置（无法解析） | 1 | 1 | 相同（均不写任何文件） | 无/无 | 相同 |
| 6 | `--dry-run`（全新） | 0 | 0 | 相同（均不写） | 无/无 | 相同 |
| 7 | loop 值真的变了（整份重写 + 80 列折行） | 0 | 0 | 逐字节相同 | 无/无 | 相同 |
| 8 | `detect_test_command` 三梯级：npm 有/空白 test、go.mod | 0/2/0 | 0/2/0 | 逐字节相同 | 无/无 | 相同 |

（`--reconcile` 是 **CLI `quay init`** 的模式、不是 shell flag，本任务的 shell 面没有它；版本级 reconcile 的路径本次**一字未改**（`runInit`/`reconcileConfigContent` 未触及），#2 覆盖了「已有配置重跑」这一类。）

**⚠️ 一处必须说明的等价细节**：`ensure_loop_config` / `migrate_stale_mcp_entry` 走的是 `yaml.safe_dump(allow_unicode=True, sort_keys=False, default_flow_style=False)` 的**整份重写**（丢注释、重排）。Python 的 `safe_dump` 会在**列 >80 的单个空格处折行**，而 `yaml` 包自己不做同样的事 ⇒ 移植实现里有 `foldPlainScalars`（用 `lineWidth:0` 关掉库自己的折行，再按 PyYAML 规则补回）。折行位置**逐字对过 PyYAML 6.0.1**（同一文档跑 `python3 -c 'import yaml; print(yaml.safe_dump(...))'` 比对），并把折行位置写进了 characterization 的断言（⛔ 不是「看着够长就折」）。

### AC4 — 目标读数（前后各一次）

**前**（改动前，`node --experimental-strip-types plugin/scripts/sh-census-check.ts --json`）：
```
plugin/scripts/quay-init.sh  codeLines=1332  embedded=["node","python3"]
totals.embeddedInterpreterLines = 9503
```
**后**（同一命令，改动后）：
```
plugin/scripts/quay-init.sh  codeLines=1012  embedded=["node"]
totals.embeddedInterpreterLines = 9183   （verdict.ok=true，baselineRaised=[]）
```
`plugin/sh-census-baseline.json` **只降不升**地同步：`embeddedInterpreterLines` 9503 → **9183**，`duplicateCopies` 0 不变；并在 `_reanchorLog` 里追加了一条带 attribution 的降向重锚记录（-320 = 1332→1012，Residual=0）。⛔ 该轴量的是「含内嵌解释器的 `.sh` 的有效行数」，quay-init.sh 仍在轴内（它还 exec `node`）——**移的是行数、不是成员身份**，所以读数下降而不是该文件消失。**无保留项**，无需 NOT-EVALUATED。

### AC5 — 自举（生产载体，不是 fixture）

**自举路径原先依赖哪几个 heredoc**：`read_existing_loop_value`（在 240/247 行于 **source 期**就会跑）、271/272（plugin 版本/名）、2215（worktree_root）、2059（`write_claude_settings`）——即**前四个是自举必需的**，其余在写路径中才跑。

**实测（干净环境）**：
1. `bash packages/quay/scripts/package.sh` → 真 npm-pack 产物 `quay-0.12.0-dev.tgz`（`dist-closure gate OK: 111 referenced dist bundles all present`，含 `plugin/scripts/dist/quay-init-steps.js`）。
2. 解包到独立目录；该布局里 **raw `.ts` 已被删**、**插件树旁没有任何 `node_modules`**。
3. `env -i HOME=<新用户目录> PATH=<只有 node + git + coreutils，且最前面放一个 `exit 127` 的 `python3`/`python` 假体>` + `CLAUDE_PLUGIN_ROOT=<解包后的 plugin>`，从 SKILL.md 记录的真实入口跑：
   `bash <plugin>/scripts/quay-init.sh --root <proj> --plugin-root <plugin> --test-command "bash scripts/test.sh" --repo-root <proj> --worktree-root <wt> --auto-commit-skip`
4. **结果：rc=0；六文件面全部 PRESENT；日志里 `python3 is NOT AVAILABLE` 的命中数 = 0**（假体一次都没被调用）；`quay-init (plugin v0.12.0-dev)`（版本读取经新 step 生效，不是 `vunknown`）。

**关掉 fixture 后仍成立**：这一跑本身就是最终形态——没有注入任何 fixture，干净环境 + 真产物就是输入；`python3` 假体是**负控制**（若还有一处调用它，rc 不会是 0）。自举不依赖 quay 预装：交付面的 `dist/quay-init-steps.js` 由 esbuild 打成自包含（bare `yaml` 已内联），`ensure_target_branch_model` 用的 vendored `dist/quay.js` 本就在包里。

**顺带实测并修掉一个缺陷**：`.sh` 里若把目录变量写成**带花括号**的 `${SCRIPT_DIR}`，staged 改写的那条规则**只改路径、保留 `--experimental-strip-types`**（去标志的是无花括号那条），产物里跑的是 `node --no-warnings --experimental-strip-types .../dist/quay-init-steps.js`——Node <22.6 直接不可用。改成无花括号 `$SCRIPT_DIR/…`（本仓库其它 `.sh` 的既有写法）后，产物里是 `node --no-warnings "$SCRIPT_DIR/dist/quay-init-steps.js"`。

### AC6 — 文案（`git diff plugin/skills/init/SKILL.md` 可见）

- 第 16 行原「**The logic lives in ONE executable** — `bash …/quay-init.sh`」→ 改为「**entry point** 是 quay-init.sh；自 2026-09-20 起它只做编排，**步骤逻辑在 `packages/quay/src/init.ts`**，经兄弟 `plugin/scripts/quay-init-steps.ts` 到达；原先内嵌 12 处 python3，现已为 0 ⇒ 机器上**没有 Python 也能**初始化 quay 项目」。
- 第 46 行原「**Not yet wired into the script below**」保留**实质**（版本级 reconcile 确实仍未接进脚本路径），但按落地后事实写准：点明它现在指 `ensureLoopConfig`（`init.ts` 里、由该脚本分发），并显式加一句「⛔ 不要把 2026-09-20 这次移植读成「已接上」——它搬的是代码，没把 reconcile 加进脚本路径」。

### AC7 — 闭包棘轮与回归面

- 闭包棘轮**确实 stale**（`quay-init-closure-ratchet.ts --check-stale` 报 `changed: plugin/scripts/quay-init.sh … re-anchor required`）⇒ 按既有流程机械重锚：`--reanchor` → `PASS: re-anchored baseline → 3 files / 1022 bytes (fingerprint 41093d70…)`，落点 `docs/analysis/quay-init-closure-ratchet.baseline.json`。重锚后 `--check-stale` 绿：`laydown source fingerprint fresh … baseline in sync`。
- `plugin/test/quay-init-closure-ratchet.test.mjs`、`plugin/test/quay-init-laydown-closure.test.mjs` 及 `plugin/test/quay-init*.test.mjs` 全绿（58 用例）。
- **`bash scripts/test.sh --for-task gap-arch-quay-init-sh-python-heredocs-to-native --allow-thin`：rc=0，`tests 175 / pass 175 / fail 0`**，全部 scoped 静态检查 PASS（含 `PASS — embeddedInterpreterLines=9183 ≤ 9183, duplicateCopies=0 ≤ 0`）。
- **一个环境陷阱（写给下一个跑者）**：若在本 worktree 里跑过 `build-plugin-dist.mjs`/`package.sh`，会生成 gitignored 的 `plugin/scripts/dist/*.js`，而 `worktree-namespace-literal-check`（26 处 `"quay-worktrees"`，25 处在产物里）与 `task-file-bypass-check`（5 处 NEW）会因此变红——**这不是实现缺陷**（主检出一模一样地红）。干净 worktree 本就没有这个目录；`scripts/test.sh` 的 `build_dist_once` 也不建它。删掉即绿。

### AC8 — 全量 suite 回归：本改动打红了一个既有测试（fixture 输入的完备性）

**现象**：两次 fan-in 全量 suite 的**唯一**红点都是
`packages/quay/test/install-config-driven-e2e.test.mjs:338` 的 A1：
`ws1 install failed: ERROR: quay-init needs the target project's test command but none could be detected in /tmp/install-e2e-…`。
⚠️ 机械 delta-relatedness 判定它 **UNRELATED**（「不在本任务 Touches/diff、直接 import 无交集」）——**该判定是错的**：判的是「文件是否在 diff 里」，漏掉了「本改动经由**运行期**依赖（`quay-init-steps.ts` → `init.ts`）改变了这个测试所依赖的布局前提」。这正是硬规则 4b 说的：代理量（文件交集）与实际（运行期读取面）偏离。

**根因（最小复现，不靠推断）**：A1 为隔离 mid-suite 源码变更，把插件冻结到一个私有副本，冻结方式是**一行** `fs.cpSync(PLUGIN_ROOT, frozenPlugin)`。本改动之后，quay-init.sh 的步骤不再在 shell 内：
`quay-init-step` → `plugin/scripts/quay-init-steps.ts` → `packages/quay/src/init.ts`（经 `core-src-import.ts`，**静态字面量优先** = `<pluginRoot>/packages/quay/src/init.ts`）。
只冻结 `plugin/` 的副本里**没有 Core 可读** ⇒ 每个 step 都以 `ERR_MODULE_NOT_FOUND` 死掉 ⇒ `has-npm-test` 恒等于「没有 scripts.test」⇒ 梯级全落空 ⇒ rc=2，在任何文件落盘之前退出。最小复现（与 suite 日志**逐字相同**的报错）：

```
$ cp -r <wt>/plugin /tmp/FP
$ node --no-warnings --experimental-strip-types /tmp/FP/scripts/quay-init-steps.ts has-npm-test /tmp/pkg.json
quay-init-steps: Cannot find module '/tmp/packages/quay/src/init.ts' imported from /tmp/FP/scripts/quay-init-steps.ts
rc=1
```

**为什么责任在本改动而不在环境**：develop 的 `quay-init.sh` 读的每一个可执行件都在 `plugin/` **内部**（内联 python3 + vendored `plugin/vendor/quay/dist/quay.js`），所以「只冻结 plugin/」当时是**完备**的。本改动第一次让安装路径**读出 `plugin/` 之外**，冻结随之不再完备。⇒ **修的是冻结的完备性，不是判据的宽严**（⛔ 没有放松 A1 的任何断言）。

**修法**：fixture 把安装真正要读的第二份源码一并冻进副本——`<frozenPlugin>/packages/quay/src/` + `<frozenPlugin>/node_modules/yaml`——保持**同一相对形状**，静态字面量直接命中（不走 fallback）。`yaml` 是 `init.ts` 唯一的裸 import 且自身无依赖。
⛔ **为什么不**用「`<frozenRoot>/plugin` + `<frozenRoot>/packages/quay/src`」这种更像仓库树的形状：那会让 `$PLUGIN_ROOT/../packages/quay/src` **存在**——正是 quay-init `dist_stale` 探针盯的源目录——而 `cpSync` 不保留 mtime，被复制的源一旦比被复制的 bundle 新，就会让**两个并行安装同时**往冻结副本里跑 `sync-vendor.sh` 自动重建（fixture 注释里本来就写着要避免的那条路）。嵌在插件根内部时该路径仍不存在，探针仍不触发（`dist_stale` 返回 2 → `core_nosrc=1`），与改动前的行为一致。

**取假（同一棵树，只切那一行）**：
- 去掉 Core src 那一行 ⇒ A1 **红**，报错与 fan-in suite 日志逐字相同（`none could be detected`）。
- 加回 ⇒ A1 **绿**（`node --test packages/quay/test/install-config-driven-e2e.test.mjs` → `tests 3 / pass 3 / fail 0`）。
- 结论：这行是承重的，A1 没有变成恒真回声。

**回归面复跑**：`plugin/test/quay-init*.test.mjs` 七个文件 **57/57 绿**（含 characterization 与两个闭包测试）。

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
- packages/quay/test/install-config-driven-e2e.test.mjs
- plugin/sh-census-baseline.json
- docs/analysis/quay-init-closure-ratchet.baseline.json
- plugin/scripts/capability-catalog-declarations.json
- tasks/gap-arch-quay-init-sh-python-heredocs-to-native.md

（与原清单的差异：`packages/quay/src/cli/init.ts` **未改**（原清单的预判——落点全在 `init.ts` 的导出函数 + 新兄弟 CLI，没动公开 CLI 表面）；`plugin/test/quay-init-closure-ratchet.test.mjs`、`plugin/test/quay-init-laydown-closure.test.mjs` **未改**（保留在清单里因为它们是本改动的回归面、scoped 门应跑）；实际**新增**：`plugin/scripts/quay-init-steps.ts`、`plugin/test/quay-init-characterization.test.mjs`、`plugin/test/quay-init-loop.test.mjs`（「heredoc 扫描器不许空泛通过」的守卫按落地后事实改成目的形态：原先 `all.length >= 5` 的**计数**判据在 8 段 python heredoc 离场后把一次正确的移植判红——这是判据形态的错，不是实现的错）、`docs/analysis/quay-init-closure-ratchet.baseline.json`（机械重锚）、`plugin/scripts/capability-catalog-declarations.json`（新脚本的 6 行声明，否则 `capability-catalog --entry-surface` 会红 ⇒ package.sh 拒发）、`packages/quay/test/install-config-driven-e2e.test.mjs`（AC8：冻结副本补齐 Core src + `yaml`，修掉本改动在**全量 suite** 里打红的 A1——该文件不在原 Touches 里，因为原清单只覆盖 scoped 面，漏了这条运行期依赖）。）
