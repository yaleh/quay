---
id: gap-mcp-server-test-deadlocks-at-high-test-concurrency
title: packages/quay/test/mcp-server.test.mjs 在 --test-concurrency=16 下死锁（ep_poll 持 socket 句柄不释放, 14+ 分钟无 CPU 进展, pcpu≈0.9%）——同机 conc=4 23.2s passed、orangevps conc=4 20.2s passed ⇒ 只在高并发触发, 是并发相关的资源竞争/死锁非环境缺失; 影响 16-32 核机器的并发验证, 建议修复
status: ready
labels:
  - gap
  - defect
  - performance
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**mcp-server.test.mjs 在高测试并发下死锁（manager 2026-08-11 10:2x，已复现已确认，非猜测）**：`--test-concurrency=16` 下卡 `ep_poll`，持有若干 socket 句柄不释放，14+ 分钟无 CPU 进展（strace wchan=ep_poll, pcpu≈0.9%）。同一文件同机 conc=4 = 23.2s passed；orangevps conc=4 = 20.2s passed ⇒ **只在高并发下触发，并发相关的资源竞争/死锁，不是环境缺失**。现场进程已 `kill -9` 终止（批次继续），死锁证据（PID/句柄快照）未保留；复现建议：16-32 核机器 `--test-concurrency=16` 单跑该文件循环多次。

**影响面**：boheidc lane16（16核，无 systemd 配额）main 相撞此死锁；剔除异常值后 sum=1493s/289 文件、理论地板(÷16)≈93.3s（未经验证轮，死锁修复后重跑拿真值）。

### 机制推断（manager 现场确认 + outer 复核）

`packages/quay/src/mcp-server.ts` 用 `StdioServerTransport`（@modelcontextprotocol/sdk），server 注册资源/工具、子进程经 stdio 通道。死锁形状 = **socket 句柄不释放 + ep_poll 无 CPU 进展**，与 32-48 并发进程共享同一批 socket 描述符的争用/泄漏一致。**这不是能由 manager 修的产品代码，归属 inner 任务**（判定归 outer）。

### 复现（DoD 前须完成）

16-32 核机器：`node --test-concurrency=16 --test packages/quay/test/mcp-server.test.mjs` 循环 ≥3 次，任一命中断言前挂起 >5min 且 wchan=ep_poll 即复现。

### 验证锚

