---
id: AC-233
title: 交付包不得含「形如入口、却在安装位置下无法运行」的文件——原「底线不一致」前提已证否，收窄至真实残余
status: achieved
kind: criterion
goal: GOAL-015
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/shipped-entry-runnable.test.mjs
expect: >-
  **本条已于 2026-09-10 收窄——原判据的前提被证否，如实记录**：原文要求「同一宿主上 driver 可跑而 CLI
  拒跑的不一致必须被报出」。该不一致**不存在**：立条者调错了入口（调了包内源码探针 `bin/quay.js`，而 `package.json` 的
  bin 是 `./dist/quay.js`），正确入口在 Node 18 与 25 上均正常。⛔ 不保留一条建立在错误前提上的判据。


  **收窄后的对象（真实残余）**：交付包的 `files` 装入了 `bin/quay.js` +
  `bin/quay.ts`，二者**在安装位置下结构上不可运行**——Node 对 `node_modules/`
  下的文件拒绝类型剥离（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），与 Node 版本无关。它们既非声明的
  bin、又长得像入口 ⇒ 会把调用者引向假结论（立条者本人即第一个受害者）。


  **双向，缺一不可**：

  - **正向**——`plugin/test/shipped-entry-runnable.test.mjs` 枚举「随包装入且形如入口」的文件（可执行位
  / shebang / 位于 `bin/`），断言每一个**要么**是 `package.json` `bin`
  声明的且能从**安装位置布局**跑起来，**要么**不在 `files` 装入范围内。

  - **反向（能取假）**——注入一个「装入 `files` 但从安装位置跑会结构性失败」的入口文件 ⇒ 该测试**必须红**；移除 ⇒ 绿。⛔
  只断言「声明的 bin 能跑」不算——那恰好是本缺陷能溜过去的形态（坏文件不是声明的 bin）。


  **⛔ 本条不裁定 Node 底线取值**（GOAL-015 非目标），也不要求把 `bin/quay.ts` 改成可运行——**排除出 `files`
  同样是合格解**。


  立条时该测试文件不存在 ⇒ 干跑 exit 1（可评估且红）。
origin: >-
  GOAL-015 的机器判据之一。立条依据见 GOAL-015 的 origin（人 2026-09-10 令「应当优先更新 goal；必要时可创建新
  goal」后设立；实测缺口：orangevps Node 18.19.1 上 shipped CLI 拒跑而同机 driver dist
  照跑；`merge_target` 全仓零消费者而 `fork_baseline` 有）。


  本条判据在立条当轮已从仓库根干跑取真实读数：exit 1（可评估、非 spawn 失败），符合硬规则
  4c。判据只引用不会自行回退的量——代码状态、append-only 载体的历史事实、机械枚举计数；⛔ 不含进程存活与远程主机当前可达性。
activatedAt: 2026-09-10T14:06:06.239Z
statusLog:
  - at: 2026-09-10T14:06:06.239Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-09-11T00:42:24.115Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-10T14:06:06.238Z
---
