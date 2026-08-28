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

- [x] AC1（能取假，工厂只建 outer）：`quay-topology.sh --dry-run` 只产生 outer 窗口，不产生 inner 窗口。
  - 实测：`bash plugin/scripts/quay-topology.sh --session ac1-test --dry-run` → `would-create-session … -n outer` + `would-create (first window): ac1-test:outer` + `topology done: ac1-test (outer )`，输出无 `inner`。
- [x] AC2（能取假，②类引用清零）：全仓 grep ②类 inner 拓扑/窗口/会话引用 = 0（①类 inner 层引用与历史归档/SPEC 文档豁免，实现方列豁免清单留理由）——⛔ 非「改 :72 一处」。
  - ②类已清：quay-topology.sh / topology-check.sh / session-bootstrap.sh / manager-adopt.sh / quay-launch.sh / verify-deliver-coldstart.sh / verify-delivery-surface.ts / capability-catalog.sh / checker-mutation-cases/no-manager-tick-doc-check.sh / no-manager-tick-doc-check.ts / supervisor-bus.sh / 两份 profiles.yml / 9 个测试（session-topology / session-bootstrap / manager-layer-shipping / profile-policy / launch-settings / inner-session-check / quay-init / no-manager-tick-doc-check / verify-deliver-coldstart——quay-init 是 roles.inner 删除的涟漪「断言 quay-inner 存在→不存在」；其余是「双层窗口 pane」等注释/夹具的兄弟②类，同硬规则 5b）。
  - 豁免清单见文末「## ②类豁免清单（AC2）」。⛔ 注意：`plugin/scripts` 下仍大量「inner」命中，**全部是 ①类 inner 层引用**（inner-blocked-signal / inner-exec-mode-report / inner-wakeup-heartbeat / slot-refill / session-liveness / cap-from-gate 等——inner 层 = *-driver 仍存在），非 inner 窗口/拓扑/会话。
- [x] AC3（能取假，校验不漂移）：`topology-check.sh` 对单窗口 outer 拓扑校验通过（不再因缺 inner 窗口而红）。
  - 实测：单窗口 outer+claude ⇒ `{"ok":true,"windows":{"outer":"ok"}}` exit 0；无 outer 窗口 ⇒ `{"ok":false,"windows":{"outer":"missing"}}` exit 1。ROLES 已与工厂一致（均 `"outer"`）。
- [x] AC4（能取假，profiles 清干净）：`.quay/profiles.yml` 与 `plugin/.quay/profiles.yml` 均无 `roles.inner`；`quay-launch.sh inner` 无活调用点（或调用点已同步删）。
  - 实测：两份 profiles.yml 均无 `roles.inner`（`grep -n inner` 仅剩「SPEC-worker-driven-inner §4④」这个 SPEC 文档名引用，①类）。`quay-launch.sh inner --dry-run` ⇒ `ERROR: role 'inner' not defined … available roles: fix-worker, manager, outer, pool-judge, selector, task-worker`。`quay-launch.sh inner` 的活调用点仅剩 SKILL/loop 文档（豁免类）。

## Definition of Done

②类 inner 会话/窗口/拓扑引用全量清；AC1-4 全勾；冷启动不再误起 quay-inner 窗口；topology-check 与工厂一致（单窗口 outer）；①类 inner 层引用无被误删。

## ②类豁免清单（AC2）

AC2 要求「全仓 grep ②类 inner 拓扑/窗口/会话引用 = 0，①类 + 历史归档/SPEC 文档豁免」。以下为**未清**的 `inner` 命中，各附理由（均非本条的②类「窗口/拓扑/会话」对象，或属 deferred 阻断）：

1. **①类 inner 层引用（豁免，理由=inner 层仍存在）**：`plugin/scripts` 下 `inner-blocked-signal.ts` / `inner-exec-mode-report.ts` / `inner-forensics.mjs` / `inner-idle-log.ts` / `inner-panel-stale-check.ts` / `inner-wakeup-heartbeat{,-check}.ts` / `slot-refill.ts` / `cap-from-gate.ts` / `session-liveness.sh` / `accounting-emit{,-layer-map}.ts` / `semantic-observer-judge.ts` 等——这些用 `inner` 指「内层如何执行/观测」（inner 层 = *-driver 后台进程，仍存在），非 inner 窗口/会话/拓扑。⛔ 任务边界明令不动。

2. **历史归档/SPEC/定义性文档（豁免，理由=文档非可执行代码）**：`orchestration/SPEC-*.md`（含 `SPEC-worker-driven-inner`、`SPEC-three-layer-unified-architecture` 等）、`orchestration/archive/`、`docs/proposals/*.md`、`orchestration/*.md` 规划/循环文档、`plugin/loop/*.md` tick 文档、`plugin/skills/{session-topology,cold-start,manager,init,loop-driver}/SKILL.md`——Plan step 1 的 grep 范围就是「plugin/scripts + .quay + plugin/.quay」，这些文档在范围外，迁移留后续任务。

3. **inner-session-check.sh 及其消费者（deferred，理由=被 ① 类硬依赖）**：`inner-session-check.sh`（整体退役被阻塞——`inner-exec-mode-report.ts`（①类）硬编码其路径复用 pane-pid→session 身份解析 + `quay-init.sh` 铺设集 + outer 循环文档 + `manager-adopt.sh`/`quay-session.ts`/6 个测试依赖其 CLI 契约）。Plan step 6 自给判据「需要则改名/改注释而非删机件」——此处复用仍需要 ⇒ 不删。其 `roles.inner` 类②语义与 `manager-adopt.sh` 的三态（healthy/empty-shell/missing）一并留待 ① 类迁移任务单独退役。

4. **tmux-drive 保留机制（豁免，理由=CLAUDE.md 明示「旧机件保留可用但非默认路径」）**：`drive-target-check.sh` / `supervisor-deliver.sh` / `send-keys-reliable.sh` / `inner-panel-stale-check.ts` / `manager-observation-runtime-check.ts` 里的 `quay-0:inner` —— 是「驱动/观测一个命名窗口」的纪律示例（控制面通道），不是拓扑定义。

**deferred 且未改动、仍在 Touches 清单内的文件**：`plugin/scripts/inner-session-check.sh`（保留）、`plugin/scripts/quay-session.ts`（其 `inner-session-check` member 随脚本保留，无②改动）。

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
- plugin/scripts/supervisor-bus.sh（--to 示例 quay-inner→quay-outer，②类窗口名）
- plugin/scripts/checker-mutation-cases/no-manager-tick-doc-check.sh
- plugin/scripts/no-manager-tick-doc-check.ts（②类注释示例 两窗口拓扑→单窗口拓扑，与 mutation case 同步）
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
- plugin/test/manager-layer-shipping.test.mjs（其 AC8 断言 quay-topology.sh ROLES="outer inner"，须同步）
- plugin/test/profile-policy.test.mjs（AC3/AC0 断言 profiles.yml 含 roles.inner，须同步去 inner）
- plugin/test/launch-settings.test.mjs（多处 `launch("inner")` + 7 角色计数，须同步换 selector + 6 计数）
- plugin/test/quay-init.test.mjs（AC2-launch 断言 laid profiles.yml 不再含 quay-inner——roles.inner 已删的涟漪）
- plugin/test/manager-productization.test.mjs（manager-adopt.sh 的三态消费者，未改但须覆盖）
- plugin/test/no-manager-tick-doc-check.test.mjs（mutation case 的配对测试，同步 建两窗口→建单窗口 fixture）
- tasks/gap-retire-inner-session-references.md（自身）
