---
id: codex-stage1-live-proof-check
title: codex-stage1-live-proof-check 只验形状不验真伪
status: ready
labels:
  - gap
  - defect
  - codex
parent: null
children: []
extra:
  schema: execution
---
## Proposal

live-proof-check.ts 头注释声称 validates the SHAPE and self-consistency of the evidence，但实测用全占位符的模板跑它，除了 CAS 的 before==after 一项，其余全部 PASS（session 引用、mutation 字段、scoped commit、schema 等全过）——假证据只要把字符串填满、把 CAS 两个 hash 填成一样，就能 exit 0。它是形状校验不是真伪校验，挡不住伪造。应补真值回读（如按 taskId 回读 live store 验证存在性），或明确标注 shape-only 并把真值检查交给独立审计。

## Plan

1. 固化验证器契约：若保留现有行为，则脚本名、头注释、帮助与输出均明确声明 shape-only，且 exit 0 不代表证据为真；若增加真值模式，则与 shape-only 模式显式分离。
2. 增加独立真值审计：按 evidence 中的 taskId 回读 provider-authoritative live store，核对任务存在性及声明字段；按 commit SHA 回读 Git 对象与改动路径；对真实任务文件执行 schema check。
3. 加入全占位符反例：字符串填满、CAS before/after hash 相等、伪 taskId 与伪 commit 的模板可以满足形状，但必须被承担真值结论的入口拒绝。
4. 保留现有合法 shape/self-consistency 覆盖，并补充真值审计的正例、篡改例和不存在对象例。

## AC

- [x] AC1 `live-proof-check.ts --help`、文件头契约与成功输出明确说明它究竟是 shape-only 还是包含真值验证；任何 shape-only 的 exit 0 均不得表述为证据真实或 real landing 已成立。
- [x] AC2 自动化负例使用字段完整、CAS before/after hash 相等、但 taskId/commit/session 均为占位符的 evidence；承担真值结论的命令必须 nonzero，并指出至少一个无法从 authoritative store 或 Git 回读的对象。
- [x] AC3 真值审计按 taskId 通过 Quay Provider ABI/CLI 回读任务存在性和所声明字段，按 commit SHA 验证对象存在且 changed paths 符合 scoped 声明，并对回读到的任务文件运行 `node plugin/scripts/task-schema-check.ts <task-file>`。
- [x] AC4 正例来自真实任务与真实 scoped commit；篡改任一 taskId、commit SHA、mutation 字段或 scoped path 后，对应负例 nonzero。
- [x] AC5 `node --test plugin/test/codex-stage1-adapter.test.mjs` exit 0，并覆盖 shape-only 契约、全占位符反例、live-store/Git 回读及篡改拒绝。

## DoD

- [x] 一个真实 evidence 记录已实际经过选定机制：shape 检查与独立真值审计均运行，审计从 authoritative task store 和 Git 回读真实对象后通过；同记录的占位符/篡改版本被拒绝。
- [x] DIR-121 或后续任务不再把 shape-only exit 0 当作真实性、real landing 或任务完成证据；真实与形状两个结论在接口、输出和文档中可机械区分。

## Touches

- tasks/codex-stage1-live-proof-check.md
- plugin/scripts/codex-stage1-live-proof-check.ts
- plugin/scripts/codex-stage1-live-proof-audit.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/test/codex-stage1-adapter.test.mjs

## ADR-007 暗轴记录

- 该轴仍暗,理由:本任务为局部缺陷修复(shape-only 契约标注 + 新增真值审计脚本 + 测试),不改包/依赖结构,无可测的 L_D/L_G 读数。