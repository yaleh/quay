---
id: GOAL-017
title: 统一 quay server —— 把 13 个长驻进程收敛为一个可分服务起停的进程（SPEC 阶段 A/B/C）
status: draft
kind: goal
origin: 人 2026-09-13：「按照该 SPEC，创建一个 GOAL，并激活（单次授权）」。SPEC =
  orchestration/SPEC-unified-quay-server-2026-09-13.md（同日经五轮裁定成文并合入 develop）。本
  GOAL 取该 SPEC 的阶段 A/B/C；阶段 D（peer endpoint）按 SPEC §7 的排序理由与本 GOAL 的「非目标」节留给后续
  GOAL——两种风险性质不混装。激活为人的单次授权。
---
## 背景

`orchestration/SPEC-unified-quay-server-2026-09-13.md`（2026-09-13 落地 develop）给出了统一 quay server
的架构规格：把 web、全部 driver、与运行中 Claude Code 会话的通信收进一个进程，一个项目空间 = 一个实例 =
一个信任域。本 GOAL 是该 SPEC 的**执行方向**。

**现状实测（2026-09-13）**：13 个长驻进程（6 kind × (supervisor+driver) + `quay serve`）；
控制面 `serveControlPlane` 早在 `driver-shared.ts:283` 实现，却只有 `worker-driver.ts:4955` 一处调用
⇒ 另外五个 kind 没有入站控制；会话读写原语在 quay 与 quay-fleet 两个仓各有一套。

## 范围与非目标

**范围 = SPEC 的阶段 A / B / C（AC-251..AC-255）**：
- **A 纯合并已有实现**：控制面上收进 Layer 0（AC-252）、web+control 合入同一进程（AC-251）、
  会话原语统一到共享层（AC-253）。⛔ 零新功能。
- **B 服务化启停**：可单独起停任一服务，部分操作不波及其余（AC-254）。
- **C driver 内收**：进程收敛，且六个 kind 仍都在转（AC-255）。

**⛔ 非目标：SPEC 的阶段 D（peer endpoint）不在本 GOAL 内**，理由不是「留到以后」而是**风险性质不同**：
A/B/C 全部只依赖本仓库自己的代码，收益是确定的；而 peer endpoint 是全架构**唯一依赖未文档化契约**的部分
（`~/.claude/sessions/` 注册表的字段语义与过滤规则均无官方文档，且本仓库已实测到同族协议在
2.1.233→2.1.241 跨 8 patch 行为已变）。**把两种风险性质的东西放进同一个 GOAL，会让确定的部分被不确定的部分绑架**
——这与 SPEC §7 把 peer endpoint 重排到最后是同一条理由，此处保持一致。阶段 D 由后续 GOAL 承接。

**⛔ 其他非目标**：不改变 driver 的判定语义（本 GOAL 只动进程边界与接口面，不动派发/判停/归因逻辑）；
不引入新的用户可见能力（阶段 A 的判据全是零回退，见 SPEC §8 判据 9）。

## 退出条件

**散文版**：`quay server status --json` 能报告一组服务；其中 web 与 control 属于同一个进程；六个 driver kind
都从共享骨架获得控制面；会话读写原语在本仓库只有一份（与 quay-fleet 共享）；停掉其中一个服务时其余服务
照常运转、driver 的 round 心跳不中断；最终 `.quay/` 下的 driver pid 文件收敛到 ≤2 个，而六个 kind 的
round 心跳依然都是新鲜的。机器判据在 AC-251..AC-255，**不在本节**。

**五条方向性读数（与 AC 并列，非替代）**：① `.quay/*-driver*.pid` 计数（当前 **12**）；
② `serveControlPlane` 在 Layer 0 的调用点数（当前 **0**）；③ 四个共享原语模块在本仓库的存在数（当前 **0**）；
④ 载体 `.quay/unified-server-verification.jsonl` 中合格的部分停机记录数（当前 **0**）；
⑤ `quay server` 子命令是否存在（当前 **否**）。

## 风险

1. **AC-255 最容易被写成「只数进程」而恒绿**：进程收敛之后，某个 kind 的循环悄悄不转了，
   `ps` 看不出来——这正是 SPEC §6.10 记的那个「合并引入的新风险」。⇒ 判据必须同时要求六个 kind 的
   round 心跳新鲜，⛔ 不得只判 pid 文件数。
2. **阶段 A 的「零回退」难以机械化**：AC-251/252/253 判的是结构（同进程 / 上收 / 单一实现），
   ⛔ 判不了「Web 的每条路由行为没变」。那一半由既有测试套件承担，**本 GOAL 不假装判据覆盖了它**。
3. **AC-253 的「有消费者」这一半是防伪**：把四个模块文件拷进仓库就能让「存在」为真，
   所以判据要求它们在非测试代码里真被 import（硬规则 4 推论三：只能被 fixture 满足的判据不是测量）。
4. **AC-254 的载体是本 AC 自己的产物**：因此载体缺失被判为 **exit 1（未达成）**而非 exit 3
   （not-evaluated）——与 GOAL-016 的 AC-250 形态不同，那里的载体由别的环节产生。⊢ 这个区分是刻意的。
5. **顺序是硬的**：A（251/252/253）→ B（254）→ C（255）。AC-255 在 driver 仍是独立进程时结构上不可能为真。

## 与其他 goal 的关系

与 **GOAL-016**（驱动质量自证）正交：那一条问「quay 驱动出来的开发对不对」，本条问「quay 自己这套
长驻机件的形态对不对」。与 **GOAL-009**（交付面端到端自证）同向但更靠内：GOAL-009 验的是产物装到别处能跑，
本 GOAL 收敛的是它在本地的进程形态。SPEC 的阶段 D（peer endpoint）留给后续 GOAL，见「非目标」。
