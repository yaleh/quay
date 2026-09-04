# quay web：人不再是操作者——删掉 action 按钮

- **Status:** Proposal（管理者，人给出方向）
- **Date:** 2026-08-06
- **性质**：**减法**。不新增能力，删掉一个已经没有消费者的能力面。
- **Relates:** [`quay-web-observation-surface.md`](./quay-web-observation-surface.md)（web 作为观察面的增量设计——
  本文是它的**前提澄清**：既然是观察面，操纵面就不该并存），
  [`quay-as-a-living-system.md`](./quay-as-a-living-system.md) §3（退化器官）

**AC/DoD 与立案由外层判断。**

---

## 0. 触发

人：**「我倾向删除 action buttons —— 人类不应当再直接操纵任务了。」**

---

## 1. 实测：这个面从未被使用过

```
$ grep -o '"actor":"[^"]*"' .quay/gate-events.jsonl | sort | uniq -c
    365 "actor":"quay-cli"
```

**365 条闸门事件，全部来自 `quay-cli`，来自 web 的 0 条。**

`serve-handlers.ts` 里的 POST 路由（`/task/<id>/action/<actionId>`，两处渲染 + 一处处理）
**从未产生过一条可核对的状态变更**。

---

## 2. 它已经在消耗代谢

| 成本 | 位置 |
|---|---|
| 代码 | `serve-handlers.ts` 两处 `<form method="post">` 渲染 + `handleTaskAction` + 路由匹配 |
| **安全面** | 该 POST 路由自带一段 open-redirect 修复注释（`serve-handlers.ts:1068`：*"confirmed live open-redirect on the POST route itself"*）——**一个从未被使用的功能，贡献了一个真实的已确认漏洞** |
| 测试 | `serve-action-delivery.test.mjs` 等 |
| 认知 | 界面暗示「人可以在这里改任务」，与实际工作方式相反 |

⇒ 按 `quay-as-a-living-system.md` §3 的定义，这是**标准的退化器官**：
所依赖的用法（人手工推任务）已经消失，器官本身不会自动消失，会继续消耗代谢直到有机制清除它。

---

## 3. 为什么用法消失了：人的角色变了

**不是「人懒得点」，是人在这套机制里的位置变了。**

| | 旧模型 | 实际发生的 |
|---|---|---|
| 人做什么 | 改任务状态、派活、关任务 | **给方向、提问、裁定优先级** |
| 谁改任务 | 人 + agent | **只有 agent**（365/365） |
| 人的产出 | 状态变更 | **判断**——「这条论据站不住」「优先级提上去」「这个默认值太硬」 |

一整晚的实测：人给出的每一条输入都是**方向、质疑、或裁定**，没有一条是状态操作。
**按钮是为一个已经不存在的角色建的。**

---

## 4. 删掉之后，人还需要什么

**不是「什么都不需要」——是需要的东西根本不在这个界面上。**

人现在真正做不到的三件事：
1. **在会话之外联系到 manager**（唯一通道是那个 Claude Code 会话，会话死了就断了）；
2. **知道自己上一条指令有没有被真的执行**（现在靠我口头汇报）；
3. **在办公室外看到自己的项目**（→ SaaS 那份文档）。

⇒ **删按钮不是削减人的能力，是把投入从一个没人用的面挪到三个真缺的面。**

---

## 5. 边界：删什么、不删什么

**删**：`/task/<id>/action/<actionId>` POST 路由 + 两处按钮渲染 + 相应测试。

**不删**：
- **CLI 的 `quay action run`**——那是 agent 的调用面，365 条事件的来源，是活的；
- **web 的一切只读展示**——那正是 `quay-web-observation-surface.md` 要加强的方向；
- **`actions` 这个概念本身**——它在 agent 侧有真实消费者，只是不该由人在浏览器里点。

**判据**：删完之后 `.quay/gate-events.jsonl` 的 actor 分布**不应有任何变化**——
如果变了，说明它其实有消费者，删错了。**这是这次删除的负控制。**

---

**本文件不建 AC/DoD、不排优先级——那是外层的活。**
管理者提供：365/0 的实测、open-redirect 这条「未使用功能贡献真实漏洞」的证据、
角色变化的解释、以及删除的负控制判据。
