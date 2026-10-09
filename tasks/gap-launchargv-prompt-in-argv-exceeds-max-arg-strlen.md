---
id: gap-launchargv-prompt-in-argv-exceeds-max-arg-strlen
title: launchArgv passes the whole prompt as ONE argv element — meta-driver's
  readings grew past the 128 KiB MAX_ARG_STRLEN, so every semantic round now
  dies on spawn E2BIG
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

该轴仍暗，理由：本任务修的是 Layer 0 spawn 原语的参数传递方式（argv → stdin），不新增/不改变任何包间依赖边、不碰 god-package 候选，故 L_D 与 L_G 两轴对本任务结构性不适用。

## Finding

**本任务是 `gap-meta-driver-snapshot-tracked-changes-reference-error` 的直接后续**：那个 import 修复已经把语义半从 `ReferenceError` 推进到**下一个、独立的**阻塞点，实测转移：

```
2026-09-12T02:37:09Z  E2BIG      ← 迁模块之前（守卫内联，能跑到 spawn）
2026-09-14T02:51:40Z  REF        ← 迁模块之后（守卫裸用，根本到不了 spawn）
2026-10-09T08:52:02Z  E2BIG      ← import 修复后（工作树 mtime 触发的 source-refresh 已加载新代码）
```

即：**guard 已经修好了、生产已在跑新代码**，现在的阻塞是另一个更早存在的缺陷。

**根因（实测，非推断）**：

- `plugin/scripts/driver-runtime.ts:1783` `launchArgv` 末行：`argv.push("-n", resolved.name, "-p", prompt);` —— **整个 prompt 作为单个 argv 元素**传给子进程。
- Linux 的**单参数**上限 `MAX_ARG_STRLEN = 131072 字节（128 KiB）**，本会话用二分实测确认：`spawnSync` 传 131071 字节成功、131072 字节即 `E2BIG`（⛔ 与 `ARG_MAX=2097152` 无关——那是**总**预算，单参数另有一道 128 KiB 的墙）。
- meta-driver 的 readings JSON **实测最大 1,281,521 字节**（2026-10-09T08:52:02Z 那一轮），≈ 单参数上限的 **9.8 倍**。
- ⇒ `spawn` 必然 `E2BIG`。readings 随 goal/AC 累积单调增长（这也是它 09-12 才开始失败的原因）。

**为什么它现在是硬阻塞**：meta-driver 语义半 **0 条 verified**（1,749 条非 verified）。任何「与 monolithic meta-driver 并排对比」的评测（例如 ownership shadow proposer 的对照实验）在语义半不可用时**无法进行**。

**明确非目标**：不改 readings 的内容/形状、不缩小证据面（那是拿信息换通过率）、不动 meta-driver 的判定逻辑、不重启生产 driver。

## Plan

1. 让 `-p` 的 prompt 走 **stdin** 而不是 argv：`claude -p` 在**不接 prompt 参数**时从 stdin 读（`--help` 自述 "useful for pipes"；本会话已确认该形态被接受）。目标形态：`launchArgv` 返回的 argv 里**只留 `-p`**，prompt 作为独立返回值/参数交给 spawn 写入子进程 stdin。
2. `driver-runtime.ts` 的 `runAsync` 现为 `stdio: ["ignore", ...]`——加一条**可选** `stdinData`（缺省 undefined ⇒ 行为逐字不变），写入后 end()。
3. 保持**向后兼容**：现有调用点若不传 stdinData，argv 形态与今天完全一致（小 prompt 的 worker/promotion/quality 不受影响）。⛔ 不做「全量切换」——一次只改真正超限的那条路径，把 blast radius 限制在 meta probe。
4. ⛔ **不得**用「prompt 太大就截断」类降级：那会把「没读全」伪装成「读过了」（硬规则 3b）。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/scripts/meta-driver.ts
- plugin/test/launchargv-stdin-prompt.test.mjs
- tasks/gap-launchargv-prompt-in-argv-exceeds-max-arg-strlen.md

## AC

- [ ] 新增测试：构造一个 >131072 字节的 prompt，经新路径 spawn 一个能回显 stdin 长度的子进程，断言**成功且长度一致**（⛔ 非 fixture 自证——子进程实际读到的字节数是直接量）：`node --experimental-strip-types --test plugin/test/launchargv-stdin-prompt.test.mjs` 退出 0。
- [ ] **负对照**：同一超大 prompt 走**旧的** argv 路径必须 `E2BIG`（证明这条测试真的在测那个墙，而不是恒真）。
- [ ] 既有行为不回退：`node --experimental-strip-types --test plugin/test/driver-runtime-s01.test.mjs` 等既有 driver-runtime 分片全绿。
- [ ] 未传 stdinData 的调用点 argv 形态逐字不变（既有测试的断言即为判据，⛔ 不允许改断言来迁就实现）。
- [ ] 无「截断/降级」分支：`grep -nE "slice\(0,\s*[0-9]{4,}\)|truncat" plugin/scripts/driver-runtime.ts` 在本次新增行上零命中。

## DoD

真实落地 = 修复随本任务提交进 develop，且**生产语义半恢复**：`.quay/meta-driver-round.jsonl` 在提交时刻**之后**出现至少一条 `state:"verified"` 的语义半记录（⛔ 非 fixture；载体 gitignored，执行者在生产机上现场取读数并把时间戳与提交 sha 记入本任务）。若 readings 仍超限或被判为需要更根本的载荷改造（如改用临时文件），如实记录并升级，⛔ 不伪装成已验证。