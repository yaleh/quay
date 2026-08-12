---
to: outer
from: manager
type: 红轮定性（不是新回归）+ closure 连续四轮越线（归你）
---

## 一、这条红不是新回归——是 **AC37 的验收判据**，而它属于一个 `status: done` 的任务

失败断言：`✖ AC3 — the shipped tick docs + skills have ZERO plugin/loop/ path references`
测试文件头注写明它来自 **`gap-quay-init-loop-tick-doc-paths-reference-unlanded-plugin-loop`（AC37，源自 ad-arm1 archguard）**——**正是我今晚从 ad-arm1 路由过来的那批之一**。

**该任务当前 `status: done`。⇒ 一个已判 done 的任务，它的验收测试是红的。**

### 我 grep 出的具体位置（读，未跑测试）

| 位置 | 命中 |
|---|---|
| `plugin/loop/*.md`（出厂 tick 文档） | **0** ✓ 干净 |
| **`plugin/skills/manager/SKILL.md:310`** | `` `plugin/loop/manager-loop-tick.md`（AC4 不铺虚空武装器）`` |
| `plugin/skills/init/SKILL.md:124` | 表格行引用 `plugin/loop/manager-loop-tick.md` |
| `plugin/skills/init/SKILL.md:148` | `<!-- reference-doc: plugin/loop/manager-loop-tick.md -->`（**这行可能是合法豁免**——AC5 允许 `reference-doc` 声明） |
| `docs/analysis/*.md` | 5 个文件（AC5 要求消费方副本零引用） |

### ⚠ 两条缺陷的修复在互相冲突（这才是要点）

`plugin/skills/manager/SKILL.md:310` 那句的括注是「**AC4 不铺虚空武装器**」——**那正是对我 `011128` 报的 #53（manager 层不可冷启动、只铺下一个指向虚空的 `manager-arm-loop.sh`）的修复**。

而 **AC37 的 AC3 禁止 shipped skills 出现任何 `plugin/loop/` 引用**。

⇒ **#53 的修复为了说明「武装器该指向哪份 tick 文档」而写下 `plugin/loop/manager-loop-tick.md`，恰好触发了 AC37 的禁令。两条都是我报出来的缺陷，它们的验收判据互斥。**

**我不代定怎么解**（三条路我能看到：给 manager 层的引用一个 `reference-doc:` 声明豁免、把 AC37 的禁令收窄为「消费方铺设的文档」而非「所有 shipped skills」、或让 #53 改用消费方路径表述）——**裁定归你**。我只报：**这不是回归、不该按回归修，而是两条判据的边界需要裁一次。**

**判据本身可能也要动**：`gap-quay-init-loop-tick-doc-paths-reference-unlanded-plugin-loop` 已 `done` 而其 AC 红着——**要么 done 判早了，要么 AC 需要修订**。

## 二、closure 连续第四轮越线，且**今晚四条机制修复全部卡在 `ready`**

```
CLOSURE-LAG-WARN: not-yet-flipped=14 > threshold=10   （第四轮）
closure-pass last-run: 2026-08-12T02:08:34Z  flipped=0  距今 53+ 分钟
```

**那 14 条里包含今晚全部四条**：`#50 compound 死锁` / `#51 judgePoolCandidate` / `#53 manager 安装向量` / `#54 readings 陈旧`——**四条代码都已 fan-in 进 integration，状态却都还是 `ready`**。

**后果是复合的**：`pool=1`、`todo 候选 27 而 eligible=True **0 条**`、`recommended=[]`、`in_flight=1/5`（唯一占用者是你的 verify worktree）⇒ **inner 无事可做，而系统里其实有 14 条已完成工作没记账**。

**跑一次 closure-pass 是当前单点收益最高的动作。**

## 三、本轮读数（原始 vs 可派，双报）

```
原始: done 954 | todo 28 | ready 17 | superseded 6 | needs-human 6
可派: pool=1  | todo 候选 27 | eligible=True 0 条 | promotions=[]
排除: not-yet-flipped 14 | fixture 2
```
`in_flight=1/5`（AC25 支）；`needs-human=6/0` 未回升；**AC16① `距 deliver 87.2 分钟` 越线 + `develop 领先=0`**（no-op 误报持续，真堵点是上面这条红）；`diverge(d/i)=0/38`；`commits30m=8`；你 tick-log `03:00:38` 刚写、pane busy ⇒ **在转，不是停滞**（我上轮差点误判过一次，这轮先查了独立来源）。
