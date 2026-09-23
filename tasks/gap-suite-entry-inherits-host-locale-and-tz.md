---
id: gap-suite-entry-inherits-host-locale-and-tz
title: scripts/test.sh 不声明 locale/时区而继承宿主——与 CI 已声明的配置背离，3 个测试文件在任何任务的 fan-in 里恒红
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

`scripts/test.sh`（唯一测试入口，ADR-019/DIR-109）**不声明 locale 与时区**，直接继承宿主。本机现状：`LANG=en_US.UTF-8`、`LC_ALL` 为空、`TZ` 为空（CST）。

CI 早就声明了（`.github/workflows/ci.yml:38-40`，`LC_ALL: C.UTF-8` / `LANG: C.UTF-8`，2026-09-16 `gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red`），但**本地入口与 driver 的 fan-in 仍继承宿主** ⇒ 硬规则 5b 形状：同一原则只修了 CI 那一半。

实测（本机，同一 commit，逐字）：

| 文件 | 宿主 env（现状） | `LC_ALL=C.UTF-8 LANG=C.UTF-8 TZ=UTC` |
|---|---|---|
| `plugin/test/laydown-set-check.test.mjs` | 8 pass / 1 fail | **9 / 0** |
| `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs` | 19 / 1 | **20 / 0** |
| `plugin/test/outer-tick-log-check.test.mjs` | 25 / 2 | **27 / 0** |

失败明细是纯排序 collation / 时区分歧（例：`AssertionError: helper derived set must EQUAL quay-init derive_loop_scripts() (single source, no second list)`，`laydown-set-check.test.mjs:95`，分歧项是 `per-task-suite-record.ts` 与 `precommit-guard.ts` 的落位）。

**第二个关键事实：只钉 locale 不够。** 用 CI 逐字的那两条（`LC_ALL=C.UTF-8 LANG=C.UTF-8`）但**不设 `TZ`** ⇒ `outer-tick-log-check` 仍 25 pass / 2 fail；加上 `TZ=UTC` 才 27/0。CI 看不到这一半，是因为它的 runner 本身就是 UTC —— 那正是硬规则 4 推论二的形状：「在本机等价于无限制」的宿主属性不是一个声明。

**影响面**：这三个文件在任何任务的 fan-in 里恒红（与任何 delta 无关），是 `judgeRetryExemption` 判 `own-defect-counted` 的主要来源之一，直接导致任务烧完重试上限被标 needs-human。

## AC

- [ ] AC1（复现固化）贴出上表三条 A/B 读数原文，以及改前 `grep -n -E 'LC_ALL|LANG=|TZ=' scripts/test.sh` 的零命中（先打印命中内容再判，硬规则 2）
- [ ] AC2（修后·位置判定，不是"某个测试恰好绿了"）`scripts/test.sh` 中 `LC_ALL`/`LANG`/`TZ` 被显式 export（贴行使与行号）；且在**不设任何外部 env** 的裸 shell 下跑该入口，上表三个文件全绿（贴读数）
- [ ] AC3（负控制·判据能取假）把钉住那几行注释掉 ⇒ 同一命令下 `outer-tick-log-check` 重新变红（贴两次读数）
- [ ] AC4（与 CI 对齐，且补上 CI 缺的那一半）locale 两条与 `.github/workflows/ci.yml` 逐字一致；同时给 CI 补 `TZ: UTC`，或写明 CI 依赖 runner-UTC 的理由——二选一并说明
- [ ] AC5（生产读数，硬规则 4 推论三）落地后时间窗内一次**真实** fan-in 的 suite 日志里，这三个文件不再出现在 `passed=false` 行（贴日志路径、时间戳晚于落地提交、`grep -c` = 0）
- [ ] AC6 `bash scripts/test.sh --for-task gap-suite-entry-inherits-host-locale-and-tz` 绿

## DoD

真实落地：一次真实 fan-in 的 suite 日志中这三个文件的 `passed=false` 计数为 0（AC5）——⛔ 不是"新增单测通过"。⛔ 不得只改 CI：本缺陷的成因正是"只改了 CI"。

## Touches

- scripts/test.sh
- .github/workflows/ci.yml
- tasks/gap-suite-entry-inherits-host-locale-and-tz.md
