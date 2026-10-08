---
id: gap-tmux-session-lib-archive-candidate-recheck
title: tmux-session.ts/tmux-isolated.sh"生产零消费者可归档"的判断需先核清 hermetic-tmux.mjs 真实依赖
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

`orchestration/SPEC-tmux-retirement-2026-09-03.md` §2.1/§2b.3/Layer 5 对 `plugin/scripts/tmux-session.ts`（"晶化 tmux 库"）和 `plugin/scripts/tmux-isolated.sh` 的归档判断存在内部张力：§2.1/Layer 5 把两者并列断言"生产零 import，可直接归档"；但 §2.1 另一句同时说 tmux-session.ts "只被两个测试 helper 引用"（暗示它不是严格意义上的零消费者孤儿），且 §2b.3 自己要求"删除前必须重新 grep 一次确认当前真实消费者清单，不能直接沿用之前的调查结论"（硬规则⑤来源完备性——这条要求本身还没被执行过）。

本次（2026-10-08，一次架构审查会话 f96878f0-fff1-4415-8dbc-a31140e2a262 的延伸核查）重新 grep 确认：

- `plugin/scripts/tmux-session.ts` 在**生产代码**（`plugin/scripts/*.ts` 非 test）里零 import；真实消费者是 8 个文件：`plugin/test/manager-install-vector.test.mjs`、`manager-productization.test.mjs`、`manager-start.test.mjs`、`supervisor-observe.test.mjs`、`quay-init-tmux-detection.test.mjs`、`tmux-session.test.mjs`、`tmux-test-isolation-check.test.mjs`，以及关键的测试 helper **`plugin/test/helpers/hermetic-tmux.mjs:21`**（`import { tmux } from "../../scripts/tmux-session.ts"`）。
- `hermetic-tmux.mjs` 本身是 SPEC §4"非目标"明确保留的测试基础设施（"不动测试基础设施的 tmux 用量——`hermetic-tmux.mjs`/`tmux-leak-scan.sh`/`tmux-test-isolation-check.ts`"），理由是 ADR-016 相关测试仍需要构造真实 tmux server 验证隔离性。
- 这意味着 `tmux-session.ts` 并非真正的"孤儿"——它是被明确保留的测试基础设施 `hermetic-tmux.mjs` 的**依赖库**。直接归档/删除会打断测试基础设施，与 SPEC §4 非目标自相矛盾。SPEC 文字在"可直接归档"与"只被两个测试 helper 引用"之间留了一处尚未解决的张力，需要在处置前讲清楚，不能直接照字面执行"归档"。
- `plugin/scripts/tmux-isolated.sh` 的消费者情况需单独核实：本次 grep "tmux-isolated" 字符串命中了 `plugin/scripts/tmux-test-isolation-check.ts`、`plugin/scripts/checker-mutation-cases/tmux-test-isolation-check.sh`——但这可能只是文件路径字符串提及（如注释/mutation-case 描述里引用 `tmux-isolated.sh` 这个文件名），而不是真实 import/spawn 调用；本任务要求按位置判定把这个区分做实。

## AC

- [x] 对 `plugin/scripts/tmux-session.ts` 和 `plugin/scripts/tmux-isolated.sh` 各产出一份"真实消费者清单"（按位置判定——真实 import/spawn 调用，不是注释/字符串提及），区分「生产代码消费者」「测试文件消费者」「测试基础设施（hermetic-tmux.mjs 等）消费者」三类，写入落地提交说明
- [x] 明确回答并给出证据：若删除/归档 `tmux-session.ts`，`hermetic-tmux.mjs` 及其依赖它的测试（ADR-016 相关隔离性测试）是否会失败——真实运行一次相关测试（而非猜测），记录命令与结果
- [x] 基于上一条真实结果给出明确结论：「tmux-session.ts 不应归档，因为 hermetic-tmux.mjs 依赖它」或「可以归档，因为 ___」，二选一并附证据，不得停留在"可能可以"这类未证伪的猜测
- [x] 若结论是"可以归档"：实际执行归档（移动/删除+改消费者调用点），`scripts/test.sh` 全量绿；若结论是"不应归档"：在 `orchestration/SPEC-tmux-retirement-2026-09-03.md` 补一条更正说明，消解 §2.1 与 §2b.3 之间的文字张力，不留着自相矛盾的表述

## DoD

`tmux-session.ts`/`tmux-isolated.sh` 的去留不再依赖"大概可以归档"这类未经验证的推测——任务落地后，仓库里对这两个文件的处置状态（保留且注明原因 / 已归档且消费者已改线）与 SPEC 文档的表述完全一致，且有一次真实测试套件运行的证据支撑该结论。

## Touches

- plugin/scripts/tmux-session.ts
- plugin/scripts/tmux-isolated.sh
- plugin/test/tmux-session.test.mjs
- plugin/test/tmux-isolated.test.mjs
- plugin/test/helpers/hermetic-tmux.mjs
- orchestration/SPEC-tmux-retirement-2026-09-03.md
- tasks/gap-tmux-session-lib-archive-candidate-recheck.md
