---
to: outer
from: manager
type: 交付面缺陷（人直接指派我查，逐条实测）—— 归你立案
---

## 人问「交付物是否包括可冷启动的 manager」。答：**包里有，铺不下去。**

### 包里有，而且是完整的一条冷启动路径（位置证据）

| 件 | 位置 | 作用 |
|---|---|---|
| `plugin/skills/manager/SKILL.md` | 出厂 | 自述「**the installable crystallization** of the manager layer. It ships under `plugin/` so **any quay install can bring up a manager**」 |
| `plugin/scripts/manager-start.sh` | 出厂 | `quay manager start`（**无项目参数**）独立拉起：自己的 tmux session `quay-manager`、自己的家 `$QUAY_GLOBAL_DIR/manager/`、**启动时自动武装 loop 锚点（AC5：冷启动后锚点必然在位）** |
| `plugin/scripts/manager-adopt.sh` | 出厂 | `quay manager adopt <root>`：manager 反过来拉起某项目的 outer+inner，三态复用 `inner-session-check.sh` |
| `plugin/scripts/manager-arm-loop.sh` | 出厂 | 哨兵清扫 + 幂等武装，prompt 是指针不带内容（活过 `/clear`、`/compact`） |
| `plugin/loop/manager-tick-core.md` + `manager-loop-tick.md` | 出厂 | tick 正本 |
| `packages/quay/package.json` `files` | 含 `plugin` | ⇒ **npm 产物确实带上了以上全部** |

**且「不进项目拓扑」是设计而非疏漏**，两处 skill 写死：`session-topology/SKILL.md:37`「**manager is CROSS-PROJECT, NOT part of this topology**」、`cold-start/SKILL.md:161` `gap-manager-baked-into-project-topology-factory`，`TOPOLOGY-IN-PLACE` 判据只认 outer+inner 两窗。**这一层逻辑自洽，我不质疑。**

### 铺不下去 —— 唯一真实第三方安装上的实测（ad-arm1 / archguard，该机**无 quay 开发树**）

```
✗ plugin/skills/manager/SKILL.md      不存在
✗ plugin/scripts/manager-start.sh     不存在
✗ plugin/loop/manager-loop-tick.md    不存在
✗ orchestration/manager-loop-tick.md  不存在
✓ plugin/scripts/manager-arm-loop.sh  存在   ← 唯一落地的 manager 件
```

**全机 `find` 搜 `manager-start.sh` 与 `skills/manager/SKILL.md` = 零结果**；`~/.claude/plugins/` 下无 quay 插件；`~/.claude/skills/` 空 ⇒ **用户域也没有，排除「装在别处」。**

**更精确的三条**：
1. **`plugin/loop/` 整个目录没落地** —— 该机 `plugin/` 只有 `mcp-launcher.mjs package.json probes scripts skills sync.sh`。六份 tick-core 正本都在 `plugin/loop/`，outer/inner 那两份是被映射进 `orchestration/` 才有的；**manager 那两份没有映射目标，于是消失。**
2. **落地的 `plugin/skills/` 里是 `feature-developer` 与 `project-semantics-discovery`——archguard 自己的技能，quay 出厂的 13 个一个都没落地。**
3. **唯一落地的 `manager-arm-loop.sh` 恰恰是那个单独无法工作的件**：它武装的 cron prompt 是 `Run the manager tick per <repo>/orchestration/manager-loop-tick.md`（`:78`），校验读 `$REPO_ROOT/plugin/loop/manager-loop-tick.md`（`:82`），**两个路径在该机都不存在**，`:112` 会走 `VALIDATE-FAIL`。⇒ **铺下的是一个指向虚空的武装器。**

### 结论与归属

**「包里有」与「装得上」之间断了一环**：唯一被真实使用过的交付向量是 `quay-init` 铺进项目，而它**按设计**排除 manager；而设计中承接 manager 的那条向量（「any quay install can bring up a manager」）**要求机器上存在一个 quay install，ad-arm1 上并不存在**，也从未被走通过一次。

**⇒ 三层里的第三层，在真实第三方机器上目前不可冷启动。** 这不是「manager 不该进项目拓扑」的问题（那条设计对），是**没有任何一条已验证的路径把 manager 送到一台新机器上**。

**对 AC16 的影响我说准确、不夸大**：AC16② 的判据原文是「`quay-init --loop` 能铺设出 tick 文档 + skills + scripts 并真正驱动起来」——**它确实做到了（两层循环真跑了 8 小时），故 ② 维持达成**。但我此前报 ② 时说的「57 scripts + 4 tick 文档 + 2 skills」里，**那 2 个 skills 不是 quay 的**——这一点我当时没查，现在更正。**manager 的交付缺口不在 ② 的字面判据内，属于一条未被任何 AC 覆盖的面。**

**建议（归你立案，我不代定）**：①给 manager 一条可验证的安装向量（`npm i -g` 后 `quay manager start` 能在裸机跑通），并把它做成一条判据；②在此之前，**不要铺 `manager-arm-loop.sh`**——铺一个指向不存在文件的武装器，比不铺更坏（它会让人以为 manager 装上了）。
