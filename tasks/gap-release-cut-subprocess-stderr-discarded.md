---
id: gap-release-cut-subprocess-stderr-discarded
title: release-cut 失败时丢弃子进程 stderr ⇒ CAUSE 零诊断（step-6 ratchet 已连续两版触发；同类位点在
  promotion-driver 已修，本文件漏修 4 处）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**来源**：人令「为本项目发布一个新版本」的两轮实跑（2026-10-01 v0.13.0 / 2026-10-04 v0.14.0）。两次都在 `release-cut.sh` 第 6 步以 `CAUSE=release-cut-bump-ratchet-failed` + exit 1 中止，**且输出里没有任何原因**——两次都只能靠人工把被吞掉的命令原样重跑一遍，才确认它单独跑是通过的。

**机制（按位置）**：`plugin/scripts/release-cut.mjs:507` 调用 closure-ratchet 时传 `stdio: ["ignore", "ignore", "ignore"]`，stdout/stderr 全丢。而 ratchet 自己**已经**在 `plugin/scripts/quay-init-closure-ratchet.ts:213` 构造了有用的报错尾部（`err.stderr` 最后 5 行）——这份诊断被丢弃两次（子进程 stderr 被 ignore，且调用方不读 `err`）。

**同类先例（硬规则 5b：修好一处 ≠ 只此一处）**：同形缺陷此前已在 worker-spawn 位点被发现并修好（`tasks/gap-fix-worker-spawn-zero-diagnostic-info.md`，status superseded；`plugin/scripts/promotion-driver.ts:370` 现为 `["ignore","pipe","pipe"]`，注释引 AC142 AC1）。**`release-cut.mjs` 是那次修复漏掉的兄弟位点。** 本文件内同形位点共 4 处：`:450`（`command -v gh`）、`:457`（`gh workflow run`）、`:500`（`stamp-version.ts`）、`:507`（ratchet）；全仓另有 `test-isolation-check.ts:1009`、`test-framework-policy-check.ts:300`。⛔ 只修 `:507` 不算做完。

**修法**：对「失败即报固定 CAUSE」的调用点，stdio 改为捕获 stderr（如 `["ignore","ignore","pipe"]`），并把 stderr 尾部（截断到合理长度）并入该 CAUSE 的文案；探测类调用点（如 `command -v gh`）若保留 ignore，必须写明理由。

**边界（本任务不声称已知根因）**：本任务只做「让下次发生能自证原因」，**不**声称已知第 6 步失败的原因。已用直接测量排除的假设（⛔ 勿重复）：180s laydown 超时（实测 0.53s）、stdio 抑制本身（按脚本原样复现嵌套 `spawnSync` + ignore → exit 0）、stamp→ratchet 顺序（全新 worktree 复现 → 通过）、tmux 会话名冲突（无会话）、磁盘/配额（18%）、与 self-hosted CI 并发（本机即 `tokyo-alpha-1`，job 确在切版后 8s/30s 回到本机，但并发实跑 `--gate` 通过）、HEAD 上版本 tag 与 VERSION 不一致（`resolve-version.ts:38` 会 throw，但遗留 worktree 正处该状态时重跑仍通过）。读数：7 次独立复现全过、2 次脚本内全败。

## AC

- [x] AC1（按位置判定，非关键词）：`plugin/scripts/release-cut.mjs` 中 ratchet `--reanchor` 调用点的 stdio 数组，stderr 槽不再是 `"ignore"`；且该调用点失败时产生的 CAUSE 文案里包含子进程 stderr 的尾部。
- [x] AC2（负控制，真实调用路径）：让 ratchet 在**真实调用路径**上失败（例如把 `--root` 指向缺少 `plugin/scripts/quay-init.sh` 的目录），断言 `release-cut` 的失败输出中 `CAUSE=release-cut-bump-ratchet-failed` 之后**出现 ratchet 的报错文本**。⛔ 不得用「单独调用消息函数」替代——必须是产生该消息的那条代码路径。改造前同一次负控制只输出固定文案，作为对照一并贴出。
- [x] AC3（5b 清扫）：把 `grep -rn 'stdio: \["ignore", "ignore", "ignore"\]' plugin/scripts/*.mjs plugin/scripts/*.ts` 的**全部命中**（当前 6 处）逐条列出并给出处置（修 / 保留+理由）；命中总数与逐条清单贴进任务体。⛔ 只报被报出来的那一处不算完成。
- [x] AC4（正控制不回归）：`plugin/test/release-cut.test.mjs` 全绿（`node --test plugin/test/release-cut.test.mjs` exit 0）；`quay-init-closure-ratchet.ts --gate` 与 `--check-stale` 仍 PASS。
- [x] AC5（变异对照）：新增/扩展的测试在把 stdio **改回** all-ignore 时会变红——把该变异运行的输出贴进任务（证明测试真的在验这件事，而不是恒真）。

