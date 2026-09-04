---
id: gap-suite-install-family-reduce-runinit
title: 减少「真 quay-init 运行」——install 家族 runInit 17→15（断言迁移到 laydownWorkspace）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

install 家族 3 文件共 17 次 runInit（真 quay-init 运行：runtime 8 / loop 6 / driver 3，grep 实测），每次 spawn quay-init.sh→python3 children，是 per-test 主成本。共享 fixture 已摊销安装，laydownWorkspace（拷贝）是快的。方案 = 把「断言 laid-down 状态」的测试从 runInit 迁到 laydownWorkspace；仅验证「运行行为本身」（exit code / spawn 副作用 / 时序）保留真运行。

**风险**：合并断言面若共享状态不覆盖某断言→假绿。缓解：fixture 保证 byte 一致；迁移后逐测试核对断言面。

## Plan

1. 迁移「断言 laid-down 状态」测试 runInit→laydownWorkspace（runtime AC7b byte-identical bundles + AC3 existence-OK 正向）；仅「运行行为」保留真运行。

## 落地实测 / Finding（2026-08-31 worker）

**结论：立案时的「20 次 runInit、目标 ≤6」基于过时读数与高估的可迁移量。grep 实测基线 17（runtime 8 / loop 6 / driver 3），其中仅 2 条是「断言 laid-down 状态」可迁移，已迁（17→15）；其余 15 条是「运行行为」测试，迁走即丢验证面（违反 AC2）。**

**前提①「20 次 runInit」过时**：`grep -oE 'runInit\('` 实测三文件 = 8+6+3 = **17**，非 20。立案数字多算 3（driver 的 AC6 self-resolve 是直接 `spawnSync('bash', [quay-init.sh…])` 非 runInit；runtime/loop 各多算 1，或为近似读数）。

**前提②「可迁到 ≤6」高估**：可迁移的只有「断言 laid-down 状态」的测试，实测仅 **2 条**（runtime AC7b byte-identical bundles / AC3 existence-OK 正向）。其余 15 条是「运行行为」：
- **loop 6**（auto-commit 全族）：测 auto-commit/non-git/dry-run/decline-confirm。`auto_commit_laid_down` 定义在 quay-init.sh library-mode guard（`:1805`）之后，不可 source 直调；标准 fixture 是非 git 空目录（auto-commit 必 SKIP）——「标准 fixture 不适用」（gap-suite-serial-install-copy-one-subprocess-batching 已判）。
- **driver 3**（referenced⊆landed 负控制 AC2 / AC3 fail+pass）：改 plugin 树（删 monitor-mount-check.sh/send-keys-reliable.sh / 加 ghost 引用）触发 verify 失败/通过，需 fresh install——同任务已判「仅 AC2/AC3/AC6 因改 plugin 树需 fresh install」。
- **runtime 6**（fail-closed / auto-build / migration / gitignore re-run）：文件自注「BEHAVIOR tests… keep their real installs by design」——exit code / 失败副作用 / 时序是被测对象本身。

**⇒ ≤6 需删负控制或 auto-commit 测试，违反 AC2（不丢验证面）⇒ 17→15 是本任务可达的诚实落点。**

**Needs-Human 根因**：此前「连续修满重试上限仍不合格」的直接根因是 fix-worker 落不了 authoring 修复（`fourArtifacts=false missing=[dod]` 假阳性）被重试上限误翻——非本任务实现失败（本任务无 fan-in 记录，实现从未被尝试）。作者面（Proposal/Plan/AC/DoD）已完整（d21b7ceda 回 ready 重派）。

## Acceptance Criteria

- [x] AC1（能取假）：家族 runInit 计数 17→15（grep 机械可查：runtime 8→6，loop 6，driver 3）；（⛔ 仍 >15 ⇒ 假；原「≤6」目标经实测不可达——见「落地实测 / Finding」）。
- [x] AC2（能取假，负控制）：迁移测试断言全过（node --test 实测 2 条绿）+ 断言面由共享状态承载、不丢验证面——AC7b 断言面（byte-identical bundles/provider.yml + config mcp_entry + stdout 报告）由内容寻址 fixture 承载（`_pluginSurfaceHash` 覆盖 vendor dist + provider.yml，byte-identical 恒成立且 copy 腐蚀仍可检出）；AC3 existence-OK 断言面（verify OK）由 fixture 捕获 stdout 承载，其 FAIL 方向由 AC3 负控制（真安装 fail-closed）保留；（⛔ 丢断言面 ⇒ 假）。
- [ ] AC3（能取假）：全量 suite 绿（落地后真实一轮）。（待外部）

## Definition of Done

家族 install 三文件 runInit 计数 17→15（机械 grep 可查：runtime 8→6）；迁移测试断言全过且断言面由共享 fixture 承载、不丢验证面（AC7b / AC3-existence-OK 已迁，逐测试核对）；suite 绿由 fan-in 机械 suite 轮验证（AC3 待外部）。

## Touches

- plugin/test/quay-init-loop-runtime.test.mjs（迁移 AC7b + AC3-existence-OK）
- plugin/test/quay-init-loop.test.mjs（未迁移——auto-commit 全族，见 Finding 前提②）
- plugin/test/quay-init-loop-driver.test.mjs（未迁移——referenced⊆landed 负控制，见 Finding 前提②）
- plugin/test/helpers/quay-init-install-fixture.mjs（无需扩共享面——现有 fixture 已承载断言面）
- tasks/gap-suite-install-family-reduce-runinit.md（自身）

## Needs-Human

**执行 2026-08-31T09:01:33.368Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）

**2026-08-31 worker 复核：根因 = fix-worker 落不了 authoring 修复被重试上限误翻**（详见「落地实测 / Finding」Needs-Human 根因段）——本任务实现从未被尝试（无 fan-in 记录），作者面已完整。
