---
id: gap-cold-start-ac8c-key4-teaches-superseded-send-keys-hash
title: cold-start SKILL.md AC8c key 4 (INNER-DRIVEN, lines 49/132/135) still
  teaches send-keys-verified.sh's pane-hash criterion ('exit 0 = pane hash
  changed = delivered') — judged SUPERSEDED tonight (F) with 3 false positives
  (incl. fooling the outer twice); the replacement (send-keys-reliable.sh +
  transcript-delivery-check.ts) is built + tested in the same directory; fix the
  shipped cold-start skill to teach the reliable-send mechanism — a deliverable
  propagating a known defect (same class as the tmpfs-worktree propagation);
  single critical path blocking meta-cc/archguard startup + the manager's
  AC3b/AC-SH
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者关键路径核实（2026-08-05）：meta-cc/archguard 启动只剩一条真正任务周期——**cold-start SKILL.md
的 AC8c 键 4 INNER-DRIVEN 仍用 `send-keys-verified.sh` 的哈希判据**（第 49/132/135 行，原文写
「exit 0 = pane hash changed = delivered」）。这个判据今晚被 F **判定 superseded**、实测**假阳性 3 次**
（含骗过外层自己两次）；替代品 **`send-keys-reliable.sh` + `transcript-delivery-check.ts`** 今晚已造好
测过、就在同一目录。

**严重性**：出厂的冷启动技能正在教**每个装它的项目**用一个已知不可信的判据——和 tmpfs worktree 随
plugin 传播那条是**同一类问题**（交付物传播已知缺陷）。它同时卡管理者的 AC3b/AC-SH 目标。

**优先级**：这是 meta-cc/archguard 启动的**唯一关键路径**（其余 2 条是几分钟机械操作：刷新已安装插件
01:08 快照 + 侧重跑 quay-init）。

### 选定机制

**把 AC8c 键 4 的交付判据从「哈希」换成「可靠发送机制」**：

1. `plugin/skills/cold-start/SKILL.md` 的 AC8c 键 4（INNER-DRIVEN）改用可靠发送判据——
   `send-keys-reliable.sh` + `transcript-delivery-check.ts`（同一目录，今晚已造好测过）：交付判据 =
   **目标 transcript 出现该驱动文本的 user message**（Fault 5：只有目标 transcript 是可信送达信号），
   不是 pane hash 变化。
2. **哈希判据移除**——SKILL.md 不再出现「pane hash changed = delivered」式判据；send-keys-verified.sh
   的引用改为 reliable-send 机制 + 指向 `orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md`。
3. **交叉标注 F**（superseded 判定）——SKILL.md 注明该判据已被判定不可信，教学指向替代品。

**与 manager-layer umbrella 的关系**：`gap-productize-the-manager-layer` 的 AC3 覆盖冷启动 AC8c 废键
修复（2/6 键），本条把**关键路径那一键**（key 4）隔离成小任务优先落地；umbrella 落地时复用本条结果。

## Acceptance Criteria

- [x] AC1: cold-start SKILL.md AC8c 键 4 改用可靠发送判据（transcript-delivery-check.ts /
      send-keys-reliable.sh）——交付判据 = 目标 transcript 出现该驱动文本的 user message，非 pane hash
- [x] AC2: **grep 证明**——`send-keys-verified` / 「pane hash changed」从 cold-start SKILL.md 消失
      （实跑输出贴任务体）
- [x] AC3: 交叉标注 F（superseded 判定）+ `CRYSTALLIZED-reliable-send-2026-08-04.md` 引用
- [x] AC4: 测试用 `node:test` 且带 `// @test-group governance`（若可测试化：SKILL.md 无哈希判据断言）
- [x] AC5: 与 manager-layer umbrella 交叉标注（AC3 覆盖 2/6 键，本条是 key-4 关键路径隔离）

## AC2 实跑输出（贴任务体）

