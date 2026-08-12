---
id: gap-d24e303c-skill-refs-plugin-loop-violates-ac3
title: d24e303c 把 skills/{init,manager}/SKILL.md 的 manager-loop-tick 引用从
  orchestration/ 改成 plugin/loop/，破坏 quay-init-loop-consumer-doc-refs AC3（shipped
  docs/skills 必须零 plugin/loop/ 引用）——红窗真失败
status: superseded
labels:
  - gap
  - defect
  - red-window
parent: null
children: []
extra: {}
---
---
id: gap-d24e303c-skill-refs-plugin-loop-violates-ac3
title: "d24e303c 把 skills/{init,manager}/SKILL.md 的 manager-loop-tick 引用从 orchestration/ 改成 plugin/loop/，破坏 quay-init-loop-consumer-doc-refs AC3（shipped docs/skills 必须零 plugin/loop/ 引用）——红窗真失败"
status: superseded
role: primitive
labels:
  - gap
  - defect
  - red-window
extra:
  schema: v1
---

**type:** defect

## Finding

2026-08-12 03:34 全量套件红（runId 1d0bac1d, verifiedCommit=c3e051bd, main scope）。唯一失败：`plugin/test/quay-init-loop-consumer-doc-refs.test.mjs` AC3 ——「shipped tick docs + skills 对 `plugin/loop/` 路径引用必须为零」（`plugin/loop/` 是打包源路径，quay-init 不下发给消费方；消费方落点是 orchestration/ + docs/analysis/）。

**隔离重跑确定性复现**（非负载 flake）：
```
+ 'skills/init/SKILL.md: plugin/loop/manager-loop-tick.md'
+ 'skills/manager/SKILL.md: plugin/loop/manager-loop-tick.md'
```

**引入者**：`d24e303c`（manager 裸机安装向量——quay-launch.sh settings 出厂回退 + SKILL 冷启动路径 AC2），在 develop..integration 范围内改了这两个 SKILL.md。diff 显示：
```
+| `plugin/loop/manager-loop-tick.md` | the shipped manager tick TEMPLATE (the npm-pack bare-metal `quay manager start` cold-start vector's arm-loop pointer target — `plugin/loop/` ships in the pack but quay-init does NOT lay it into a project's orchestration/; the manager skill's cold-start vector references it as the pointer) — not a project-laid deliverable — declared so referenced ⊆ landed holds |
+| <!-- reference-doc: plugin/loop/manager-loop-tick.md -->
```
develop 上两文件均为 `orchestration/manager-loop-tick.md`（绿）；d24e303c 改成 `plugin/loop/manager-loop-tick.md`（红）。

## 冲突本质

- **AC3 机械测试**：shipped docs/skills 零 `plugin/loop/` 引用（消费者没有该路径）。
- **manager 意图**：裸机安装向量的 arm-loop 指针要指到打包模板 `plugin/loop/manager-loop-tick.md`（pack 里有、项目里没有），并声明 referenced ⊆ landed holds。
- 机械判据与条文意图冲突，判据是法（test fails）。需要裁定：改 SKILL.md 引用回消费方路径（orchestration/）+ 用其它方式携带模板指针，或给 AC3 测试加豁免（该引用是 pack 上下文合法指针）。

## 修复方向（接法留执行时）

1. 把 `plugin/skills/{init,manager}/SKILL.md` 的 `plugin/loop/manager-loop-tick.md` 引用改回 `orchestration/manager-loop-tick.md`（消费方落点），模板指针需求用注释/另一字段携带；或
2. 给 `quay-init-loop-consumer-doc-refs.test.mjs` AC3 加豁免（明确是 pack 上下文的模板指针，非项目引用）。

## AC

- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）
- [ ] `plugin/skills/{init,manager}/SKILL.md` 不再有 `plugin/loop/` 路径引用（或 AC3 测试明确豁免该形态）
- [ ] 裸机安装向量的 arm-loop 指针仍可达（manager 的 AC2 意图不丢）

## DoD

- [ ] 全量套件绿（外层 verification-round 验证）
- [ ] AC3 测试对 shipped docs/skills 的零 `plugin/loop/` 引用成立

## Evidence

- `git show d24e303c -- plugin/skills/init/SKILL.md`（diff：orchestration/ → plugin/loop/）
- `git show develop:plugin/skills/init/SKILL.md | grep manager-loop-tick`（develop 为 orchestration/ 路径）
- 隔离重跑 `node --test plugin/test/quay-init-loop-consumer-doc-refs.test.mjs`（稳定复现 AC3 失败）

## Superseded (2026-08-12 04:04Z)

前提消失：vhs 侧已按 outer 选项 2 裁定落地（AC3 禁令窄化到「消费方铺设文档」，`plugin/skills/` 是 bundle-source 引用自身模板合法），修复提交 `791b7108`/`87b613ed`/`686b5540`，r314 全绿 3361 pass / 0 fail。已随 `git merge refs/remotes/vhs/integration`（45d1cde1）合入本仓。本任务作废，修法见 vhs 的 AC3 窄化（manager 邮件 manager-vhs-035915-...）。
