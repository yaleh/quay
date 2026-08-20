---
id: gap-suite-concurrency-env-to-file-fresh-read
title: "suite 并发数 S 从 env 改配置文件（suite 脚本每次新鲜读取）——env fork 继承病根，文件读下一次调用即生效"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`suite_slot_count()`（bash）/ `suiteLockSlotCount()`（TS）读 `QUAY_MAX_CONCURRENT_SUITES` env（default 2）。**env 只在进程 fork 那一刻继承一次**——而 `scripts/test.sh` 是 fan-in 每次 detached 启动的全新进程，但调用者（inner）是长命会话，其 env 在会话启动时已定 ⇒ 改 env（如 launch.settings.json 的 S=1）需重启 inner 才生效，且与「S 是每次 suite 都要新鲜读的并发旋钮」语义不符（人 2026-08-20 裁定：S 应改配置文件、suite 脚本每次新鲜读取）。

**已有先例**：`.quay/config.yml` 的 `loop:` 段 `concurrency: 4` + `concurrency_bands:` 管 Build 派发并发，同一类概念、每次新鲜读。但**不能直接塞 config.yml**——`suite-slot-ssot-check.ts` 的 I4 验证 bash 正本（suite-slot-lib.sh）与 TS 正本（suite-lock-slots.ts）两份独立实现在同一输入下算同一个数（故意双实现互校）。config.yml 是嵌套 YAML，bash 无无依赖 YAML 读法；若 bash 转调 node 读 config.yml，两边不再独立，I4 退化成恒真自证（硬规则 4）。

## Acceptance Criteria

- [x] AC1: 新增纯标量文件 `<suiteLockBase()>.concurrency`（与既有槽文件同目录、同一套 suiteLockBase() 路径解析），内容纯数字如 `"1"`。两个正本**各自独立、原始地读它**——bash `[ -f "$f" ] && cat "$f"`、TS `fs.existsSync && fs.readFileSync(...).trim()`，保住 I4 双实现互校、不引入 YAML 依赖、不让 bash 转调 node。
- [x] AC2: 精度顺序两边一致（沿用现有 seam 约定）：`RESOURCE_GATE_CONCURRENT_SUITES`（测试 seam，env，保留）→ 新文件 → `QUAY_MAX_CONCURRENT_SUITES`（旋钮②，env，可退役）→ 默认 2。文件优先；env 旋钮过渡期保留。
- [x] AC3: 负控制落在生产载体——写文件改 S 值后，下一次 suite 进程（新 detached 进程）立刻读新值（不改 env、不重启），读真实 `suite-lock-slots.ts` 输出非 fixture；`suite-slot-ssot-check.ts` I4 在文件方案下仍 evaluated:true 且 bash==TS。

## Definition of Done

- [x] S 改从配置文件新鲜读（双正本独立读、I4 互校仍有效、无 YAML 依赖），写文件即生效无需重启（真实输出，非 fixture）。commit 9c69b2f0

## Touches

- tasks/gap-suite-concurrency-env-to-file-fresh-read.md（自身）
- plugin/scripts/suite-lock-slots.ts（suiteLockSlotCount 加文件读优先级）
- plugin/scripts/suite-slot-lib.sh（bash 侧同精度顺序文件读）
- plugin/scripts/suite-slot-ssot-check.ts（I4 负控制：文件方案下 bash==TS 仍成立）
- plugin/test/suite-slot-ssot-check.test.mjs（负控制）
