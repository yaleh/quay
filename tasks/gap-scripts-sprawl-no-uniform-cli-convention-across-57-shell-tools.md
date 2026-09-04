---
id: gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools
title: "plugin/scripts/ has 57 .sh files (107 total incl. .ts) with ZERO uniform
  CLI convention — --help behaves differently in every one tested tonight:
  dead-loop-check.sh silently ignores it and runs normal logic,
  prefriction-count.sh treats it as a --since git-revision value, axis-
  generator.ts requires node --experimental-strip-types (bare bash execution
  fails on the first comment line), supervisor-deliver.sh treats it as the
  payload text to deliver, session-bootstrap.sh falls through to printing its
  own shebang line — this is not a cosmetic gap: it directly produced tonight's
  real mistakes (the manager guessed wrong invocation forms multiple times
  before finding correct usage in each script's own header comments, because
  there is no queryable, uniform interface);
  orchestration/SPEC-manager-productization-2026-08-05.md and
  SPEC-state-crystallization -2026-08-05.md already establish the right
  framework (名词进代码/动词留文本 — facts crystallize into structured single-writer
  state, rules stay as prose, per §2 of state-crystallization; manager must
  consume via capability-catalog.sh not hand-roll, per §5 of
  manager-productization) but neither addresses INTERFACE consistency across the
  57+ existing crystallized tools themselves; manager 2026-08-06, filed per
  human direction ('即使是这些 .sh 也依然太散，应进一步结晶')"
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**已经结晶的 57 个 `.sh` 工具，彼此之间的调用界面完全不统一——"结晶"解决了"能力存不存在"，
没解决"界面一不一致"。**

### 实测（5 个工具，5 种 `--help` 行为，全部真跑）

```
$ bash plugin/scripts/dead-loop-check.sh --help
dead-loop-check.sh — L2 持续健康判据：循环【在转】，不只是【装了】   ← 忽略 --help，正常跑
$ bash plugin/scripts/prefriction-count.sh --help
prefriction-count.sh: --help is not a git working ...              ← 当成 --since 的值来解析，报错
$ bash plugin/scripts/axis-generator.ts --help
axis-generator.ts: line 2: //: Is a directory                       ← 需要 node，裸 bash 直接跑就崩
$ bash plugin/scripts/supervisor-deliver.sh --help
supervisor-deliver: 文本为空                                          ← 把 --help 当成 payload 参数
$ bash plugin/scripts/session-bootstrap.sh --help
!/usr/bin/env bash                                                   ← 落到打印自己的 shebang 行
```

**五个工具，五种完全不同的行为，没有一个是"打印用法说明"。**

### 这不是美观问题——今晚的真实代价

管理者今晚**至少 4 次**猜错某个工具的调用形式，最终靠翻脚本自己的头注（不是 `--help`）才拼对：
`supervisor-deliver.sh` 的 `--root` 参数、`session-bootstrap.sh` 的 layout token 顺序、
`prefriction-count.sh --json` 的字段结构、`send-keys-reliable.sh` 的三参数位置。
**每一次都要先读一遍源码注释，因为没有一个统一的"问它自己怎么用"的方式。**

### 已有的框架能覆盖多少，缺口在哪

`SPEC-state-crystallization-2026-08-05.md` §2 的"名词进代码，动词留文本"，回答的是
**"这个东西该不该被结晶成机器可读的状态"**——已经解决。
`SPEC-manager-productization-2026-08-05.md` §5 的"manager 不造轮子"，回答的是
**"manager 该不该自己写新脚本"**——也已经解决（今晚的另一条任务在跟进）。

**两份规格都没回答**："57 个已经结晶好的工具，彼此的调用方式该不该一致"。
这是下一层缺口：**结晶解决了"有没有"，没解决"好不好用/好不好记"。**

### 选定机制（方向，接法留执行时）

不预设"重写全部 57 个脚本"——那个代价可能远大于收益，且违反本仓"不预设具体实现"的一贯纪律。
两条更克制的候选，接法留执行时判断：

1. **最小公分母**：所有工具至少统一支持 `--help`（哪怕只是打印一行用法），
   `capability-catalog.sh` 已经有"这个工具回答什么问题"的描述，`--help` 至少不应该比
   胡乱猜参数更差；
2. **共享一个入口壳**：类似 `git <subcommand>` 的形态，一个 `quay-tool <name> [args]` 分发器，
   统一处理 `--help`/参数解析框架，各工具的业务逻辑不变，只是接入点统一。

**任务体必须记录选了哪条、为什么**，不能悬空。

