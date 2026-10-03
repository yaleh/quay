---
id: gap-release-cut-subprocess-stderr-discarded
title: release-cut 失败时丢弃子进程 stderr ⇒ CAUSE 零诊断（step-6 ratchet 已连续两版触发；同类位点在
  promotion-driver 已修，本文件漏修 4 处）
status: todo
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

- [ ] AC1（按位置判定，非关键词）：`plugin/scripts/release-cut.mjs` 中 ratchet `--reanchor` 调用点的 stdio 数组，stderr 槽不再是 `"ignore"`；且该调用点失败时产生的 CAUSE 文案里包含子进程 stderr 的尾部。
- [ ] AC2（负控制，真实调用路径）：让 ratchet 在**真实调用路径**上失败（例如把 `--root` 指向缺少 `plugin/scripts/quay-init.sh` 的目录），断言 `release-cut` 的失败输出中 `CAUSE=release-cut-bump-ratchet-failed` 之后**出现 ratchet 的报错文本**。⛔ 不得用「单独调用消息函数」替代——必须是产生该消息的那条代码路径。改造前同一次负控制只输出固定文案，作为对照一并贴出。
- [ ] AC3（5b 清扫）：把 `grep -rn 'stdio: \["ignore", "ignore", "ignore"\]' plugin/scripts/*.mjs plugin/scripts/*.ts` 的**全部命中**（当前 6 处）逐条列出并给出处置（修 / 保留+理由）；命中总数与逐条清单贴进任务体。⛔ 只报被报出来的那一处不算完成。
- [ ] AC4（正控制不回归）：`plugin/test/release-cut.test.mjs` 全绿（`node --test plugin/test/release-cut.test.mjs` exit 0）；`quay-init-closure-ratchet.ts --gate` 与 `--check-stale` 仍 PASS。
- [ ] AC5（变异对照）：新增/扩展的测试在把 stdio **改回** all-ignore 时会变红——把该变异运行的输出贴进任务（证明测试真的在验这件事，而不是恒真）。

## DoD

真实落地（DIR-026 Reading A）：一次**真实**的失败运行——不是 fixture、不是把消息函数单独调一次——在 `release-cut` 第 6 步失败时，其输出**自带** ratchet 报出的原因文本；即「下次再发生，不必再手工考古」。仅「测试存在」不算达标。

## Touches

- plugin/scripts/release-cut.mjs
- plugin/test/release-cut.test.mjs
- tasks/gap-release-cut-subprocess-stderr-discarded.md
