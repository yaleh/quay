# 缺陷发现延迟的分布——把「频率 × 静默」从轶事变成读数

> 运行日期 **2026-09-15**（UTC），`develop` tip 冻结在 **`8f3b51198ff4640feafcb9b272e86ccbad926a8f`**
> （`tasks: gap-ac162-console-guidance-line-reddens-criterion todo→ready（promotion-driver 机械晋升）`，2026-09-15T00:02:11+00:00）。
> 取数机件：`plugin/scripts/defect-latency-pair.ts`（本任务实现）。
> 本文件全部读数来自**本仓库真实历史**（真实 `tasks/gap-*.md` + 真实 `git log` / `git blame`），
> ⛔ 无 fixture、无注入数据（DoD 的反例判据：把测试夹具全关掉，下列读数不变）。

## 0. 它回答什么问题

CLAUDE.md 的硬规则（静默失败一族）与 `docs/references/维度边界与结晶.md` §2.1 ②
把「静默失败」判为最危险形态，判据写的是 `频率 × 失败是否会自己发出声音`，引的是
**三个个案**（workflow 周期失败静默 21.5 h；1b 收尾每 tick 静默 8.5 h；A5 巡检
「看见但没发现」数十轮）。个案不是分布。本文是那个判据的分布版本。

`docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §7 把它列进
「需要先补仪器」——**现无现成字段**。本文不改任何载体，而是从**已有的 git 事实**里把配对算出来。

## 1. 口径（先说清楚它量的是什么）

```
t1（立案时刻） = tasks/<id>.md 首次进入 git 的那次提交的 committer 时刻
t0（引入时刻） = 该任务的修复提交所改的**旧行**，经 git blame 上溯到的引入提交时刻
                （取不超过 t1 的**最晚**候选）
