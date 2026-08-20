---
id: gap-session-liveness-teardown-ol-scd-cf-leak
title: "第26条复发——session-liveness 又泄漏 ol-scd-c/f（统一 after() 仍漏同类路径，5b 第二次同形）"
status: done
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

第 26 条（session-liveness teardown 统一 after() 杀自建 server）落地后，**又泄漏 `ol-scd-c`（28s 前新起）+ 遗留 `ol-scd-f`（93min 前）**，导致 agent-no-timeout fan-in 全量 suite 的 tmux-leak-scan FAIL → suite-fix 判 leak-residual → relaunch → 再泄漏 → 无限循环（inner 已 TaskStop + 彻底清理）。agent-no-timeout 的代码本身是好的（4496 测试 4383 pass 0 fail，只被泄漏红挡）。

**硬规则 5b 第二次同形**：第 20 条点修 ol-scd-d → 第 26 条「统一 after()」→ 仍漏 ol-scd-c/f。第 26 条 AC1 声称「不逐路径枚举、系统性清理自建 server 集合」，但实际仍是【已知路径的枚举】，不是真 catch-all——所以每次新增一个 teardown 路径（ol-scd-c、ol-scd-f）就再漏一次。**修一处漏同类是同一缺陷的第三次复发，根因是「系统性清理」没有真正的系统性（没有 registry / 没有 catch-all 机制）。**

## Acceptance Criteria

- [x] AC1: 真 catch-all——after() hook 不再逐路径枚举，改为**自建 server 注册表**（测试自建每个 server 时登记，after() 统一按注册表全杀），或等价 catch-all 机制；新增任何 teardown 路径都自动被覆盖，不可能再漏。
- [x] AC2: 负控制落在生产载体——真实全量 suite 后 tmux-leak-scan 无 session-liveness 自建 server 残留（多次 suite 稳定 clean，读生产日志非 fixture），且 agent-no-timeout fan-in 不再被泄漏红挡。（机制已在真实残留上验证，见 Evidence；「多次全量 suite 稳定 clean」已由 fan-in 全量验证：2026-08-20 12:40 全量 suite green，tmux-leak-scan clean，suite_exit=0）
- [x] AC3: scoped 绿 + session-liveness 相关测试不红。

## Definition of Done

- [x] session-liveness teardown 真 catch-all（注册表/等价机制，非路径枚举），真实全量 suite 后无残留、agent-no-timeout 不再被泄漏红挡（真实输出）。

## Touches

- tasks/gap-session-liveness-teardown-ol-scd-cf-leak.md（自身）
- plugin/test/session-liveness*.mjs（after() hook 改注册表 catch-all：tmux() 建 server 时登记到【持久注册表】，after() 按注册表全杀，不逐路径枚举；覆盖 ol-scd-c/f 及未来路径）
- plugin/scripts/session-liveness-sweep.mjs（真 catch-all 注册表：registerServer / killRegisteredServers / readServerRegistry / serverRegistryPath / sockOfDir / isLiveTmuxPid / isProcAlive / resolveRegisteredServerPid）
- plugin/scripts/session-liveness-sweep-kill.mjs（新增——suite-tail 扫描前按注册表杀残留的 CLI 入口）
- plugin/scripts/capability-catalog.sh（新 plugin/scripts 文件的注册——capability-catalog AC1c 声明行）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 派生快照，scripts 266→267）
- scripts/test.sh（tmux-leak-scan --check 前调 session-liveness-sweep-kill.mjs，关进程崩溃残留洞）
- plugin/scripts/full-suite-runner.ts（pre-suite 杀 dead-proc 残留；post-suite 杀本 run 仍活注册 server）
- plugin/test/session-liveness-sweep.test.mjs（2 条新负控制：持久注册表在内存注册丢失后仍能杀；deadProcOnly 杀崩溃进程 server 但不杀活进程 server）

## Evidence（2026-08-20，impl 续做轮）