## DoD

真实落地（DIR-026 Reading A）：一次**真实**的失败运行——不是 fixture、不是把消息函数单独调一次——在 `release-cut` 第 6 步失败时，其输出**自带** ratchet 报出的原因文本；即「下次再发生，不必再手工考古」。仅「测试存在」不算达标。

## Evidence（实跑读数，2026-10-04）

### AC1 — 按位置判定

`plugin/scripts/release-cut.mjs` ratchet 调用点（现 `:540`）：

```
const reanchored = run("node", ["--experimental-strip-types", ratchet, "--reanchor", "--root", worktree], { stdio: ["ignore", "pipe", "pipe"] });
```

stderr 槽 = `"pipe"`（不再是 `"ignore"`）。CAUSE 文案由新 helper `diagnosticTail()`（`:139`）拼装，**两个流都读**：本仓库 `gate-script-base.ts` 的 `emitVerdict` 家族默认写 **stdout**（`NOT-EVALUATED:` / `FAIL:` 前缀），而 Node/bash 写 stderr——只捕获一个会让 CAUSE 的内容取决于子进程选了哪个流，且「子进程在你捕获的那半个流上没说话」与「子进程什么都没说」会同形（硬规则 5 / 3b）。**实测**：ratchet 的唯一原因在 stdout，stderr 只有 Node 的 MODULE_TYPELESS 警告——只捕获 stderr 会一无所获。

### AC2 — 负控制（真实调用路径）+ 改造前对照

受控失败：把 fixture（本仓库的真 clone）的 `develop` 做成「缺 `plugin/scripts/quay-init.sh` 且已提交」，再跑**真实**的 `bash plugin/scripts/release-cut.sh <v> --root <fixture> --no-push --no-dispatch`。cut 真的走完 finish 落地 tag，在 step 6（ratchet）中止，exit 1。

**改造前**（renderer = develop 原版；固定文案、零原因）：

```
release-branch-finish: trace=/tmp/rcfix2-8YcVaj/repo/.quay/release-branch-finish.jsonl
CAUSE=release-cut-bump-ratchet-failed — the closure-ratchet baseline could not be re-anchored in '/tmp/rcfix2-8YcVaj/repo-worktrees/release-v9.9.7'; committing now would leave the pre-commit guard rejecting later commits, so the bump is NOT committed
```

**改造后**（同一受控失败，v9.9.7，exit 1）：

```
release-branch-finish: trace=/tmp/rcfix3-g5v6IF/repo/.quay/release-branch-finish.jsonl
CAUSE=release-cut-bump-ratchet-failed — the closure-ratchet baseline could not be re-anchored in '/tmp/rcfix3-g5v6IF/repo-worktrees/release-v9.9.7' (ratchet exited 3); committing now would leave the pre-commit guard rejecting later commits, so the bump is NOT committed. The ratchet's own verdict — stdout: NOT-EVALUATED: quay-init-closure-ratchet: NOT-EVALUATED — plugin/scripts/quay-init.sh not found at /tmp/rcfix3-g5v6IF/repo-worktrees/release-v9.9.7/plugin/scripts/quay-init.sh (cannot re-anchor without a measurement) | stderr: (node:2538716) [MODULE_TYPELESS_PACKAGE_JSON] Warning: …
```

同一条路径已固化为自动测试 `plugin/test/release-cut.test.mjs`（新测试 `a ratchet failure on the REAL cut path carries the ratchet's OWN reason into CAUSE= (not just fixed prose)`），fixture 由新 helper `breakRatchetOnDevelop()` 构造（提交 removal，使树保持 clean 不触发 dirty-tree 前置）。

### AC3 — 5b 清扫：全部 6 处命中 + 处置

改造前 grep：