latencyHours  = (t1 − t0) / 3600
```

**修复提交怎么机械定位**（本口径的承重件，⛔ 不读任务正文、不按关键词猜）：本仓库的落地形状
给了它一个机械入口——驱动 fan-in 落地一个任务时，`develop` 上必然出现下面这对提交（**两个实测变体都收**）：

| 变体 | 形状 | 取 (tip, base) |
|---|---|---|
| ① | `M = Merge branch 'develop' into task/<id>`，且 `M.p1` 就是翻 done 提交 | `(M.p1, M.p2)` |
| ② | `M` 在前，`D = tasks: … done（…）` 在后，且 `D` 的父提交就是这个 `M` | `(D, M.p2)` |

于是该任务的修复提交 = `git log --no-merges <tip> ^<base>`（= 只在任务侧、不在 develop 上的那批），
再滤掉 `tasks: 翻 … done` / `task_write by cli:` 这类 bookkeeping 提交。
两个变体都失效时，退化到「`M.p1` 的祖先里含翻 done 提交」的慢路径。

## 2. 可复跑锚点（粘贴即用）

```bash
DEV=8f3b51198ff4640feafcb9b272e86ccbad926a8f   # 冻结的 develop tip
node --experimental-strip-types plugin/scripts/defect-latency-pair.ts --ref "$DEV" --emit-json > /tmp/dlp.json
jq '{denominator, verifiablePairs, unresolvableRate, distribution, unresolvableByReason}' /tmp/dlp.json
jq -r '.tail[] | "\(.latencyHours|.*100|round/100)h \(.taskId)"' /tmp/dlp.json
# AC3 的抽样复核（同一 seed ⇒ 同 10 条）：
node --experimental-strip-types plugin/scripts/defect-latency-pair.ts --ref "$DEV" --sample 10 --seed 20260914
# 人工读（人眼模式，分母与失真率也在 stdout 上）：
node --experimental-strip-types plugin/scripts/defect-latency-pair.ts --ref "$DEV"
```

⚠️ **必须钉 `--ref`**：`--ref develop`（缺省）在跑的三分钟里 develop 会前进，
分母会漂（本文实测：同一次运算里从 1657 漂到 1658）。锚点是 SHA，不是分支名。

## 3. 读数

| 量 | 值 |
|---|---|
| **分母**（尝试配对的 gap 任务总数） | **1658** |
| **可核配对**（`confidence != "unresolvable"`） | **761** |
| **失真率** `unresolvable / 总数` | **0.5410（897 / 1658）** |
| `confidence` 分布 | high 168 / low 593 / unresolvable 897 |

**延迟分布（小时）**：`n=761  min=0.0  median=37.9  p90=388.9  max=1328.5  mean=128.1`

### 3.1 尾部（最长 10 条）

| 延迟 (h) | 天数 | taskId | 类型 |
|---|---|---|---|
| 1328.5 | 55.4 | `gap-adr007-per-milestone-dark-axis-enforcement-gate` | doc-drift |
| 1300.0 | 54.2 | `gap-shipped-entry-files-not-runnable` | unclassified |
| 1203.0 | 50.1 | `gap-frontmatter-slugify-drops-non-ascii` | doc-drift |
| 1174.0 | 48.9 | `gap-delivery-manifest-capability-map` | doc-drift |
| 1117.9 | 46.6 | `gap-ac165-remove-root-mcp-json-quay-entry` | doc-drift |
| 1092.1 | 45.5 | `gap-parseTask-nested-extra-support` | doc-drift |
| 1069.9 | 44.6 | `gap-ac169-delivery-surface-doc-sync` | doc-drift |
| 1009.5 | 42.1 | `gap-skill-allowed-tools-plugin-namespace` | doc-drift |
| 993.8 | 41.4 | `gap-ac259-version-union-lockstep-and-host-install-readings` | doc-drift |
| 978.4 | 40.8 | `gap-acceptance-runner-failure-reason-drops-criterion-stderr` | performance |

尾部 **8/10 是 doc-drift**。这不是分类器的自证（分类器读的是任务正文的关键词，
与 t0/t1 的取数路径完全不相干——见 §5 的分类器说明）。

### 3.2 按缺陷类型分组

| 类型 | n | 中位 (h) | p90 (h) | max (h) | 下结论？ |
|---|---|---|---|---|---|
| 静默失败 silent-failure | 175 | **25.3** | 328.0 | 970.7 | 是 |
| 报错失败 loud-failure | 48 | 41.1 | 244.6 | 668.4 | 是 |
| 性能 performance | 137 | **50.2** | 389.6 | 978.4 | 是 |
| 文档漂移 doc-drift | 333 | 37.6 | 412.9 | 1328.5 | 是 |
| 未分类 unclassified | 68 | 31.9 | 310.2 | 1300.0 | 是 |

**全部 5 组 n ≥ 5 ⇒ 无一触发「样本不足，不下结论」的抑制条件**（判据在代码里：
`GroupReport.conclusionSuppressed`，`n < 5` 时置 true 并在人类输出里打 ⚠️）。

## 4. 结论（含一条与既有叙述相悖的）

### 4.1 反直觉读数：静默失败的中位延迟**不是**最长的，它是最短的

既有叙述（CLAUDE.md 硬规则一族 + `维度边界与结晶.md` §2.1 ②）说静默失败最危险，
隐含的推论是它被发现得更晚。**本读数不支持这个推论**：
静默失败中位 **25.3 h**，比性能（50.2 h）、报错失败（41.1 h）、文档漂移（37.6 h）都**短**。

⚠️ **但这个「更短」本身也没有被确立，不得反过来当成结论**。同一份数据上的
20,000 次 bootstrap（seed 20260914，中位数之差，命令见 §4.3）：

| 对比 | 中位差 (h) | 95% CI | 跨 0？ |
|---|---|---|---|
| 静默失败 − 性能 | −25.0 | [−58.4, +0.4] | **是** |
| 静默失败 − 文档漂移 | −12.3 | [−27.5, +11.0] | **是** |
| 静默失败 − 报错失败 | −15.8 | [−54.3, +14.8] | **是** |

**⇒ 诚实的结论是两句，缺一不可**：
1. 「静默失败发现得更晚」这条**推论在本仓库的 761 条可核配对里没有得到支持**（点估计方向相反）；
2. 但三个对比的 95% CI 全部跨 0 ⇒ **「静默失败发现得更快」同样没有被确立**。
   本读数能排除的是「静默失败延迟**远**长于其它类」（CI 上界 +14.8 h，排除了「长几天」量级），
   排除不了 ±1 天的差异。

### 4.2 本读数**支持**的那一条：延迟由**有无仪器**决定，不由失败形态决定

把 3.1 的尾部与 §5 的机制合起来读：`doc-drift` 组既是样本最大的一组（333）、
又是尾部占 8/10 的一组，且它**没有任何常驻检查器**盯着（这是硬规则「可见性 ≠ 执行」
在本仓库自己的文档面上的镜像）。而 `silent-failure` 组正是本仓库投入仪器最多的一组
（硬规则 3b 与它的三个实例、`instrument-decay-check`、`pump` 类对拍…）。
⇒ **可检验的假说**（本任务不宣称已证）：**延迟是「该类缺陷有没有一个每轮按的检查器」的函数，
不是「该缺陷是否会自己发出声音」的函数**。若要证实，需要的是下一批仪器落地前后的前后对照。

### 4.3 bootstrap 的复跑命令

```bash
node --experimental-strip-types plugin/scripts/defect-latency-pair.ts --ref "$DEV" --emit-json \
  | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));
    const by={};for(const p of r.pairs){if(p.confidence==="unresolvable")continue;(by[p.defectType]??=[]).push(p.latencyHours)}
    const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor((s.length-1)*0.5)]};
    const mul=s=>{let a=s>>>0;return()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}};
    const rnd=mul(20260914);
    for(const k of ["performance","doc-drift","loud-failure"]){const y=by[k],S=by["silent-failure"],d=[];
      for(let b=0;b<20000;b++){const xs=[],ys=[];for(let i=0;i<S.length;i++)xs.push(S[Math.floor(rnd()*S.length)]);for(let i=0;i<y.length;i++)ys.push(y[Math.floor(rnd()*y.length)]);d.push(med(xs)-med(ys))}
      d.sort((a,b)=>a-b);console.log(k,"medDiff",(med(S)-med(y)).toFixed(1),"CI",d[500].toFixed(1),d[19499].toFixed(1))}'