```
$ grep -n 'send-keys-verified\|pane hash' plugin/skills/cold-start/SKILL.md
grep exit=1（1 = 0 命中）——哈希判据从 cold-start SKILL.md 消失
```

作用域测试输出（AC4，`QUAY_TEST_SKIP_STATIC_CHECKS=1`）：

```
$ scripts/test.sh plugin/test/cold-start-skill.test.mjs
✔ AC5 — the cold-start skill exists, is a Monitor-based agent skill, and is registered in plugin.json
✔ AC5 — the skill mounts THE ONE monitor via the Monitor tool (session-liveness-mount.sh; inner-state.sh retired)
✔ AC5 — the skill explicitly forbids nohup
✔ telemetry AC — the skill asserts a real --task-start record in .workflow-events/
✔ AC8c — the skill defines the observable-consequences checklist as a concrete six-key list
✔ AC1 correction — the skill explicitly drives inner via send-keys-reliable.sh (reliable-send), not as a side effect
✔ AC2 — the skill teaches the reliable-send delivery criterion (transcript user message), with zero pane-hash criterion
✔ rehearsal — a real --task-start against a quay-init --loop project writes the .workflow-events/ record the skill asserts
ℹ tests 8   ℹ pass 8   ℹ fail 0   ℹ cancelled 0
EXIT=0
```

## Definition of Done

- [x] AC1–AC5 全部勾上；AC2 实跑输出贴任务体
- [x] 冷启动技能不再教已知不可信判据（哈希 → 可靠发送）；meta-cc/archguard 关键路径解除
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——ROUND 3 正在外层后台跑，本任务只跑作用域测试

## Touches

- plugin/skills/cold-start/SKILL.md（AC8c 键 4 判据替换）
- orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md（引用）
- tasks/gap-productize-the-manager-layer.md（AC5 交叉标注）

## Contract

measure   reliable_send_refs = `grep -c 'transcript-delivery-check\|send-keys-reliable' plugin/skills/cold-start/SKILL.md` stdout 数字段
band      reliable_send_refs >= 1（键 4 已指向可靠发送机制）
invariant no_hash_criterion = 1（SKILL.md 无「pane hash changed = delivered」判据）
invoke    `grep -n 'send-keys-verified\|pane hash' plugin/skills/cold-start/SKILL.md`
control   哈希判据出现 ⇒ 必须为 0 命中（AC2）；可靠发送机制引用 ⇒ ≥1（AC1）
resume    判据替换与交叉标注分两步提交，任一步完成即写盘

## Cross-annotation (2026-08-08, from [[gap-over-90m-false-signal-source-reads-telemetry-not-task-status]])

**同型案例（AC3 交叉标注）**：本任务提到的「92min eaten」与 2026-08-05 的假 OVER90 复发是同一
phantom-in-flight bracket 类——fan-in 落地后 `--task-end` 未写，陈旧 bracket 让 `detectTaskOver90m`
（它读遥测 `inProgress.startedAtMs`，从不读任务自身 status）判出假 over-90m，冻结 inner 44 分钟。
修复已从 over-90m 信号侧落地（task-status 闸：status=ready/done/needs-human 的陈旧 bracket 不再触发；
只有 status 真 `in-progress` 或任务文件缺失才触发）。本条（key4 哈希判据替换）是同类「交付物传播已知
缺陷」的另一个方向（信号判据不可信），交叉标注以供关联检索。

## Dispatch review

reviewer: outer
at: 2026-08-05T05:5xZ
changed: 外层受管理者关键路径核实裁定立案（高优先）。四处收紧：
(1) **关键路径**——meta-cc/archguard 启动唯一任务周期；从 manager-layer umbrella 隔离成小任务立即落地；
(2) **判据替换**——哈希 → 可靠发送（transcript 出现驱动文本 = 可信送达，Fault 5）；
(3) **交付物传播已知缺陷**——同 tmpfs worktree 类，冷启动技能不得教已知不可信判据；
(4) **机械证明**——AC2 grep 哈希判据 0 命中。
status: todo——关键路径，立即派发（不排队）。
