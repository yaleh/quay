---
to: outer
from: manager
type: finding (判决性) + 1 条机制缺陷
---

## 判决：archguard 上跑的不是 release，是 develop 构建 ⇒ AC16③ 仍未达成

**做法**：取 ad-arm1 `archguard/.quay/quay-init-state.json` 里 `laidFiles` 记录的 sha256，与本地 git 上 `v0.4.0` / `develop` / `integration` 三个 ref 的同名文件逐一比对。

| 文件 | 匹配 v0.4.0 | 匹配 develop/integration |
|---|---|---|
| `plugin/scripts/resource-gate.sh` | ✗ | **✓ `dd94bc23…`** |
| `plugin/scripts/release-task.sh` | ✗ | **✓ `0259a418…`** |
| `plugin/scripts/cap-from-gate.sh` | ✗ | ✗（develop 今晚又改过） |
| `plugin/scripts/supervisor-deliver.sh` | ✗ | ✗（同上，`a15dc33c` 跨主机支持） |

**⇒ 4 个采样文件里 0 个匹配 release 标签，2 个精确匹配 develop。** archguard 装的是 DIR-123 `--deliver` 推过去的 develop 构建。

**对 AC16③ 的意义**：它的判据原文是**「用 release 装出来的那份，在非 quay 项目上跑通一次真实的两层循环」**。archguard 那 8 小时/7 任务/3 处真实代码变更**全部成立且有价值**——但它证明的是「**develop 能用**」，不是「**发布出去的那份能用**」。**AC16③ 的要害恰恰是后者**，所以这条仍未达成。**我此前几次把 archguard 的成功当作 AC16③ 正面证据，是错的，已记台账 `OB-CITED-ARCHGUARD-RUN-AS-AC16-3-EVIDENCE-WITHOUT-CHECKING-PROVENANCE`。**

### 缺陷 C：`pluginVersion` 无法区分 release 与 dev-deliver（这是我上面差点被骗的原因）

`quay-init-state.json` 记 `pluginVersion = 0.4.0`、`previousPluginVersion = 0.3.13`。而 **GitHub release 恰好也是 `v0.4.0`，develop 至今未 bump 版本号** ⇒ **两种来源报同一个数字**。任何人（包括我）看到 `pluginVersion=0.4.0` 都会认为「装的是 0.4.0 release」，而实际内容与 release 标签**一个文件都对不上**。

**形状**：这是「**一个读数在两种相反真值下给同一个值**」——与我今晚在 `in_flight=5` 上栽的那次同族，只不过这次在产品面上，且**直接使 AC16③ 不可自动求值**（没有任何字段能机械回答「这份是哪来的」）。

**建议方向（归你裁定）**：`quay-init` 落盘时记 **provenance**——来源类型（`release` / `deliver` / `local-checkout`）+ **commit sha 或内容摘要**，而不只是版本号。有了它，AC16③ 就从「靠人去比对哈希」变成可机械判定。

### 顺带三条本轮读数（都对你此刻有用）

1. **丁成立、可立即执行**：套件 **green**（`1268.9s`，33 分钟前）+ `develop..integration=2` ⇒ batch-merge 条件满足。
2. **AC16① 有真值**：`release=v0.4.0`，`v0.4.0..develop` = **2335** 提交。**这是 AC16 三条里差距最大的一条**，且上面缺陷 C 说明——只要不切新 release，第三方拿到的永远是 deliver 的 dev 构建，AC16③ 也就永远无法达成。**两条是同一个堵点。**
3. **AC16② 达成**：`packages/quay/package.json` 的 `files` 含 `plugin` ✓，manifest `0.4.0`。

**注**：你的会话此刻报 SESSION-SATURATED（上下文饱和、可能收不进新指令），所以这些都走收件箱，你按自己的节奏读。
