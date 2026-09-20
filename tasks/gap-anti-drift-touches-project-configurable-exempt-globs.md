---
id: gap-anti-drift-touches-project-configurable-exempt-globs
title: anti-drift-touches-check 支持目标项目在 .quay/config.yml 配置 anti_drift.exempt
  glob 豁免（barrel 等异常文件与 Touches 互相卡死）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**问题（cloudcli 实证，2026-09-20）**：anti-drift 对 `git diff --name-only <mergeTarget>...HEAD` 的每个文件都要求命中某条 `## Touches` glob，没有任何豁免路径（`fileWithinDeclared`，`plugin/scripts/anti-drift-touches-check.ts:31`）。目标项目 cloudcli 的后端任务因 `server/modules/providers/index.ts`（barrel，实现必然连带改动）未声明而 `out-of-declared`，与「Touches 只声明必要文件」互相卡死。

**发生率读数（硬规则 12）**：cloudcli 已知 1 次；quay 自身历史 0 次（26 个任务/文档 + 13 篇记忆里没有 barrel/lockfile/生成物类命中；gate-events.jsonl 不记录 anti-drift 结果，故读数取自散文记录，是下限）。人 2026-09-20 裁定：**已知 1 次 + 跨项目通用性足够立案**。**本任务非阻塞、低优先级，不作为任何其它任务的依赖。**

**设计（人 2026-09-20 裁定：豁免规则描述的是异常，不用过细机制——`sibling-barrel` 等关联规则明确否决）**：

```yaml
anti_drift:
  exempt:
    - glob: "server/modules/*/index.ts"
      reason: "barrel 再导出"
```

1. **只有一份 glob 列表**：diff 文件命中任一豁免 glob 就不判 `out-of-declared`。无顺序、无取反、无关联条件。放多宽由项目自己决定（`**/index.ts` 也合法），不对豁免 glob 套用 overbroad 检查。
2. **输出必须枚举**：被豁免的文件以 `exempted: [{file, glob}]` 及条数输出，使「豁免了」与「本来没改」可区分（硬规则 3）。
3. **`reason` 必填**：缺失/空串/非列表形态的条目 ⇒ fail-closed 并给出独立报错文案，不得与「通过」同形（硬规则 3b）。
4. **读源 = 主检出（workspace root）的 `.quay/config.yml`，不读 worktree 副本**：该文件被 gitignore（`.gitignore:470`，develop 里不存在），所以「从 mergeTarget 读」不可行；等价防线是任务不能靠改自己 worktree 里的 config 给自己开豁免。脚本目前没有 workspace root 解析，需新增（如经 `git rev-parse --git-common-dir` 反推，不得依赖 cwd）。config 文件不存在 ⇒ 无豁免（与现行为一致），不是错误。
5. **豁免文件不算「做了事」**：一个 diff 若剔除豁免文件后为空，判定与空 diff 完全一致（`--allow-empty` 的 NON-WAIVABLE 语义不动）。
6. **任务间 Touches 重叠检测不改**：豁免仅作用于逐文件的 anti-drift 越界判定，不进 `SKIP_DIRS` / glob 展开逻辑。

**不做**：关联/内建规则、任务级行内豁免标记（`(exempt)`）、对豁免 glob 的 overbroad 校验、config-validate.ts 的新增键校验（校验放在 checker 自身 fail-closed）。

## AC

- [ ] 正向：workspace root 的 config 声明豁免 glob，diff 含一个命中该 glob 且未被 Touches 声明的文件 ⇒ anti-drift exit 0，输出含 `exempted` 枚举（该文件与该 glob）与条数。命令：`node --test experiments/quay-perpetual-stream/test/anti-drift-touches-check.test.mjs`（新增用例）exit 0。
- [ ] 负控制：同一 diff、无该 config ⇒ exit 非 0 且报该文件 `out-of-declared`。该用例在豁免逻辑被关掉时必须转红（同一测试文件内，用例名含 `negative-control`）。
- [ ] 读源：worktree 副本 config 声明了豁免、主检出 config 没有 ⇒ 仍判 `out-of-declared`（用例名含 `worktree-copy-ignored`）。
- [ ] 畸形配置：`exempt` 条目缺 `reason` / `reason` 为空白 / `exempt` 不是列表 ⇒ exit 非 0，文案含 `malformed anti_drift`，且与 `out-of-declared` 文案可区分；无 config 文件 ⇒ 行为与改动前逐字一致（用例名含 `malformed` / `absent-config`）。
- [ ] 剔除豁免文件后 diff 为空 ⇒ 退出码与文案与「空 diff」用例一致（同一测试内并排比较两个 exit code，用例名含 `exempt-only-equals-empty`）。
- [ ] 重叠检测未受影响：`experiments/quay-perpetual-stream/test/anti-drift-touches-check.test.mjs` 既有全部用例仍绿，且 `git diff <mergeTarget>...HEAD -- plugin/scripts/anti-drift-touches-check.ts` 中不含对 `SKIP_DIRS` 及 glob 展开函数的改动（`git diff … | grep -c 'SKIP_DIRS'` 为 0）。
- [ ] 三份载体同步：`diff -q plugin/scripts/anti-drift-touches-check.ts experiments/quay-perpetual-stream/scripts/anti-drift-touches-check.ts` exit 0；`plugin/scripts/dist/anti-drift-touches-check.js` 已重建且 `scripts/test.sh --for-task gap-anti-drift-touches-project-configurable-exempt-globs` exit 0（含 dist 静态门）。
- [ ] 脚本头注释记载 `anti_drift.exempt` 的形态与四条约束：`grep -c 'anti_drift.exempt' plugin/scripts/anti-drift-touches-check.ts` ≥ 1。

## DoD

真实落地判据（DIR-026 Reading A，夹具只是必要不充分）：在一个**真实任务 worktree**（本仓库的任务 worktree，或 cloudcli 中被 barrel 卡住的那个任务）上，于主检出 `.quay/config.yml` 加入一条豁免 glob，经 `worker-driver.ts` 使用的同一 anti-drift 调用（`--task <id> --worktree <dir> --merge-target <ref>`）跑一次，贴出含 `exempted` 枚举的真实输出；撤掉该 config 条目后再跑一次，贴出同一文件的 `out-of-declared`。两次输出都必须来自真实 worktree 而非注入夹具。完成后对 cloudcli 那个被卡住的任务给出处置结论：用新豁免解开，或说明为何仍走「补一行精确声明」。

## Touches

- plugin/scripts/anti-drift-touches-check.ts
- plugin/scripts/dist/anti-drift-touches-check.js
- experiments/quay-perpetual-stream/scripts/anti-drift-touches-check.ts
- experiments/quay-perpetual-stream/test/anti-drift-touches-check.test.mjs
- tasks/gap-anti-drift-touches-project-configurable-exempt-globs.md
