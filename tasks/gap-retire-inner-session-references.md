---
id: gap-retire-inner-session-references
title: inner 会话（tmux 窗口）已由 *-driver 取代——全量清 inner 拓扑引用 + profiles.yml
  roles.inner（quay-topology.sh:72 只是表象）
status: ready
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

inner 层已由 `*-driver`（worker-driver 等后台常驻进程）取代，不再是 tmux 窗口。但「inner 会话/窗口」引用散布多处，冷启动会误拉 obsolete `quay-inner` 窗口（manager 2026-08-27 重启 outer 时实测误起一个、又手动杀）。

**根因（读码确认，非猜测）**：`quay-topology.sh:72` 仍 `ROLES="outer inner"`；`.quay/profiles.yml` 与 `plugin/.quay/profiles.yml`（双副本，均已 tracked，现两副本已 DIFFER）仍定义 `roles.inner`（name=quay-inner）；`quay-launch.sh:13` role 枚举仍含 inner；另有 topology-check / manager-adopt / verify-deliver-coldstart / capability-catalog / verify-delivery-surface / session-bootstrap / quay-session 等 ~10 个活文件按「两窗口 outer+inner」描述或校验拓扑。

**⛔ 边界（两类 inner 引用，只清②别误删①）**：
- ① **inner 层**（仍存在，现为 *-driver 后台进程）——`inner-exec-mode-report.ts` 等按「内层如何执行」用的 inner，⛔ 不动。
- ② **inner tmux 窗口/会话/拓扑**（obsolete）——`quay-topology.sh` ROLES、`profiles.yml` roles.inner、拓扑描述与校验，才是本条清的对象。

**⛔ 单改 `quay-topology.sh:72` 会让 topology-check 等仍按「两窗口 outer+inner」校验 ⇒ 漂移。正解是全量清②类引用，拓扑收敛为「单窗口 outer」（manager 跨项目，不属于项目拓扑）。**

## Plan

1. 全量 grep `inner`（plugin/scripts + .quay + plugin/.quay），逐条落「删/改/留」三类；「留」的写理由（尤其①类 inner 层引用与历史归档 SPEC 文档豁免）。
2. `quay-topology.sh` ROLES 改 "outer"（含头注释 :5/:7/:71）。
3. `.quay/profiles.yml` + `plugin/.quay/profiles.yml` 删 `roles.inner`（⛔ 两副本各自处理，现已 DIFFER 别假设逐字节一致）。
4. `topology-check.sh` 校验改单窗口 outer。
5. `manager-adopt.sh` / `verify-deliver-coldstart.sh` / `verify-delivery-surface.ts` / `capability-catalog.sh` / `session-bootstrap.sh` / `quay-session.ts` 同步去 inner。
6. `inner-session-check.sh` 判是否整体退役（其存在意义=查 inner 会话/窗口；⛔ 但被 `inner-exec-mode-report.ts` 复用做 pane-pid 身份解析——删前先确认该复用是否仍需要，需要则改名/改注释而非删机件）。
7. `quay-launch.sh` role 枚举与 inner 处理同步（⛔ 先 grep 确认无调用点引用 `quay-launch.sh inner`）。

## Acceptance Criteria

- [ ] AC1（能取假，工厂只建 outer）：`quay-topology.sh --dry-run` 只产生 outer 窗口，不产生 inner 窗口。
- [ ] AC2（能取假，②类引用清零）：全仓 grep ②类 inner 拓扑/窗口/会话引用 = 0（①类 inner 层引用与历史归档/SPEC 文档豁免，实现方列豁免清单留理由）——⛔ 非「改 :72 一处」。
- [ ] AC3（能取假，校验不漂移）：`topology-check.sh` 对单窗口 outer 拓扑校验通过（不再因缺 inner 窗口而红）。
- [ ] AC4（能取假，profiles 清干净）：`.quay/profiles.yml` 与 `plugin/.quay/profiles.yml` 均无 `roles.inner`；`quay-launch.sh inner` 无活调用点（或调用点已同步删）。

## Definition of Done

②类 inner 会话/窗口/拓扑引用全量清；AC1-4 全勾；冷启动不再误起 quay-inner 窗口；topology-check 与工厂一致（单窗口 outer）；①类 inner 层引用无被误删。

## Touches

- plugin/scripts/quay-topology.sh
- plugin/scripts/topology-check.sh
- plugin/scripts/manager-adopt.sh
- plugin/scripts/inner-session-check.sh（可能整体退役/改名）
- plugin/scripts/verify-deliver-coldstart.sh
- plugin/scripts/verify-delivery-surface.ts
- plugin/scripts/capability-catalog.sh
- plugin/scripts/session-bootstrap.sh
- plugin/scripts/quay-launch.sh
- plugin/scripts/quay-session.ts
- plugin/scripts/checker-mutation-cases/no-manager-tick-doc-check.sh
- .quay/profiles.yml
- plugin/.quay/profiles.yml
- plugin/test/session-topology.test.mjs（topology 单窗口 outer 测试）
- plugin/test/verify-delivery-surface.test.mjs（delivery-surface 去 inner 测试）
- plugin/test/capability-catalog.test.mjs（capability-catalog 去 inner 测试）
- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/test/session-bootstrap.test.mjs
- plugin/test/quay-session.test.mjs
- plugin/test/inner-session-check.test.mjs
- plugin/test/l1-delivery-surface-check.test.mjs
- tasks/gap-retire-inner-session-references.md（自身）