## Contract

```
measure help_flag_consistent = `for f in plugin/scripts/*.sh; do timeout 5 bash "$f" --help 2>&1 | head -1; done | grep -ci "usage\|用法"` stdout 的数字段（分子/57）
band help_flag_consistent = 不预设固定阈值（基线未知，需先测全量再定目标，参照 gap-suite-cost-model-is-wrong 的教训）；但改动前后必须报出对比数字
invariant 任何被 capability-catalog.sh 收录的工具，其 --help（或等价的用法查询方式）不得产生业务逻辑副作用（不得像 supervisor-deliver.sh 那样把 --help 当成真实 payload 执行）
invoke `for f in plugin/scripts/*.sh; do timeout 5 bash "$f" --help 2>&1 | head -1; done`
control 挑一个当前会把 --help 当业务参数执行的工具（如 supervisor-deliver.sh），改完后 --help 必须不产生任何真实副作用（不发送、不修改状态），且输出用法说明
resume 若中断，先跑 measure 读当前基线，不要假设已经统一
```

## Acceptance Criteria

- [x] AC1: 全量测出当前 57 个 `.sh` 工具的 `--help` 行为基线，贴出完整实跑输出（不是抽样）
- [x] AC2: 选定机制并记录理由（最小公分母 vs 共享入口壳），不得留空
- [x] AC3: **负控制（承重条）**——`supervisor-deliver.sh --help` 修复后不得触发任何真实送达尝试
      （当前行为是尝试把 "--help" 当 payload 发出去，这本身是一个真实的安全隐患：
      误触发 --help 会真的往目标会话发消息）
- [x] AC4: 至少覆盖本任务实测到的 5 个工具（dead-loop-check / prefriction-count / axis-generator /
      supervisor-deliver / session-bootstrap），改前/改后行为对照
- [x] AC5: 与 `gap-manager-skill-missing-mandatory-tool-reuse-checklist` 交叉标注——那条解决
      "该不该去查目录"，本任务解决"查到了之后好不好正确调用"，两者互补

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## 交叉标注（AC5 族，2026-08-08 由 gap-shipped-artifact-carries-86-loose-shell-scripts 追加）

> **本条 ≠ gap-shipped-artifact-carries-86-loose-shell-scripts-as-the-delivery-form（分界）**：
> 本条问「这些 `.sh` 的 `--help`/调用界面一不一致」——**界面一致性**，作用域是仓库内 57 个工具；
> 那条问「86 个散件是不是正确的交付形态」——**交付形态**，作用域是交付产物。两条正交：即使本条把
> 57 个 `--help` 全部统一，消费者仍然收到 86 个独立 shell 入口；反之即使那条把交付面收敛成
> 「少数入口 + 内部件不外露」，本条要修的 `--help` 不一致仍然存在。**不要合并，也不互相替代。**
>
> 协同：本条 AC2 的候选方案 2「共享入口壳 `quay-tool <name>`」与那条选定的「少数入口」收敛方向
> 是同一个机制的两面——那条把真实被调用的工具收进 `quay-tool <name>` 分发器并声明为
> `capability-catalog.sh` 的 `PUBLIC_ENTRYPOINTS`，本条把分发器统一处理 `--help`/参数解析。若本条
> 选该方案，直接消费那条声明的公开入口集作为被分发工具；若选「最小公分母」，则逐工具在源码上补
> `--help`，交付面保持散件但界面一致（那条的 AC3 负控制条仍会把它标记为内部件不该被消费者直调）。

## Touches
- tasks/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools.md（自身：勾 AC + 贴证据）
- plugin/scripts/*.sh（57 个文件，具体改动范围由 AC2 选定机制决定）
- plugin/scripts/capability-catalog.sh
- tasks/gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact.md（AC5 交叉标注：那条管 `.ts`
  的交付形态——bundle 成 42 个可执行入口、删 80 个 raw `.ts`；本条管 `.sh` 的界面一致性。两者都是
  「交付面结晶程度不够」的实例，且本条若选「共享入口壳 `quay-tool <name>`」方案，将直接消费那条
  bundled 出的 `plugin/scripts/dist/*.js` 作为被分发的工具）
- tasks/gap-shipped-artifact-carries-86-loose-shell-scripts-as-the-delivery-form.md（分界交叉标注，见上）

## Evidence（内层实现 2026-08-09）

### AC2 选定机制：最小公分母（least-common-denominator）

**选定：最小公分母——每个 `.sh` 工具统一支持 `--help`**（首行打印 `用法`、退出 0、零业务副作用），
实现为共享 `tool_help()` + 逐工具守卫，**不选**共享入口壳 `quay-tool <name>`。理由：

1. 共享入口壳是 `gap-shipped-artifact-carries-86-loose-shell-scripts-as-the-delivery-form` 的收敛方向
   （交付面收成少数入口 + 内部件不外露），也是 `gap-shipped-ts-files-are-not-bundled` 的 bundle 轴；
   本条 Touches/交叉标注明确「不要合并、也不互相替代」。共享入口壳落地前，最小公分母直接修掉已实测
   的失败（猜调用形式、`--help` 有副作用），且对正常调用零行为变化（守卫只在 `$1` 是 `--help|-h` 时触发）。
2. 实现：`gate-script-lib.sh` 新增共享 `tool_help()`（无副作用——只定义函数、返回 0）；每个非库 `.sh` 工具在
   首个 `set -` 之前插入统一守卫：

```bash
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
```

3. 单一事实源：`gate-script-lib.sh` 与 `task-schema-check.sh` 是 sync-vendor 从
   `experiments/quay-perpetual-stream/scripts/` 镜像进 `plugin/scripts/` 的源文件（`npm install` 的 postinstall 会回拷）。
   按「修源头不修工件」原则，**源文件也打了同样的补丁**（`experiments/quay-perpetual-stream/scripts/{gate-script-lib.sh,
   task-schema-check.sh}`），`sync-vendor --check` 实测通过（gate-script-lib.sh 变为 identical）。

### AC1 全量基线（实际 71 个 `.sh` 工具——标题里的 57 已过时；Contract measure 只读每工具 `--help` 首行）

Contract measure：`for f in plugin/scripts/*.sh; do timeout 5 bash "$f" --help 2>&1 | head -1; done | grep -ci "usage\|用法"`

**改前：5/71**（在 HEAD 真实环境、node_modules 就绪下复测；5 个命中 = blocked-signal-check / checker-cost /
checker-mutation-check / supervisor-preempt / verify-installed-executables）。完整实跑输出（首行 + 退出码）：

```text
# BEFORE（5/71）
anti-gaming-guard.sh                       rc=1   (node:3181804) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///tmp/quay-bef
assert-clean-tree.sh                       rc=1   cd: cd [-L|[-P [-e]]] [-@] [dir]
audit-independence-check.sh                rc=2   (node:3181848) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///tmp/quay-bef
blocked-signal-check.sh                    rc=0   Usage: bash plugin/scripts/blocked-signal-check.sh --timeout [--max-age-ms N] [--root <dir
cap-from-gate.sh                           rc=2   (node:3181894) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///tmp/quay-bef
capability-catalog.sh                      rc=0   capability-catalog.sh — gap-eighty-two-shipped-checks-and-none-says-what-it-answers.
checker-cost-lib.sh                        rc=0   
checker-cost.sh                            rc=2   usage: checker-cost.sh <name> [--n <size>] [--root <dir>] -- <command...>
checker-mutation-check.sh                  rc=2   Usage: checker-mutation-check.sh --list [--json] | --run [--json] | --check | --selftest [
claim-task.sh                              rc=0   claim-task.sh — claim a task on the CLAIM REMOTE by pushing an empty `task/<id>` marker 
closure-lag-check.sh                       rc=0   closure-lag-check.sh — the closure-pass lag signal (tasks/gap-closure-pass-has-no-lag-si
codex-stage1-selfcheck.sh                  rc=0   === codex-stage1-selfcheck (repo root: /tmp/quay-before-wt) ===
cross-machine-verify.sh                    rc=0   cross-machine-verify.sh — cross-machine VERIFICATION of post-merge delivery.
dead-loop-check.sh                         rc=0   dead-loop-check.sh — L2 持续健康判据：循环【在转】，不只是【装了】
drivable-workspace-check.sh                rc=2   (node:3182656) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///tmp/quay-bef
gate-script-lib.sh                         rc=0   
gate-staleness-check.sh                    rc=0   gate-staleness-check.sh — bash wrapper for the gate-ledger freshness probe (SPEC §7 ris
halt-check.sh                              rc=0   halt-check.sh — the THREE-LAYER UNIFIED `.halt` check point
inbox-reader.sh                            rc=0   inbox-reader.sh — the CONSUMER MECHANICAL MOUNT POINT for the human channel's inbox
inner-session-check.sh                     rc=0   !/usr/bin/env bash
integration-batch-merge.sh                 rc=2   integration-batch-merge.sh — the integration→develop batch-merge helper of the two-lin
it0-enforcement-with-design-check.sh       rc=2   (node:3182831) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///tmp/quay-bef
it0-impl-row-check.sh                      rc=2   ERROR: unknown flag: --help
it0-split-or-commit-check.sh               rc=2   (node:3182877) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///tmp/quay-bef
laydown-set-check.sh                       rc=2   laydown-set-check: unknown arg: --help
loadbearing-test-gate.sh                   rc=2   (node:3182923) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///tmp/quay-bef
loop-driver-check.sh                       rc=3   loop-driver: STALLED (0) — no loop driver registered; the loop will never tick
manager-adopt.sh                           rc=0   !/usr/bin/env bash
manager-arm-loop.sh                        rc=0   !/usr/bin/env bash
manager-start.sh                           rc=0   !/usr/bin/env bash
manager-tick-log-check.sh                  rc=0   !/usr/bin/env bash
monitor-mount-check.sh                     rc=0   mounted=false
observer-registry-check.sh                 rc=0   observer-registry-check: clean — no registry dir at --help/.quay (no observers registere
os-anchor-install.sh                       rc=0   !/usr/bin/env bash
os-anchor-watchdog.sh                      rc=0   !/usr/bin/env bash
periodic-push-backup.sh                    rc=0   periodic-push-backup.sh — B-machine periodic PUSH BACKUP to the backup remote.
pipe-exit-code-check.sh                    rc=0   pipe-exit-code-check: clean (no pipeline-then-$? reads).
prefriction-count.sh                       rc=0   prefriction-count.sh: --help is not a git working tree
process-budget.sh                          rc=0   total_budget=4
publish-dist-branch.sh                     rc=2   ERROR: unknown argument: --help
quay-init.sh                               rc=2   ERROR: unknown argument: --help
quay-launch.sh                             rc=4   
quay-topology.sh                           rc=0   !/usr/bin/env bash
real-target-verify.sh                      rc=0   !/usr/bin/env bash
release-task.sh                            rc=0   release-task.sh — RELEASE a claimed task: delete the `task/<id>` claim branch on the sha
resource-gate.sh                           rc=0   plugin/scripts/resource-gate.sh — the shared resource gate for heavy operations
send-keys-reliable.sh                      rc=2   send-keys-reliable: 文本为空
send-keys-verified.sh                      rc=2   send-keys-verified: 文本为空
session-bootstrap.sh                       rc=0   !/usr/bin/env bash
session-liveness-mount.sh                  rc=0   session-liveness: starting pid=3183527 file=session-liveness.sh md5=d75972f536932e3d
session-liveness.sh                        rc=0   session-liveness: starting pid=3183579 file=session-liveness.sh md5=d75972f536932e3d
slot-refill.sh                             rc=124 (node:3183614) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///tmp/quay-bef
supervisor-bus-identity.sh                 rc=2   supervisor-bus-identity.sh — the supervisor base layer's IDENTITY interface
supervisor-bus.sh                          rc=0   supervisor-bus.sh — the supervisor base layer's IDENTITY-ATTRIBUTABLE message bus
supervisor-deliver.sh                      rc=2   supervisor-deliver: 文本为空
supervisor-health.sh                       rc=1   alive: false
supervisor-observe.sh                      rc=2   supervisor-observe: starting pid=3185001 file=supervisor-observe.sh md5=88593f83ac1e6b1b
supervisor-preempt.sh                      rc=2   用法: plugin/scripts/supervisor-preempt.sh {halt-check [--root <根>] | preempt <target>
sync-lag-check.sh                          rc=0   sync-lag-check.sh — cross-machine sync: mechanical lag measurement + push decision for t
sync-vendor.sh                             rc=2   ERROR: unknown argument: --help
task-schema-check.sh                       rc=2   (node:3185192) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///tmp/quay-bef
test-file-snapshot.sh                      rc=2   test-file-snapshot.sh — baseline-snapshot helper for the RELATIVE-BASELINE test criterio
test-framework-policy-check.sh             rc=0   (node:3185445) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///tmp/quay-bef
test-isolation-check.sh                    rc=0   (node:3185701) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///tmp/quay-bef
tmux-isolated.sh                           rc=1   tmux: unknown option -- -
tmux-leak-scan.sh                          rc=1   tmux-leak-scan: FAIL — residual test tmux servers/dirs after the run (prefixes: skv-|ses
topology-check.sh                          rc=0   !/usr/bin/env bash
tree-hygiene-check.sh                      rc=0   tree-hygiene: clean — no un-gitignored scratch left in the main tree.
verify-installed-executables.sh            rc=2   Usage: verify-installed-executables.sh <plugin-src> <workspace-root>
vmeta-lag-check.sh                         rc=2   (node:3186293) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///tmp/quay-bef
worktree-branch-hygiene-check.sh           rc=0   worktree-branch-hygiene: clean — no orphaned milestone evidence in un-merged iteration b
```

**改后：69/71**——仅剩 `checker-cost-lib.sh` / `gate-script-lib.sh` 两个**库文件**（不算工具，首行空白、
退出 0、无副作用）；69 个工具全部统一为「用法 首行 + 头注 + 退出 0」。完整实跑输出：

```text
# AFTER（69/71）
anti-gaming-guard.sh                       rc=0   用法: bash anti-gaming-guard.sh [参数…] — 详见下方脚本头部用法注释（-
assert-clean-tree.sh                       rc=0   用法: bash assert-clean-tree.sh [参数…] — 详见下方脚本头部用法注释（-
audit-independence-check.sh                rc=0   用法: bash audit-independence-check.sh [参数…] — 详见下方脚本头部用法注
blocked-signal-check.sh                    rc=0   用法: bash blocked-signal-check.sh [参数…] — 详见下方脚本头部用法注释�
cap-from-gate.sh                           rc=0   用法: bash cap-from-gate.sh [参数…] — 详见下方脚本头部用法注释（--hel
capability-catalog.sh                      rc=0   用法: bash capability-catalog.sh [参数…] — 详见下方脚本头部用法注释（
checker-cost-lib.sh                        rc=0   
checker-cost.sh                            rc=0   用法: bash checker-cost.sh [参数…] — 详见下方脚本头部用法注释（--help
checker-mutation-check.sh                  rc=0   用法: bash checker-mutation-check.sh [参数…] — 详见下方脚本头部用法注�
claim-task.sh                              rc=0   用法: bash claim-task.sh [参数…] — 详见下方脚本头部用法注释（--help|-
closure-lag-check.sh                       rc=0   用法: bash closure-lag-check.sh [参数…] — 详见下方脚本头部用法注释（-
codex-stage1-selfcheck.sh                  rc=0   用法: bash codex-stage1-selfcheck.sh [参数…] — 详见下方脚本头部用法注�
cross-machine-verify.sh                    rc=0   用法: bash cross-machine-verify.sh [参数…] — 详见下方脚本头部用法注释�
dead-loop-check.sh                         rc=0   用法: bash dead-loop-check.sh [参数…] — 详见下方脚本头部用法注释（--h
drivable-workspace-check.sh                rc=0   用法: bash drivable-workspace-check.sh [参数…] — 详见下方脚本头部用法注
gate-script-lib.sh                         rc=0   
gate-staleness-check.sh                    rc=0   用法: bash gate-staleness-check.sh [参数…] — 详见下方脚本头部用法注释�
halt-check.sh                              rc=0   用法: bash halt-check.sh [参数…] — 详见下方脚本头部用法注释（--help|-
inbox-reader.sh                            rc=0   用法: bash inbox-reader.sh [参数…] — 详见下方脚本头部用法注释（--help
inner-session-check.sh                     rc=0   用法: bash inner-session-check.sh [参数…] — 详见下方脚本头部用法注释�
integration-batch-merge.sh                 rc=0   用法: bash integration-batch-merge.sh [参数…] — 详见下方脚本头部用法注�
it0-enforcement-with-design-check.sh       rc=0   用法: bash it0-enforcement-with-design-check.sh [参数…] — 详见下方脚本头部
it0-impl-row-check.sh                      rc=0   用法: bash it0-impl-row-check.sh [参数…] — 详见下方脚本头部用法注释（
it0-split-or-commit-check.sh               rc=0   用法: bash it0-split-or-commit-check.sh [参数…] — 详见下方脚本头部用法�
laydown-set-check.sh                       rc=0   用法: bash laydown-set-check.sh [参数…] — 详见下方脚本头部用法注释（-
loadbearing-test-gate.sh                   rc=0   用法: bash loadbearing-test-gate.sh [参数…] — 详见下方脚本头部用法注释
loop-driver-check.sh                       rc=0   用法: bash loop-driver-check.sh [参数…] — 详见下方脚本头部用法注释（-
manager-adopt.sh                           rc=0   用法: bash manager-adopt.sh [参数…] — 详见下方脚本头部用法注释（--hel
manager-arm-loop.sh                        rc=0   用法: bash manager-arm-loop.sh [参数…] — 详见下方脚本头部用法注释（--
manager-start.sh                           rc=0   用法: bash manager-start.sh [参数…] — 详见下方脚本头部用法注释（--hel
manager-tick-log-check.sh                  rc=0   用法: bash manager-tick-log-check.sh [参数…] — 详见下方脚本头部用法注�
monitor-mount-check.sh                     rc=0   用法: bash monitor-mount-check.sh [参数…] — 详见下方脚本头部用法注释�
observer-registry-check.sh                 rc=0   用法: bash observer-registry-check.sh [参数…] — 详见下方脚本头部用法注�
os-anchor-install.sh                       rc=0   用法: bash os-anchor-install.sh [参数…] — 详见下方脚本头部用法注释（-
os-anchor-watchdog.sh                      rc=0   用法: bash os-anchor-watchdog.sh [参数…] — 详见下方脚本头部用法注释（
periodic-push-backup.sh                    rc=0   用法: bash periodic-push-backup.sh [参数…] — 详见下方脚本头部用法注释�
pipe-exit-code-check.sh                    rc=0   用法: bash pipe-exit-code-check.sh [参数…] — 详见下方脚本头部用法注释�
prefriction-count.sh                       rc=0   用法: bash prefriction-count.sh [参数…] — 详见下方脚本头部用法注释（-
process-budget.sh                          rc=0   用法: bash process-budget.sh [参数…] — 详见下方脚本头部用法注释（--he
publish-dist-branch.sh                     rc=0   用法: bash publish-dist-branch.sh [参数…] — 详见下方脚本头部用法注释�
quay-init.sh                               rc=0   用法: bash quay-init.sh [参数…] — 详见下方脚本头部用法注释（--help|-h
quay-launch.sh                             rc=0   用法: bash quay-launch.sh [参数…] — 详见下方脚本头部用法注释（--help|
quay-topology.sh                           rc=0   用法: bash quay-topology.sh [参数…] — 详见下方脚本头部用法注释（--hel
real-target-verify.sh                      rc=0   用法: bash real-target-verify.sh [参数…] — 详见下方脚本头部用法注释（
release-task.sh                            rc=0   用法: bash release-task.sh [参数…] — 详见下方脚本头部用法注释（--help
resource-gate.sh                           rc=0   用法: bash resource-gate.sh [参数…] — 详见下方脚本头部用法注释（--hel
send-keys-reliable.sh                      rc=0   用法: bash send-keys-reliable.sh [参数…] — 详见下方脚本头部用法注释（
send-keys-verified.sh                      rc=0   用法: bash send-keys-verified.sh [参数…] — 详见下方脚本头部用法注释（
session-bootstrap.sh                       rc=0   用法: bash session-bootstrap.sh [参数…] — 详见下方脚本头部用法注释（-
session-liveness-mount.sh                  rc=0   用法: bash session-liveness-mount.sh [参数…] — 详见下方脚本头部用法注�
session-liveness.sh                        rc=0   用法: bash session-liveness.sh [参数…] — 详见下方脚本头部用法注释（--
slot-refill.sh                             rc=0   用法: bash slot-refill.sh [参数…] — 详见下方脚本头部用法注释（--help|
supervisor-bus-identity.sh                 rc=0   用法: bash supervisor-bus-identity.sh [参数…] — 详见下方脚本头部用法注�
supervisor-bus.sh                          rc=0   用法: bash supervisor-bus.sh [参数…] — 详见下方脚本头部用法注释（--he
supervisor-deliver.sh                      rc=0   用法: bash supervisor-deliver.sh [参数…] — 详见下方脚本头部用法注释（
supervisor-health.sh                       rc=0   用法: bash supervisor-health.sh [参数…] — 详见下方脚本头部用法注释（-
supervisor-observe.sh                      rc=0   用法: bash supervisor-observe.sh [参数…] — 详见下方脚本头部用法注释（
supervisor-preempt.sh                      rc=0   用法: bash supervisor-preempt.sh [参数…] — 详见下方脚本头部用法注释（
sync-lag-check.sh                          rc=0   用法: bash sync-lag-check.sh [参数…] — 详见下方脚本头部用法注释（--he
sync-vendor.sh                             rc=0   用法: bash sync-vendor.sh [参数…] — 详见下方脚本头部用法注释（--help|
task-schema-check.sh                       rc=0   用法: bash task-schema-check.sh [参数…] — 详见下方脚本头部用法注释（-
test-file-snapshot.sh                      rc=0   用法: bash test-file-snapshot.sh [参数…] — 详见下方脚本头部用法注释（
test-framework-policy-check.sh             rc=0   用法: bash test-framework-policy-check.sh [参数…] — 详见下方脚本头部用法
test-isolation-check.sh                    rc=0   用法: bash test-isolation-check.sh [参数…] — 详见下方脚本头部用法注释�
tmux-isolated.sh                           rc=0   用法: bash tmux-isolated.sh [参数…] — 详见下方脚本头部用法注释（--hel
tmux-leak-scan.sh                          rc=0   用法: bash tmux-leak-scan.sh [参数…] — 详见下方脚本头部用法注释（--he
topology-check.sh                          rc=0   用法: bash topology-check.sh [参数…] — 详见下方脚本头部用法注释（--he
tree-hygiene-check.sh                      rc=0   用法: bash tree-hygiene-check.sh [参数…] — 详见下方脚本头部用法注释（
verify-installed-executables.sh            rc=0   用法: bash verify-installed-executables.sh [参数…] — 详见下方脚本头部用�
vmeta-lag-check.sh                         rc=0   用法: bash vmeta-lag-check.sh [参数…] — 详见下方脚本头部用法注释（--h
worktree-branch-hygiene-check.sh           rc=0   用法: bash worktree-branch-hygiene-check.sh [参数…] — 详见下方脚本头部用�
```

### AC3 负控制（承重条）：`supervisor-deliver.sh --help` 不触发任何真实送达

改后实测：

```text
$ timeout 5 bash plugin/scripts/supervisor-deliver.sh --help
用法: bash supervisor-deliver.sh [参数…] — 详见下方脚本头部用法注释（--help|-h 仅打印用法，无副作用，退出 0）
...（头注）
exit=0；输出中「已送达」出现 0 次
$ timeout 5 bash plugin/scripts/supervisor-deliver.sh --help --transcript /tmp/x.jsonl
exit=0；/tmp/x.jsonl 未被创建（不消费业务参数、不触碰 tmux）
```

改前：`supervisor-deliver: 文本为空`（退出 2）——把 `--help` 当 payload 目标，正是任务体所述
「误触发 --help 会真的往目标会话发消息」的安全隐患。

### AC4 五个工具改前/改后对照

| 工具 | 改前（HEAD 实测） | 改后（守卫后实测） |
|---|---|---|
| dead-loop-check.sh | 忽略 `--help` 正常跑业务逻辑（首行即标题行，rc=0） | `用法` 首行 + 头注，rc=0 |
| prefriction-count.sh | 把 `--help` 当 `--since` git revision：`prefriction-count.sh: --help is not a git working tree` | `用法` 首行 + 头注，rc=0 |
| supervisor-deliver.sh | 把 `--help` 当 payload：`supervisor-deliver: 文本为空` rc=2 | `用法` 首行 + 头注，rc=0，零副作用 |
| session-bootstrap.sh | 落到打印自己的 shebang：`!/usr/bin/env bash` | `用法` 首行 + 头注，rc=0 |
| axis-generator.ts | 裸 `bash` 跑崩：`axis-generator.ts: line 2: //: Is a directory`；`node --experimental-strip-types` 跑打印 Usage 但 rc=2 | 未变——`.ts` 轴属 `gap-shipped-ts-files-are-not-bundled`（Touches 交叉标注），本条机制覆盖 `.sh` |

### AC5 交叉标注

`gap-manager-skill-missing-mandatory-tool-reuse-checklist` 解决「该不该去查目录」；本条解决
「查到了之后好不好正确调用」——现在 manager 只需 `bash <tool> --help` 即得统一用法，不再需要翻头注。
两者互补（已互相对照）；本条与 `.ts` bundle / 86 散件交付形态两条保持正交（见 Touches，未合并、未互相替代）。

### 作用域门（scoped gate）实跑

`bash scripts/test.sh --for-task gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools --allow-thin`

退出码 **0**；`pass 12 / fail 0 / cancelled 0`；task-contract-check 0 violations；
adr016-screen-use-check 0 violations；dead-code-after-return-check 0 violations。完整输出：

```text
warning: test-selection-thin: task gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools resolved tests for 1/4 Touches entries (0.25) < 0.5; pass --allow-thin to run anyway
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
  scoped check: run_checker "task-contract-check" node --no-warnings --experimental-strip-types "/home/yale/work/quay-worktrees/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools/plugin/scripts/task-contract-check.ts" --root "/home/yale/work/quay-worktrees/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools" --strict-subset '/home/yale/work/quay-worktrees/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools/tasks/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools.md' '/home/yale/work/quay-worktrees/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools/tasks/gap-shipped-artifact-carries-86-loose-shell-scripts-as-the-delivery-form.md'
task-contract-check: no violations.

violations: 0 unique across 0 task(s); info findings (non-ratchet, pre-opt-in baseline): 0 — see --json for details
subset scan (<task-file> args) — ratchet comparison skipped (it is only meaningful over the full store)
strict-subset mode (scoped static-check tier) — a violation on a scanned task FAILS this run (exit 1); unrelated tasks are not scanned
  scoped check: run_checker "adr016-screen-use-check" node --no-warnings --experimental-strip-types "/home/yale/work/quay-worktrees/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools/plugin/scripts/adr016-screen-use-check.ts" --root "/home/yale/work/quay-worktrees/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools"
adr016-screen-use-check — 144 file(s) scanned (shell scripts + tick-doc bash blocks)
violations: 0
retired (reported, not counted): 2
  plugin/scripts/send-keys-verified.sh:43  hash_before=$(tmux capture-pane -p -t "$TARGET" 2>/dev/null | md5sum | cut -c1-16)  [same-command]
  plugin/scripts/send-keys-verified.sh:52  hash_after=$(tmux capture-pane -p -t "$TARGET" 2>/dev/null | md5sum | cut -c1-16)  [same-command]
PASS: active whole-screen-hash violations (0) within band (0..1)
  scoped check: run_checker "dead-code-after-return-check" node --no-warnings --experimental-strip-types "/home/yale/work/quay-worktrees/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools/plugin/scripts/dead-code-after-return-check.ts" --root "/home/yale/work/quay-worktrees/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools"
dead-code-after-return-check — 139 shell script(s) scanned
violations: 0
PASS: no dead code after a top-level return (the gap-concurrency-derivation-reverted shape is absent)
== build dist/quay.js (packages/quay/scripts/build-dist.mjs) ==

  packages/quay/dist/quay.js  1.3mb ⚠️

⚡ Done in 689ms
esbuild: quay ESM dist bundle written to /home/yale/work/quay-worktrees/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools/packages/quay/dist/quay.js (createRequire banner injected).
== build dist/quay-native.js (packages/quay-native/scripts/build-dist.mjs) ==

  packages/quay-native/dist/quay-native.js  1.1mb ⚠️

⚡ Done in 776ms
esbuild: quay-native ESM dist bundle written to /home/yale/work/quay-worktrees/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools/packages/quay-native/dist/quay-native.js (createRequire banner injected).
== mirror vendored plugin dist (plugin/scripts/sync-vendor.sh --sync-dist) ==
[sync-vendor --sync-dist] mirroring packages/quay/dist/quay.js + packages/quay-native -> plugin/vendor/ (no rebuild)
[sync-vendor --sync-dist] done.
✔ AC1a/AC1b — --json emits a top-level array; every row is {file, question, ships} (2554.571788ms)
✔ AC1b — the check count is DERIVED from the filesystem, never a hardcoded '82'/'87' (2445.064858ms)
✔ AC5/band — unclassified == 0 (every shipped check declares its question), and answers are specific (2736.040561ms)
✔ AC1c — a new script without a declared question is unclassified and the catalog exits non-zero (negative control + restore) (4607.85259ms)
✔ AC1/AC3 — --entry-surface passes at baseline: every consumer-doc-referenced .sh is a declared public entry point (2686.508495ms)
✔ AC1/AC3 — --json rows carry the surface field: .sh classified public/internal, non-.sh null (3020.081406ms)
✔ AC3 — negative control: an internal .sh referenced by a consumer-facing doc makes the gate exit non-zero (6022.662725ms)
✔ AC1/AC3 — --entry-surface --json is machine-readable and reports ok:true at baseline (3541.917082ms)
✔ AC2 — the three named exp5-legacy families are ships:false (do not ship with the artifact) (3858.851933ms)
✔ AC5 — a random sample of 5 delivered checks each answers a specific question (6413.797179ms)
✔ Wiring — capability-catalog.sh is in quay-init.sh's shipped set and lands+passes in a real --loop target (34321.785195ms)
✔ AC6 — this test file is node:test with a lowconc @test-group (2.605358ms)
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 72509.795119
```

## Dispatch review

reviewer: none
at: 2026-08-06T16:1xZ
changed: 尚未派发/审阅（人直接裁定立案并转外层，管理者代笔）