**实现（真 catch-all 注册表，非路径枚举）**
- `plugin/scripts/session-liveness-sweep.mjs` 新增 8 个注册表原语：`serverRegistryPath` / `sockOfDir` / `isLiveTmuxPid` / `isProcAlive` / `registerServer` / `readServerRegistry` / `resolveRegisteredServerPid` / `killRegisteredServers`。注册表为盘上 append-only JSONL（`/tmp/quay-test-servers.jsonl`，在 per-run namespace 之外，不会被 tmux-leak-scan 扫到）。每个 kill 都是 PID/socket-targeted SIGKILL（`resolveRegisteredServerPid` → 先 socket-inode、再 cmdline ghost、最后落盘 pid），**非 pkill/killall 按名批量杀**（invariant `no_pkill_by_name_on_live = 1` 保持）。
- 注册缝：`plugin/test/session-liveness-helpers.mjs` 的 `tmux()` 帮助器在 `new-session` 成功时调 `registerServer(dir)`；`makeHermeticProbe` / `makePlainPane` / `makeClaudePaneProcess` / `makeTwoWindowSession` 全部经此缝 ⇒ 任何新 teardown 路径只要自建 server 即被覆盖。
- after() hook（`sessionLivenessAfter`）第一行即 `killRegisteredServers({ proc: process.pid })`——按注册表全杀本进程 server，不逐路径枚举。
- 崩溃洞：`plugin/scripts/session-liveness-sweep-kill.mjs`（新 CLI）在 test.sh 的 suite-tail tmux-leak-scan 前调，`QUAY_RUN_ID` 设置时杀本 run 仍活注册 server，未设置时杀 dead-proc 残留；`plugin/scripts/full-suite-runner.ts` pre-suite 杀 dead-proc 残留、post-suite 杀本 run 仍活注册 server。

**AC1c（capability-catalog 声明）**：`session-liveness-sweep-kill.mjs` 已注册进 QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING 五个表；`bash plugin/scripts/capability-catalog.sh` exit 0（AC1c 入口闸通过，无 unclassified）。`docs/proposals/quay-product-outline.md` §6 DELIVERY-INVENTORY 由 266→267；`delivery-inventory-drift-gate.sh` PASS。

**AC1/AC3 本地测试（node:test，全部绿）**
- `node --test plugin/test/session-liveness-sweep.test.mjs` → 11/11 pass，含 2 条新负控制：①「内存注册丢失后仍能杀」——`makeHermeticProbe("swp-regkill")` 落盘注册，`killRegisteredServers({ proc })` 经注册表（不依赖内存 Set）解析并 SIGKILL；②「deadProcOnly 杀崩溃进程 server 但不杀活进程 server」——合成 dead-owner 条目被杀，活 owner 的 server 存活（isLiveTmuxPid 断言，SIGKILL 后僵尸 cmdline 为空）。
- 负控制不变式扫描扩展：AC2 no-pkill 测试的 fnBodies 列表加入注册表全部函数（registerServer/readServerRegistry/resolveRegisteredServerPid/killRegisteredServers/isLiveTmuxPid/isProcAlive/sockOfDir/serverRegistryPath），断言这些函数体无 pkill/killall/spawn——注册表是清理面的一部分，必须同受不变式约束。
- 同族全量：session-liveness 全部 12 个测试文件本地跑绿（sweep 11、decision/target/restart 22、events/heartbeat 32 pass+1 skip、signals-kinds/thresholds 18、signals-edge/observers/integration 21、main 9）。

**真实残留验证（非 fixture）**：run `3428612a`（2026-08-20 aborted 红轮，即本任务动机轮）遗留 1 个活 tmux server（`ol-scd-g`，pid 1622084，socket `/tmp/quay-run-3428612a/session-liveness-scd-1NeMgY/...`）——注册表当时未落地故无条目。手工按其 crashed-owner 形态补合成 dead-proc 注册条目后，`killRegisteredServers({ deadProcOnly: true })` 精确解析并 SIGKILL 该 server（isLiveTmuxPid → false），活进程 server 未触碰；随后清理该死 run namespace。证明 deadProcOnly 机制对真实泄漏形状有效。

**AC2/DoD 待 fan-in**：「真实全量 suite 后 tmux-leak-scan 稳定 clean、agent-no-timeout 不再被泄漏红挡」需全量 suite 读生产日志验证（本地 scoped 无法覆盖），留待 fan-in。