```

## 5. 本口径量不了什么（AC5）

失真分两层，**两层都计数，⛔ 一条都不吞**。

### 5.1 `unresolvable`（897 条 = 54.1%）——**修复提交无法机械定位**类

| 成因 | 条数 | 它意味着什么 |
|---|---|---|
| `no-landing-commit` | **682** | 该 gap 在 `develop` 上**从来没有过翻 done 提交**（仍是 todo/ready/superseded，或未落地）⇒ 没有修复提交 ⇒ 引入时刻在本口径下**结构上不可定位** |
| `no-landing-merge-with-done` | 95 | 有翻 done、有 merge，但两个变体都对不上（落地形状落在两代驱动之外） |
| `no-old-line-hunks` | 51 | 修复提交只有**纯插入**（`--unified=0` 的旧侧行数为 0）⇒ 「凭空加了行」不对应任何引入时刻 |
| `all-candidates-after-filing` | 38 | blame 上溯到的候选**全部晚于**立案 ⇒ 修复所改的旧行是立案之后才写下的（多为「修复自己引入的辅助代码」）⇒ 负延迟被挡在这里，⛔ 不静默报 0 |
| `no-code-fix-commit` | 23 | 落地区间里只有 bookkeeping 提交，一条改动非 `tasks/` 文件的都没有 |
| `no-filing-commit` | 6 | `tasks/<id>.md` 在 `develop` 历史上根本没有 `--diff-filter=A` 提交（重命名/历史简化） |
| `blame-yielded-no-candidate` | 2 | 有旧行区间，但 blame 一条候选也没给出来 |

⚠️ **682 这一条是**——不是仪器的失败，是**口径的边界**：本口径只能量**已修复**的缺陷。
「未修复缺陷的引入时刻」是另一个问题（它需要的是「谁在何时写了这段仍然有问题的代码」
而没有任何东西指向那段代码），本文不回答它。**把 897 条读成「54% 的仪器失败」是错的**。

### 5.2 `low`（593 条）——量到了，但口径已知会失真

| 成因 | 条数 | 失真是什么 |
|---|---|---|
| `blame:latest-of-N`（N>1） | **553** | 一次修复改多行 ⇒ 多个候选 t0。本口径取**不超过 t1 的最晚候选**。其中 **93 条**还有候选晚于立案（被丢弃） |
| `blame:test-file-only` | 26 | 该修复的旧行只在测试文件里 ⇒ blame 上溯得到的是**测试**的引入时刻，不是缺陷的 |
| **`blame:suspect-relocation`** | **12** | **blame 落在重构 / 格式化 / 批量搬移提交上**（按提交主题词表或改动文件数 ≥25 机械判定）⇒ 指向的不是引入提交。**实证**：一次「serve-handlers.ts 按关切拆分 13 文件」把 6 条配对的 t0 全顶到拆分提交上；词表里只放 `refactor/rename` 收不住，已补 `拆分/收敛为/重组/split/restructure` 一族 |
| **`blame:suspect-merge-attribution`** | **2** | **blame 落在 merge 提交上** ⇒ 该行是**合并决议**（含冲突消解）带进来的，真正的引入提交在合进来的那条分支里。**实证**：`gap-ac190-long-term-guarantee-goal-backed-check` 的 1.44 h 配对栽在这里 |
| `blame:same-as-filing` | 0 | t0 就是立案提交本身（`t1` 同时是引入与立案）。本批为 0，判据保留 |

### 5.3 为什么不能靠挑样本抹掉

三条理由，逐条可核：

1. **失真与结论相关，不是噪声**。§3.1 的尾部 8/10 是 `doc-drift`；若把 `suspect-relocation`
   的 12 条按「抛掉」处理，等于**系统性地**删掉「重构把 t0 顶晚」这一族，而重构密度本身
   与该类任务的代码面宽度相关 ⇒ 删样本 = 给结论加了一个与自变量相关的偏。
2. **失真本身是读数**。`blame:suspect-relocation` 的 12 条说的是一件真事：本仓库有相当比例的
   修复落在「被重构过 13 个文件的那块面」上——**重构是缺陷发现延迟的一个放大器**，
   扔掉它就是把这条结论一起扔掉。
3. **DoD 的反例判据要求读数不依赖注入**。挑样本与「关掉夹具后读数变样」是同一类病：
   都是让读数成为**取样方式的函数**。本口径把 `confidence` 做成**三个取值**
   （`high|low|unresolvable`，AC1 的要求），让「没量到」与「量到了」**不同形**（硬规则 3b），
   所以失真率可以被公示而不是被藏起来。

## 6. 抽样复核（AC3）

抽样：`--sample 10 --seed 20260914`，池 = `confidence == "high"` 的 **168** 条，
先按 `taskId` 排序再做种子化 Fisher–Yates ⇒ 同 seed 同结果，他人可复现。

**人工核对判据（事先写定，⛔ 不事后改）**：以下三项全成立才算「正确」——
(a) `t1` 提交确实是 `tasks/<id>.md` 的首次加入提交（`git log --diff-filter=A -- tasks/<id>.md` 逐字相符）；
(b) `fix` 提交确实改动过非 `tasks/` 文件，且主题确为该任务的修复；
(c) `git blame` 复核：`t0` 提交确实是该修复所改旧行的 blame 归属，且 `t0 < t1`。

| # | taskId | t0 SHA | t1 SHA | 延迟 (h) | 人工核对 |
|---|---|---|---|---|---|
| 1 | `gap-quay-entry-guard-symlink-broken` | `77ea5243ca` | `806b79710c` | 16.46 | ✅ (a)(b)(c) 三条全中。`77ea5243ca` 是一次「入口守卫双模判定」修复，它引入的 `isMain` 判定正是不认符号链接的那段 ⇒ **自伤型回归，16.5 h 后被自己人抓到** |
| 2 | `gap-git-graph-scroll-panel-no-visual-affordance` | `071a72ef51` | `b62f2d926f` | 13.50 | ✅ 全中。`071a72ef51` 建了 `#git-graph-scroll` 容器，13.5 h 后补「面板边界 + 更多提交提示」 |
| 3 | `gap-doc-surfaces-missing-goals-prefix` | `52cc982b95` | `fc19a472d2` | 558.38 | ✅ 全中。`DOC_SURFACES` 登记表由 `52cc982b95` 建立时漏了 `goals/`，**23.3 天后**才补 |
| 4 | `gap-sea-verify-node-free-fails-050` | `33bfff6c14` | `969c87ece8` | 99.69 | ✅ 全中。`run()`/shell 架构重构引入的 `run()` 分支是 SEA 静默 `exit 0` 的根，**4.2 天后**立案 |
| 5 | `gap-worker-worktree-continue-reuse` | `3a6d44d623` | `1b4cb20c44` | 33.62 | ✅ 全中。`defaultWorkerArgv` 由 `3a6d44d623` 单一构造，重派不撞死的缺口**33.6 h 后**立案 |
| 6 | `gap-ac192-reanchor-criterion-to-attemptkey` | `3fa5f53b04` | `eed36a821d` | 0.88 | ✅ 全中。**52 分钟**——goal-store 写盘路径刚写下就发现它没提交，属「短延迟为真」的样本（⚠️ 见下注） |
| 7 | `gap-meta-divergence-recommendation-recurrence-invisible` | `1cb8023f9f` | `bba249106a` | 12.15 | ✅ 全中。`computeDivergences` 由 `1cb8023f9f` 写下，重复计数缺口**12.2 h 后**立案 |
| 8 | `gap-standing-invariants-not-reevaluated-move-to-suite` | `0b99a67bc7` | `ee32ce9c1e` | 54.25 | ✅ 全中。AC-182 的 goal 记录文件写下时没带「写盘即提交」，**2.3 天后**补 |
| 9 | `gap-retry-exemption-signature-keeps-volatile-values` | `6a2752e56e` | `618dcd7831` | 244.61 | ✅ 全中。重试豁免的签名逻辑由 `6a2752e56e` 引入时**保留了易变量**（pid/ms/路径/哈希），**10.2 天后**才发现 ⇒ 同一缺陷可跨任务复发 |
| 10 | `gap-meta-outer-driver` | `efb1664b01` | `915ee983b8` | 75.43 | ✅ 全中。`start-drivers.ts` 的 keep-alive 路径由 `efb1664b01` 加过 goal，outer kind 的缺口**3.1 天后**立案 |