```
$ grep -rn 'stdio: \["ignore", "ignore", "ignore"\]' plugin/scripts/*.mjs plugin/scripts/*.ts
plugin/scripts/release-cut.mjs:450                        (command -v gh)
plugin/scripts/release-cut.mjs:457                        (gh workflow run)
plugin/scripts/release-cut.mjs:500                        (stamp-version.ts)
plugin/scripts/release-cut.mjs:507                        (ratchet --reanchor)
plugin/scripts/test-framework-policy-check.ts:300         (gitHeadExists)
plugin/scripts/test-isolation-check.ts:1009               (gitHeadExists)
```

| # | 位点 | 处置 |
|---|---|---|
| 1 | `release-cut.mjs` `command -v gh`（现 `:481`） | **保留 + 理由**：纯存在性探测，信号只有 exit status；`command -v` 失败时两个流都没有可并入的内容，CAUSE 已陈述测得的事实（`'gh' is not on PATH`）。理由写在代码注释里。 |
| 2 | `release-cut.mjs` `gh workflow run`（现 `:488`） | **修** → `["ignore","pipe","pipe"]` + `diagnosticTail` |
| 3 | `release-cut.mjs` `stamp-version.ts`（现 `:532`） | **修** → 同上 |
| 4 | `release-cut.mjs` ratchet `--reanchor`（现 `:540`） | **修** → 同上（本任务主体） |
| 5 | `test-framework-policy-check.ts:300` `gitHeadExists` | **保留 + 理由**：`execFileSync(... rev-parse --verify HEAD)` 的布尔存在性探测，调用方 catch 成 `false`，只有「成/不成」有意义。 |
| 6 | `test-isolation-check.ts:1009` `gitHeadExists` | **保留 + 理由**：与 #5 同形（同源 helper）。 |

修后复跑同一 grep：仅剩 #1/#5/#6 三处，全部为存在性探测，代码内均写明保留理由。

### AC4 — 正控制不回归

```
$ node --test plugin/test/release-cut.test.mjs
ℹ tests 8   ℹ pass 8   ℹ fail 0

$ node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --gate --root <wt>
PASS: quay-init laydown footprint 3 files / 1022 bytes ≤ baseline 3 files / 1022 bytes (shrink-only holds)   [exit 0]

$ node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --check-stale --root <wt>
PASS: quay-init-closure-ratchet: laydown source fingerprint fresh (5f79be034a0c0303…, 4 sources) — baseline in sync   [exit 0]
```

### AC5 — 变异对照（把 ratchet stdio 改回 all-ignore）

把 `:540` 的 `["ignore","pipe","pipe"]` 改回 `["ignore","ignore","ignore"]` 后复跑新测试 → 变红：

```
✖ a ratchet failure on the REAL cut path carries the ratchet's OWN reason into CAUSE= (not just fixed prose) (2480ms)
  AssertionError [ERR_ASSERTION]: the ratchet's own verdict must follow the CAUSE on the same line, not be discarded:
  CAUSE=release-cut-bump-ratchet-failed — … The ratchet's own verdict — the child wrote nothing to stdout or stderr
    expected: /CAUSE=release-cut-bump-ratchet-failed[^\n]*plugin\/scripts\/quay-init\.sh not found/
ℹ tests 1   ℹ pass 0   ℹ fail 1
```

→ 测试验的是「捕获」这件事，不是恒真。变异后用 cp 备份还原（`release-cut.mjs` md5 一致：`c2bcc7b69cc7a53419324b12e226a69c`）。

### DoD

`release-cut` 第 6 步（ratchet）失败时，输出**自带** ratchet 的原因文本（AC2 改造后读数：真实 cut 路径——`release-branch-finish.sh --cut` 已落地 tag → bump 阶段 ratchet 真失败 → exit 1 → CAUSE 行携带 ratchet 的 `NOT-EVALUATED … quay-init.sh not found`）。受控失败用的是本任务 AC2 自己给出的注入方式，不是把消息函数单独调一次；失败发生在真实渲染器代码路径上，由真实的 carrier 与真实的 ratchet 子进程驱动。**边界（同 Proposal）**：本任务不声称已知 v0.13.0/v0.14.0 真正失败的原因——它保证的是「下次再发生，输出自带原因」。

## Touches

- plugin/scripts/release-cut.mjs
- plugin/test/release-cut.test.mjs
- tasks/gap-release-cut-subprocess-stderr-discarded.md