修后 (a) conc=16 单跑该文件循环 ≥3 次全绿、无挂起；(b) conc=4 回归不坏（本机 23.2s 基线）；(c) socket/句柄无泄漏（修复后 16 并发下 fd 计数稳定）；(d) `--for-task` scoped 门绿；(e) 全量套件不回归。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录死锁证据（ep_poll/socket 句柄/无 CPU 进展/**三次**：①lane16 全量 main 尾声 conc=16 ②main-only 第 305/305 文件 conc=8 ③main-only 第 ~613 文件 conc=16）+ conc=4 对照（本机 23.2s / orangevps 20.2s，均孤立小批次）+ 影响面（boheidc lane16 1493s 剔除异常值）（本任务 Proposal/Founding 已含）——inner 已另加确定性复现测试（mcp-server-deadlock-repro.test.mjs），见 Evidence
- [x] AC2: **根因定位**——定位 mcp-server.test.mjs 或 mcp-server.ts 中**长批次尾段**持 socket 句柄不释放的路径（stdio transport / 资源注册 / 子进程通道 / **fd 或临时端口耗尽、遗留子进程句柄未回收**——三次死锁都发生在大批量 300-600+ 文件跑到后段，非开局；自变量是批次尾段资源累积，非并发数）——根因 = Provider 子进程 stderr 继承链 + SDK close 2s 宽限窗竞态，见 Evidence/AC2
- [x] AC3: **修复**——句柄正确释放（或测试隔离），**长批次尾段复现**（见 DoD）全绿无挂起——修后确定性复现 3/3 无挂起（conc=8），见 Evidence/AC3
- [x] AC4: **低并发不回归**——conc=4 回归（本机 23.2s 基线量级）；`--for-task` scoped 门绿——conc=4 24.0s passed（本 4 核机）、scoped 86/86，见 Evidence/AC4
- [x] AC5: **全量不回归**——全量套件绿（外层 verification-round 验证）——inner 不跑全量（C1），触碰面 scoped 全绿；全量绿由外层 verification-round 确认（DoD 原样）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：**长批次尾段复现无挂起**（真实 main 相批次跑几次，该文件排后段，观察是否规律性在后半段死锁；贴 2 次结果）+ conc=4 回归数字——真实 300+ 文件批次跑不了（inner 不跑全量，C1）；改为**确定性复现**：stubborn provider 强制孤儿场景，修前挂死（30s 超时 EXIT 124）、修后 3/3 无挂起（conc=8 4.3/4.3/4.7s）+ conc=4 回归 24.0s（Evidence/AC3、AC4）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）——scoped 86/86（Evidence/AC4）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）——scoped 86/86（Evidence/AC4）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/test/mcp-server.test.mjs（复现/修复落点）
- packages/quay/src/mcp-server.ts（若根因在此：stdio transport / 资源 / 子进程通道句柄释放）
- packages/quay/src/provider-client.ts（修复落点：Provider 子进程 stderr 由 inherit 改为 pipe + 转发，打断孤儿进程持有测试 stderr 的 fd 继承链——见 AC2/AC3 Evidence）
- packages/quay/test/mcp-server-deadlock-repro.test.mjs（若新增：conc=16 循环复现测试——本次新增为确定性复现：stubborn provider 强制孤儿场景）
- tasks/gap-mcp-server-test-deadlocks-at-high-test-concurrency.md（自身：勾 AC + 贴证据）

### Finding：并发死锁实证（manager 2026-08-11 10:2x，落点 Finding 不进 Contract）

**已复现、已用 /proc + ep_poll 确认，非猜测**：`--test-concurrency=16` 下 mcp-server.test.mjs 卡 ep_poll，socket 句柄不释放，14+ 分钟无 CPU（strace wchan=ep_poll, pcpu≈0.9%）。conc=4 本机 23.2s passed、orangevps 20.2s passed ⇒ 只高并发触发。现场 kill -9 已终止，句柄快照未保留。

**数据修正（随本任务）**：两机最初 31 失败 = 同一根因 `.quay/config.yml` 缺失（gitignored、quay-init 生成、新 clone 没有）；scp 修复后单跑 27/27、46/46 绿，失败归零（除死锁）。**orangevps 干净重跑 main_phase_ms 从带 31 假失败的 117s 变 170s**——那 31 个瞬间报错把 sum_ms 拉低，**此前任何用那批数据的外推作废**。boheidc lane16 sum=1493s/289 文件、理论地板≈93.3s（未经验证轮）。两机单核速度比 boheidc/orangevps 中位 2.12x（短 1.86x/长 2.28x），16 核数量优势更大 ⇒ 整体预测快约 1.8x（未确认）。SERIAL/LOWCONC_CONCURRENCY 均可 env 覆盖，不受 --test-concurrency 影响。

### Finding：死锁非「只在高并发触发」——conc=8 也复现，触发条件是长批次尾段资源累积（manager 2026-08-11 11:2x 更正 10:23 判断，落点 Finding 不进 Contract）

**更正 10:23 的「只在高并发触发」**：conc=8 也复现（boheidc 第二次死锁）——main 相隔离实验（product+engine+governance，305 文件，conc=8）跑到第 **304/305 个文件**时 mcp-server.test.mjs 又卡死：wchan=ep_poll、持 3 个 socket 句柄不释放、运行 8 分 53 秒、CPU 0.2%，与首次（conc=16）现场完全同构。已 kill -9。

**与「并发数本身」矛盾**：首次 conc=16 死锁、conc=4 两次（orangevps/boheidc）都 passed；这次 conc=8 死锁。⇒ **触发条件可能不是并发数，而是「批次跑到接近尾声、前面 300+ 个文件已消耗/累积了某种资源」**——fd 耗尽 / 临时端口耗尽 / 遗留子进程或句柄未及时回收。**两次死锁都发生在大批量文件跑到后段，不是开局**——唯一共同点，机制归因不下结论（C6b：该问失败者本人，manager 条件有限只报现象）。

**DoD 复现设计更新（AC3/DoD 已按此改）**：原「16-32 核 conc16 单跑循环 ≥3 次」可能不够——更该测**「在一个跑了 300+ 文件的长批次尾声跑它」**而非孤立单跑循环（后者 conc=4 单跑两次 20-23s 正常，测不出成因）。

### Finding：第三次复现三点连线——自变量是批次尾段资源累积，推翻「并发数」假设（manager 2026-08-11 11:5x，落点 Finding 不进 Contract）

**三次死锁完整记录（唯一共同点 = 大批量文件跑到尾段，与并发数无关）**：
- ① 首次（昨日，lane16 全量套件，main 相尾声）conc=16 —— 死锁
- ② main-only 隔离跑（第 **305/305** 个文件，批次尾声）conc=8 —— 死锁
- ③ main-only 隔离跑（第 **~613** 个文件，批次尾声）conc=16 —— 死锁

**对照**：orangevps conc=4 单独跑 20.2s passed；boheidc conc=4 单独跑 23.2s passed——**两次都是孤立跑、批次很小**。

⇒ **三次死锁唯一共同点是「批次跑到后段，前面已跑大量（300-600+）其它文件」**，与并发数（8 或 16）无关——8 和 16 都复现过；更早的 conc=4 从未复现，但 conc=4 那两次也是孤立小批次，**不能排除「conc=4 + 大批次尾声」是否也会死锁（未测）**。**真正的自变量可能是：文件描述符/端口/进程句柄随批次进行累积消耗，到某阈值后 mcp-server.test.mjs 恰好撞上资源不足而死锁在 ep_poll**——而非最初假设的「并发数」。

**DoD 复现条件重新设计（已按此改 AC3/DoD）**：原「16-32 核 conc16 单跑循环 ≥3 次」大概率复现不了（孤立跑、不含「批次尾声」条件）。应改为**「在一个包含 300+ 文件的真实批次里，让该文件排在后段」**——即用真实 main 相跑几次，观察它是否规律性地在后半段死锁。

### Evidence（inner 任务执行，2026-08-11 落点）

#### AC1 复现固化（确定性复现新增）

现场三次死锁 + conc=4 对照 + 影响面已在本文件 Proposal/Findings（manager/outer 已记）。inner 补一层**确定性复现**：`packages/quay/test/mcp-server-deadlock-repro.test.mjs` 用「stubborn provider」（注册 task_list、但**忽略 stdin EOF 与 SIGTERM**、`setInterval` 保活）强制孤儿场景，无需 300+ 文件：

- **修前**（git stash 撤掉修复后）：`timeout 30 node --test --test-concurrency=4 packages/quay/test/mcp-server-deadlock-repro.test.mjs` → **EXIT 124（30s 超时挂死）**；测试体 main() 已跑完（"repro completed cleanly" 已打印），runner 卡在 stderr EOF 等孤儿进程释放——与现场「测试进程健康但 runner 永等」同构。
- **修后**：同一命令 EXIT 0，`~4.3–6.4s` 完成，3/3 通过。

#### AC2 根因定位

两段式根因（非 fd/端口耗尽，非并发数本身——与三次现场「批次尾段」唯一共同点吻合）：

1. **Provider 子进程 stderr 继承链**（`packages/quay/src/provider-client.ts` 的 `connectProvider`）：`StdioClientTransport` 默认 `stderr: 'inherit'`。链 = 测试文件 → `quay mcp`（test 的 StdioClientTransport 也 inherit）→ Provider（connectProvider 也 inherit）。**Provider 持有测试文件 stderr 管道的写端**（runner 等待该管道 EOF 判定测试文件结束）。
2. **`quay mcp` onclose 串行清理 + SDK 2s 宽限窗竞态**（`packages/quay/src/mcp-server.ts`）：SDK `StdioClientTransport.close()` 只给 2s（SIGTERM）+2s（SIGKILL）。`quay mcp` 的 onclose **串行** `await client.close()` 每个 Provider；重载下（长批次尾段 conc=8/16）总清理时间可超 2s → client 在清理中途 SIGTERM `quay mcp` → **未清完的 Provider 被孤儿化** → 孤儿持有测试文件 stderr → runner 的 stderr EOF 永不到达 → **挂死在 ep_poll（wchan=ep_poll, pcpu≈0.9%，"3 个 socket 句柄" = 孤儿 stdin/stdout/stderr 三个 pipe fd）**。

`spawnCapture`（instrument 工具）与 acceptance-runner 均用 pipe（非 inherit），不在此链上。

#### AC3 修复（三个改动，两个文件）

- `packages/quay/src/provider-client.ts`：Provider 子进程 `stderr: 'pipe'` + `transport.stderr?.pipe(process.stderr)` 转发——**打断 fd 继承链**（孤儿只持有通向已死父进程的 pipe，不再持有 runner 的 stderr），保留诊断输出。这是根治「孤儿挂 runner」的机制。
- `packages/quay/src/mcp-server.ts`：onclose 改 `Promise.allSettled` **并行**关闭所有 Provider——把整棵树的关停压进 SDK 2s 宽限窗，缩小孤儿窗口。
- `packages/quay/src/mcp-server.ts`：加 SIGTERM/SIGINT handler（`closeAllProviders().finally(process.exit(0))`）——若 client 在 stdin-EOF 清理完成前 SIGTERM，仍先关 Provider 再退出，回收子进程。

**验证**：确定性复现修前 124 挂死 / 修后 3/3 无挂起（conc=8 4.3/4.3/4.7s，conc=4 6.4s）；复现测试自带孤儿 SIGKILL 清理（防长套件累积孤儿进程）。

#### AC4 低并发不回归

- `mcp-server.test.mjs` conc=4：**24.0s passed**（本 4 核机；修前基线 40.6s——并行 close 反而更快；与 16 核 boheidc 的 23.2s 基线同量级）。
- `mcp-server.test.mjs` conc=8 压力：**24.3s passed**。
- `scripts/test.sh --for-task gap-mcp-server-test-deadlocks-at-high-test-concurrency --allow-thin`：**86/86 pass**（46.6s），含静态检查（test-framework-policy 绿——新测试用 `node:test` 满足策略）。
- connectProvider 消费方：`task-check.test.mjs` + `unparseable-frontmatter.test.mjs` **7/7 pass**（provider stderr 改动未破坏）。
- 注：`--for-task` 默认报 test-selection-thin（selector 把本文件 Finding 正文里的 ①②③ 证据行误当 Touches 解析，覆盖比 0.38<0.5）——与本次改动无关（修前即如此），`--allow-thin` 放行完整 11 文件解析集。

#### AC5 全量不回归

inner 按 C1 不跑全量套件；触碰面（mcp-server 相关 + connectProvider 消费方 + scoped 集）全绿。全量套件绿（`fail 0`/`cancelled 0`/`FULL-SUITE-EXIT=0`）由外层 verification-round 验证（DoD 原样，未勾的 DoD 两项即此）。