**10 条中 10 条正确（10/10）。**

⚠️ **两条必须同说的话，否则 10/10 会被读成「口径无偏」**：

1. **本 10/10 只说口径被正确执行，不说 t0 在语义上就是「缺陷被引入」**。本仓库大量 gap 是
   **「某机制缺失」型**（如 #1 的「符号链接拓扑恒假」、#6 的「没有写盘即提交」），此时
   `t0` 的语义是**「修复所碰的那段代码最后一次成形的时刻」**，而「缺陷」是那段代码的**缺席**。
   两者在机制缺失型上重合度取决于该机制本应写在哪——⛔ 这是本口径的语义边界，
   属于 §5.1 那一类，不是这一节能消掉的。
2. **种子取样的 10 条都来自 `high` 池，而 `high` 只占可核配对的 22%（168/761）**；
   其余 593 条 `low` 的 t0 已**自带**已知失真（§5.2）。10/10 是对**最干净那一档**的复核，
   ⛔ 不能外推到 761 条整体。

## 7. 与既有文档的关系

- 本文件**填上了** `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §7
  「需要先补仪器」第 6 条（缺陷发现延迟）。补的**不是新载体**，是把已有 git 事实做成配对。
- 本文件对 `docs/references/维度边界与结晶.md` §2.1 ② 的判据 `频率 × 失败是否会自己发出声音`
  给出了**分布版**，并给出 §4.2 的可检验假说作为替代表述——**本任务不宣称该假说已被证实**。
