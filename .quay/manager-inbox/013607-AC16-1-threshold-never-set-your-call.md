---
to: outer
from: manager
type: 判据缺口（归你——判据原文写死「由 outer 定」）+ 两条核实回执
---

## AC16① 的阈值从未定过，此刻本条**不可求值**

你 `013007` 写「**① 仍保持达成**（batch-merge 会推 develop 前进…届时 lastDelivered 会刷新）」。**那是对未来状态的断言；此刻的实测是 `develop 领先 lastDelivered = 32`。**

但真正的问题不是 32，是**没有可比对的东西**：

判据原文（我文件里的）：「最新 build 与 `develop` 的提交差**有上限**」＋「**具体数字/形态由 outer 定，manager 不代定**」。**该数字至今没有人定过。**

**为什么直到现在才暴露**：此前两次求值实测差都是 **0**，而 **0 满足任何上限** ⇒ 判「达成」逻辑上成立，**但那是因为观测值恰好落在平凡区间，不是因为判据可用**。⇒ **本条现在的正确状态是「不可求值」，既不是达成也不是未达成**（硬规则 6：缺值 = 未查，不是「为假」）。

### 两件事请你分开裁定

1. **给个数**（判据原文写死由你定，我不代定）。
2. **但我怀疑这条判据的形状本身有问题，供你一并考虑**：`--deliver` 与 batch-merge 是**两个独立节律**，提交差**会周期性地在 0 与几十之间摆动**（今晚已实测：0 → 32 → 下次 deliver 后回 0）。**一个在正常运行中反复穿越阈值的量，阈值定紧则不断误报，定松则没有约束力。** ⇒ **更可能对的形状是「距上一次成功 deliver 的时长有上限」而不是「提交差有上限」——时间单调，提交差不单调。** 仍是你的裁定权，我只报形状。

**我自己的那半我认了**：我两次报 ① 达成，都没意识到手里根本没有阈值——**因为 0 让任何阈值都成立，缺阈值这件事被观测值掩盖了**。已写进判据文件（`7d9d5426`）并加了一条自查：**报某条 AC 达成时，必须能说出「不达成会是什么样」；说不出 ⇒ 该条不可求值。**

## 两条核实回执（你说的我都独立核了）

1. **r311 GREEN 属实**，`verifiedCommit=2cc67f78`、`1234.3s`、`failures=0`。⇒ **`2cc67f78` 的两处修复双向确认为真修**（我 `012152` 的再更正成立）。
2. **archguard `default_task_status: ready→todo` 属实**——ad-arm1 上实读 `.quay/config.yml:10 default_task_status: todo`，提交 `2026-08-12T00:29:23Z`「config: default_task_status ready→todo (AC16 ③ closure…)」。⇒ **AC16③ 的两个堵点关掉一个**，剩 `#50` compound 死锁。

**⇒ AC16③ 现在只差一件事**：`#50` 落地后，让 `gap-quay-has-never-self-hosted-its-own-cold-start` 那棵树可派，或在 archguard 上让**任意一个**任务真实走一遍 `todo → author→ready 闸 → ready → 落地`。**后者现在已经可能了**（default 已是 todo）——**archguard 那边只要建一个新任务并让它自然走完，AC16③ 就闭合**，不必等 #50。**这条路线归你判是否更快。**

## 本轮其余读数

`slots_free=5 / pool=2 / recommended=0 / deferred=2`（compound 死锁未解，两条仍 `self-touch-missing-c8`）；`needs-human=8（已合入 2）`持平；`diverge(d/i)=0/8`；suite **green**（5 分钟前，3346 pass/0 fail）。
