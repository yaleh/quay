---
id: gap-ac303-criterion-cmdline-port-literal-stale
title: AC-303 判据从 cmdline 的 `--port` 字面量派生地址，而生产启动器默认已是 `--port 0`（内核分配临时端口）⇒
  /architecture 页判据在真实部署上结构性失效（addr=127.0.0.1:0，curl 失败）；/architecture
  页面机制本身为真（本轮实测四条断言全过）—— 重锚地址派生那一步（照搬 AC-288 已落地的同族形态，同一行）
status: ready
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-303
---
**type:** execution

## Proposal

**缺口（AC-303 判据，立案当轮直接量，`--dry-run` ⛔ 不写台账，cwd = 主检出 `/data/home/yale/work/quay`）**

本轮把判据原文逐字复跑（取法 = `node packages/quay/bin/quay.js goal show AC-303 --json` 的 `.criterion` 字段逐字落盘 ⇒ `/tmp/ac303-verbatim.sh`，**3075 bytes**，`md5sum` = `441ab29887d0a4f2572b03a3ad7791d6`；⛔ 不是从 goal 文件的 YAML 折叠文本重拼 —— 折叠会改变换行，产生与判据真实文本不同的脚本）：

```
$ bash /tmp/ac303-verbatim.sh
CAUSE=en-fetch-failed -- GET http://127.0.0.1:0/architecture returned nothing (addr=127.0.0.1:0)
RED_EXIT=1
```

台账尾事件同形同值（`2026-09-23T13:47:35.903Z`，`actor=goal-cli`，`.quay/gate-events.jsonl` 中 `item_id=AC-303` 的最后一条）：

```
{"item_id":"AC-303","gate":"goal","actor":"goal-cli","verdict":"fail",
 "timestamp":"2026-09-23T13:47:35.903Z",
 "payload":{"reason":"acceptance failed (exit 1) — CAUSE=en-fetch-failed -- GET
 http://127.0.0.1:0/architecture returned nothing (addr=127.0.0.1:0)"}}
```

⇒ 与立案当轮逐字复跑同值，证明确为当前红，⛔ 不是陈旧台账尾巴。

**成因不是「机制坏了」—— 是判据派生地址的那一步解析了一个启动器已按设计置 0 的字面量。**

同一进程、同一时刻的三个读数（立案轮实测，⛔ 非转述）：

| 面 | 读数 | 取法 |
|---|---|---|
| 生产实例 | pid `1384111`，cwd = `/data/home/yale/work/quay`，cmdline `node --experimental-strip-types …/quay.ts serve --host 0.0.0.0 --port 0`，`startedAt 2026-09-23T13:45:20.163Z` | `readlink /proc/1384111/cwd` + `tr '\0' ' ' < /proc/1384111/cmdline` |
| 判据按 cmdline 派生的地址 | `127.0.0.1:0` ⇒ `curl -sf --max-time 10` 失败 ⇒ `CAUSE=en-fetch-failed` | criterion 里 `grep -oE -- '--host [^ ]+ --port [0-9]+'` 那一步 |
| 同一进程的**真实**监听地址（活宿主载体） | `name=="web"` ⇒ `0.0.0.0:19071`（另有 `control 127.0.0.1:9081`，**同 pid 不同端口**，取错会打到控制面） | `cat .quay/server.json` |

**为什么不能改成写死 `19071`（硬规则 4 推论二）**：它是内核分配的临时端口，重启即变、换台机器即变，且失效时静默。载体 `.quay/server.json` 是端口唯一可知的地方；重锚必须去那里读（正本 reader = `packages/quay/src/server-state.ts` 的 `readServerState` / `ServerServiceEntry` / `pidAlive` / `probeAddress`）。⛔ 本任务不逐字转述其源码 —— 执行者按盘上**当前**内容读（硬规则 5b）。

**机制本身为真（同一轮，criterion 原文逐字，只把 `addr` 一处换成真实值）**

把 `/tmp/ac303-verbatim.sh` **逐字复制，只把 `addr=""` … `done` 那一段派生循环删掉、替换为 `addr="127.0.0.1:19071"`**（其余 nav 区块抽取、`<title>` 抽取、四段断言、OK 文本一字不改）⇒ `/tmp/ac303-addrfix.sh`：

```
OK -- /architecture: default nav region carries "Architecture" and <title>="quay — Architecture — system component map"; under Cookie: lang=zh the response is <html lang=zh>, that English nav label is gone from the nav region, and this page's own <title> became "quay — 架构 — 系统组件图"
GREEN_EXIT=0
```

| 断言（criterion 自己的 chrome 作用域取法：`tr '\n' ' '` 后 `grep -o '<nav.*</nav>'` / `grep -oE '<title>[^<]*</title>'`） | en | zh |
|---|---|---|
| `<html lang=…>` | `<html lang="en"` | `<html lang="zh"` |
| nav 区块字面量 `Architecture`（**条数**，硬规则 3：给条数不给布尔） | **1** | **0** |
| nav 区块字节数 | 1310 | 1223 |
| 本页自己的 `<title>` | `quay — Architecture — system component map` | `quay — 架构 — 系统组件图` |
| （判别性对照）整段响应里 `Architecture` 残留条数 | **4** | **0** |

⇒ criterion 的四条独立断言臂（en 基线在场、zh 响应 `<html lang="zh">`、zh nav 无 `Architecture`、本页 `<title>` 相对 en 变化）**都在活服务上为真**；**fail 只发生在派生地址那一步**，且它以具名 `CAUSE=en-fetch-failed` 报出（硬规则 3b：判据没有伪装成通过）。⚠️ en 全响应里 `Architecture` 有 **4** 条（约 3 条落在 `<nav>` 之外：`<h1>`/图例/表格等页面自身 chrome）—— 这正是判据把断言收窄到 `<nav>…</nav>` 与 `<title>` 的原因；**整段子串匹配在这里会误判**，⛔ 重锚时不得把作用域放宽。

**台账指纹：判据文本没变，是它读取的宿主移动了**（硬规则 4b：不用被测对象自报的量判它；`criterionHash` 是判据的指纹）

```
2026-09-22T20:48:05.862Z  goal-sweep  pass  criterionHash f452c81b20f3ae15
2026-09-23T00:45:46.276Z  goal-sweep  pass  criterionHash f452c81b20f3ae15
2026-09-23T05:31:48.095Z  goal-sweep  pass  criterionHash f452c81b20f3ae15   ← 末次 pass
2026-09-23T08:55:42.479Z  goal-sweep  fail  criterionHash f452c81b20f3ae15   ← 首次红，指纹【未变】
（其后 08:57:38Z / 09:18:34Z / 09:36:24Z 三次 fail，addr 恒为 172.28.0.1:0；
 13:47:35Z 第四次 fail，addr 127.0.0.1:0 —— 该时刻生产实例已是新起的 gen-2）
```

红绿两侧的 `criterionHash` **相同** ⇒ 判据文本没有被改过，改的是它读取的宿主（承载载体搬迁）。这是「判据 stale」与「代码回退」最省事的分辨器：**先看这个指纹，不要先去找代码回归。**

⚠️ **同一 AC 的两种红不要混淆**（`CAUSE=` 是分辨器）：`CAUSE=en-fetch-failed … (addr=<host>:0)` 是**本任务**处理的承载体缺陷；`CAUSE=no-running-serve-instance` 意味着**那一刻**没有 cwd = 仓库根的 serve 进程在跑 —— 那是探针设计上的 fail-closed 前提，**不是**本任务的机制，重锚派生那一步不会（也不应）修它。

**为什么更早的修复没兜住这一条（本 AC 上已有一条 done 任务）**

`gap-ac303-architecture-page-zh-chrome-nav-current-and-own-title`（**done**，带 `goal_ac: AC-303`）**做出了 /architecture 页面侧的真实接线**（`packages/quay/src/serve-architecture.ts` + `serve-i18n.ts` 的本页词条与导航标签），**且它今天仍然成立** —— 上面 `GREEN_EXIT=0` 的读数就是它成立的直接量（en nav 带 `Architecture`；zh nav 该字面量 0 条、本页 `<title>` 变 `quay — 架构 — 系统组件图`）。它**从未碰过判据**。⇒ 该任务从来不是「页面缺失」，本次红也**不是它回退**；**没有任何任务碰过地址派生这一步**，而这次坏掉的恰是它。

**承载体何时搬的**：`ce0f47518`（2026-09-18，`gap-serve-same-root-admission-lock`，done，提交正文逐字含 `Default port 4173 → 0.`）把 web 端口默认改成**内核分配临时端口**（`--port 0`）。**为什么它 09-18 落码、09-23 才红**：gen-1 实例在码变**之前**就以显式端口起好并一直活着，判据照旧可派生；实例于 `2026-09-23T13:45:20.163Z` 重启出 gen-2（走新默认 `--port 0`）后，下一次判据轮才第一次拿到 `addr=…:0`。⇒ 一次承载体搬迁同时打中**整族**同型判据（本仓库实测：`goal check --stale-pass` 的 failing 含 AC-179、AC-289、AC-291…AC-303）。

**正本块（⛔ 取用，不另造）**：`goals/AC-288-*.md` 的 criterion 已含 `# >>> addr-derivation` … `# <<< addr-derivation` 块（本轮实测该文件该标记 **1 处**；AC-303 的 goal 文件实测 **0 处**），且 AC-288 本轮落在 `goal check --stale-pass` 的 `verifiedFresh` 集合内（现行判据在活实例上为真）。本 AC 的重锚**逐字采用该块**，route/label 声明留在块外（`ROUTE="/architecture"` / `LABEL_EN="Architecture"` 两行，逐字不变）。

<!-- dedup-ref -->
**去重（按机制，⛔ 不按症状关键词）与可追溯性**：顶层 `goal_ac: AC-303` 的 `grep -rl '^goal_ac: AC-303' tasks/*.md` ⇒ **1 命中**，`gap-ac303-architecture-page-zh-chrome-nav-current-and-own-title`，status **done** ⇒ 本 AC 无在飞主，本条不是重复立案，而是「承载体搬迁 ⇒ 判据 stale」这一机制在本 AC 上的实例。同机制、**不同 AC** 的在飞任务共 **16** 条（`ls tasks/gap-ac*-criterion-cmdline-port-literal-stale.md` 实测 = AC-179、AC-288…AC-302；status 除 AC-301/AC-302 为 `todo` 外全部 `ready`）—— 每条各自重锚**自己那一条** AC 的判据，**互不覆盖**（此族在本仓库是**一 AC 一任务**地排空的）。AC-303 尚无同族任务（`ls tasks/gap-ac303-criterion-cmdline-port-literal-stale.md` ⇒ No such file）。同型先例（承载体搬迁后把判据移到真正承载该角色的地方）：`gap-ac286-fanin-merge-target-criterion-carrier-stale`（done）、`gap-ac157-catalog-carrier-moved-criterion-stale`（done）。引入临时端口默认的 `gap-serve-same-root-admission-lock`（done）改的是**启动器**，从未重锚过任何判据 —— 相关但不同机制。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-303 --dry-run --json` ⇒ `verdict: fail` 且 `addr=<host>:0`；同一时刻 `cat .quay/server.json` 取 `name=="web"` 的端口读数，**两者必须指向同一 pid**。若届时 `CAUSE` 是 `no-running-serve-instance`，**停下核对**：那说明此刻没有 cwd = 仓库根的实例在跑，⛔ 不得当成同一现象处理（见 Proposal 的两种红）。
2. **取正本块，⛔ 不另造**：从 `goals/AC-288-*.md` 抽出 `# >>> addr-derivation` … `# <<< addr-derivation` 块逐字用于 AC-303（正本 reader = `packages/quay/src/server-state.ts` 的 `readServerState` / `ServerServiceEntry` / `pidAlive` / `probeAddress`）；⛔ 不把本机当前端口/主机写成字面量（换台机器或重启即失效；硬规则 4 推论二）。
3. **重锚**：`quay goal write AC-303 --criterion "$(cat <新 criterion 文件>)"` 落库（贴逐字 diff：只有派生块与「为什么改」变化），`expect`、`ROUTE`/`LABEL_EN` 与 chrome 作用域语义逐字不变；⛔ 不得直接 `Edit` goal 文件。
4. **配套夹具** `packages/quay/test/ac303-criterion-address-derivation.test.mjs`（`// @test-group product`，`node:test`）：按 marker 从 `goals/AC-303-*.md` **逐字抽取**派生块（单一正本关系，⛔ 不是逻辑副本），在 `git init` 过的临时 root 里对真实进程与真实载体跑正/负两向（显式端口 / `--port 0` + 载体 / 通配 host 归一化 / 无载体 / 载体 pid 不符 / 无 `web` 条目 / `web.up:false` / 死端口）。**同族夹具 `packages/quay/test/ac288-criterion-address-derivation.test.mjs` 立案当轮实测 ⛔ 仍未落在 develop/author（`ls` ⇒ No such file，`packages/quay/test/*criterion-address-derivation*` ⇒ none present）** ⇒ 执行前先核对它是否已落地：已落地则**照其形态**写本 AC 的同族文件；未落地则**不得假定其内容**，按本 Plan 的枚举自行写全。
5. **两个负控制**（硬规则 4 推论三：判据必须能取假）：① 无实例 ⇒ 非 0 且以具名成因可区分；② 候选地址指向必然连不上的端口 ⇒ 非 0 且成因与 ① **不同形**。⛔ 不得靠改 `expect` 或放宽断言来「凑绿」。
6. **落账**：`node packages/quay/bin/quay.js goal gate AC-303` ⇒ exit 0，且台账新增一条 `verdict:"pass"`，其 `payload.criterionHash` **≠ 修订前指纹 `f452c81b20f3ae15`**。

⚠️ **运行前提（运维须知，不是可选项）**：本 AC 的判据读**运行中的服务**（`pgrep -f 'quay.ts serve'` × cwd = 仓库根），⛔ 不自己启服务。本任务改的是**地址派生**那一步，页面代码未动 ⇒ **不需要重启 serve 实例**（与页面侧任务的要求相反）；但若实例在此期间被重启，判据必须仍 `exit 0`（AC3 的非字面量性质即测这一点）。立案当轮现场：`pgrep -f 'quay.ts serve'` 命中里只有 **1 个** cwd = 仓库根（pid `1384111`；另 2 个：本次 Bash 包装自身、以及别的用户/仓库 `/data/home/tom/…`）⇒ 重锚后的候选枚举必须仍只认 cwd = 仓库根那一个。

## AC

- [x] **AC1（重锚后判据在活实例上为真）**：`node packages/quay/bin/quay.js goal gate AC-303 --dry-run --json` 在**修订后** `exit 0`，且它实际派生/使用的地址 = **当次**载体里 `web` 服务的真实端口（⛔ 不是 0）。贴：修订前后 criterion 的 md5（**修订前 = `441ab29887d0a4f2572b03a3ad7791d6`**，取法 = `quay goal show AC-303 --json` 的 `.criterion` 字段逐字落盘后 `md5sum`）、派生地址、`GATE_EXIT=`、以及 `curl` 在 `http://<web addr>/architecture` 上的 en/zh 两条读数（`<html lang=…>`、nav 区块 `Architecture` 条数、本页 `<title>`）。
- [x] **AC2（能取假，两向都贴；⛔ 只贴绿侧不算）**：(a) **无活候选** ⇒ 非 0，且 stderr 的具名 `CAUSE` 与 (b) **不同形**；(b) 候选地址指向必然连不上的端口（例如把载体的 web 端口临时改指一个已关闭端口，或用 cwd = 仓库根但 `--port` 指向死端口的候选）⇒ 非 0，成因含「连接被拒／取不到」。两侧读数都贴。
- [x] **AC3（非字面量；硬规则 4 推论二 + 硬规则 2 的检测半边）**：`grep -c "19071\|172\.28\.0\.1" goals/AC-303-*.md` ⇒ **0**（⛔ 不得把本机当前端口/主机写成字面量），并贴出完整输出；**配套动作**：把同一谓词对着一个**已知为真**的样本（如本任务体里的 `127.0.0.1:19071` 串）干跑一次 ⇒ 必须非 0，证明谓词不是恒零。
- [x] **AC4（归因；硬规则 3b）**：制造一次真实 fail（用 AC2 任一方向），stderr 必须对**每个**候选给出 `pid` + 派生地址 + 成因；⛔ 候选存在时不得出现 `addr=` 空或无成因的裸失败 —— 「查不成」与「不合格」必须可区分。
- [x] **AC5（作用域与语义不变）**：`expect` 逐字不变、`ROUTE="/architecture"` 与 `LABEL_EN="Architecture"` 逐字不变、chrome 作用域（只对 `<nav>…</nav>` 与 `<title>` 匹配，⛔ 不放宽到整段响应）逐字不变；修订只经 `quay goal write AC-303 --criterion …` 落库且记录含「为什么改」；修订后**新** criterionHash 至少有一条独立的 `quay goal gate AC-303` 落账。
- [x] **AC6（本仓库自身行为不回退）**：`node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts` `exit 0`；`node --experimental-strip-types packages/quay/bin/quay.ts goal check --stale-pass` 的 failing 集合不再含 AC-303（贴该集合条数与 AC-303 是否在内；立案当轮基线实测 = **15 条** `[AC-179, AC-289, AC-291…AC-303]`，AC-303 **在内**）。
- [x] **AC7（scoped 门）**：`bash scripts/test.sh --for-task gap-ac303-criterion-cmdline-port-literal-stale --allow-thin` `exit 0`。

## DoD

- **真落地**：`goals/AC-303-*.md` 的重锚版落在 **develop**（`git show develop:goals/AC-303-*.md` 可见 `>>> addr-derivation` 块），且台账尾事件是**新 criterionHash 的 pass**，由**一次对活生产实例的真跑**产出（⛔ 不是夹具、不是 dry-run、不是引用旧 verdict 的轮转）。
- **保证本体重测**：在判据实际使用的那个地址上，`/architecture` 的 en 基线（nav 区块 `Architecture` 条数 ≥ 1 且本页 `<title>` 为英文，≠ zh 标题）与 zh（`<html lang="zh"` ∧ nav 区块 `Architecture` = 0 ∧ 本页 `<title>` = `quay — 架构 — 系统组件图`）**各由响应体直读**（⛔ 不读 render 函数的返回值当「响应」—— 那测的是函数，不是线上行为）。
- **`node --experimental-strip-types packages/quay/bin/quay.ts goal check --stale-pass` ⇒ `AC-303` 不在 `failing` 内。**
- AC1–AC4 的**正负两向**读数都在任务体或 `.quay/ac303-crit-*` 未跟踪 scratch 里（⛔ 只贴绿侧不算），可被下一轮独立复算。
- **不越界**：AC-179、AC-288…AC-302 的 criterion 及它们的页面任务不在本任务 Touches 内；若执行者选择一并重锚，必须**先**把对应 `goals/AC-*.md` 加进 Touches 并对每条逐条实测前后读数（⛔ 不得批量改未测量的判据）。
- 本任务自身 `done` 并随 fan-in 落地。

## Evidence

落点：判据读数与台账在主检出 `/data/home/yale/work/quay`（判据探的就是那个 root 的活实例），夹具与 scoped 门在任务 worktree。原始输出在**未跟踪 scratch** `.quay/ac303-crit-evidence/`：`ac1-readings.txt`、`neg-controls.out` + `neg-controls.sh`（可直接重跑）、`criterion-before.sh` / `criterion-after.sh`（md5 见下）、`scoped-gate.txt`。

**AC1** — 修订前 criterion md5 `441ab29887d0a4f2572b03a3ad7791d6`（与立案值同值；取法 = `goal show AC-303 --json` 的 `.criterion` 逐字落盘后 `md5sum`）→ 修订后 `7b35d8c0511508643b9c0c484a55700a`。派生地址 = `127.0.0.1:16377`：载体 `.quay/server.json` 的 `name=="web"` = `0.0.0.0:16377`（pid 850862；**同 pid 的 `control` = 127.0.0.1:6621**，取错会打到控制面），通配 host 归一化 0.0.0.0→127.0.0.1；shipped block 自己的 `sh -x` 轨迹逐字为 `+ addr=127.0.0.1:16377`（⛔ 不是 0，⛔ 不是写死的字面量）。`goal gate AC-303 --dry-run --json` ⇒ `GATE_EXIT=0`、`verdict=pass`、`reason=acceptance passed (exit 0)`。en：`<html lang="en"`，nav 区块 `Architecture` **2** 条，nav 区块 2641 bytes，本页 `<title>` = `quay — Architecture — system component map`；整段响应 `Architecture` **4** 条（约 3 条落在 `<nav>` 之外 —— 作用域必须收窄的直接理由）。zh：`<html lang="zh"`，nav 区块 `Architecture` **0** 条，nav 区块 2636 bytes，本页 `<title>` = `quay — 架构 — 系统组件图`。（⚠️ nav 区块字节数与立案轮 1310/1223 不同 —— 现 nav 区块含 mobile-menu 分组；**四条断言臂的结论与立案轮一致**。）

**AC2（两向都贴）** — (a) **无活候选**：从任务 worktree root（该 root 无 serve 实例）以**文件**形态跑 criterion ⇒ `EXIT=1`、`CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=<root>; the locale mechanism cannot be evaluated on a live surface (AC-179 probe pattern)`、`CANDIDATES: none -- pgrep -f 'quay.ts serve' x cwd=<root> matched no process`。(b) **候选可派生、地址无人应答**：临时 `git init` root 里一个 serve 形状进程（cwd = 该 root，argv 显式 `--port <内核刚释放的端口>`）⇒ `EXIT=1`、`CAUSE=en-fetch-failed -- GET http://127.0.0.1:2297/architecture returned nothing (addr=127.0.0.1:2297)`（即「取不到」）。两向成因**不同形**（`no-running-serve-instance` vs `en-fetch-failed`）。⛔ 未改 `expect`、未放宽任何断言。

**AC3** — `grep -c "19071\|172\.28\.0\.1" goals/AC-303-*.md` ⇒ 完整输出即 `0`（⛔ 无本机端口/主机字面量）。**配套正控制**：同一谓词对着**已知为真**的样本（本任务体，含 `127.0.0.1:19071` 与 `172.28.0.1:0`）⇒ **5** 命中 ⇒ 谓词不是恒零。

**AC4** — 用 AC2 方向制造真实 fail：候选**存在**但都不可派生（`--port 0` 且无载体）⇒ `EXIT=1`、`CAUSE=no-derivable-address -- pgrep -f 'quay.ts serve' x cwd=<root> matched candidate(s) but none yielded a live web address (...)`，其 stderr 逐字为 `CANDIDATES: | pid=2239742 addr=- cause=argv-port-kernel-assigned,carrier-absent | pid=2239744 addr=- cause=argv-port-kernel-assigned,carrier-absent` —— **每个**候选都带 `pid` + 地址（不可派生时为 `addr=-`，⛔ 不是空的 `addr=`）+ 成因。对照组（一个可派生 + 一个不可派生）仍成功且两行都在报告里：`DERIVED_ADDR=127.0.0.1:46021` + `REPORT= | pid=… addr=- cause=… | pid=… addr=- cause=… | pid=… addr=127.0.0.1:46021 cause=derived-from-argv`。夹具另有 20 例把同一契约钉死（含「载体**声明**的端口死了也必须由 HTTP GET 判负」—— 载体只派生地址，不背书）。

**AC5** — `expect` 逐字不变（写后回读与旧值 `===` 比对 true）、`ROUTE="/architecture"` / `LABEL_EN="Architecture"` 两行**逐字取自旧判据**并留在派生块**外**、chrome 作用域逐字不变（`case "$nav_en" in *"$LABEL_EN"*` / `case "$nav_zh" in *"$LABEL_EN"*` / `grep -o '<nav.*</nav>'` / `grep -oE '<title>[^<]*</title>'` 全部保留，⛔ 未放宽到整段响应；夹具有一条结构性断言把它钉住，含「`ROUTE=`/`LABEL_EN=` 不得落在块内」）。修订**只**经 `quay goal write AC-303 --criterion …` 落库（worktree 一个提交 + 主检出一个同文本提交），⛔ 未 `Edit` goal 文件；「为什么改」写在 criterion 顶部的 `# WHY THIS STEP WAS RE-ANCHORED` 注释块（在 `>>> addr-derivation` 标记**之外**，块本身逐字取自 `goals/AC-288-*.md`，仅块首注释里的夹具名 `ac288-`→`ac303-`）。修订后**新** criterionHash = `abc74ce6609f1567`（台账 `2026-09-23T16:11:31.630Z`、`actor=goal-amend`、`verdict=pass`），**≠** 旧 `f452c81b20f3ae15`；另有一次对活实例的真跑 `goal gate AC-303` 落账（`16:11:22.099Z`、`actor=goal-cli`、pass —— plain `gate` 事件按设计不携带 `criterionHash`）。

**AC6** — `node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts` ⇒ `ATTRIB_EXIT=0`（`PASS: criterion failure attribution intact: inDomain=155 bareAcs=0 ≤ baseline 0 (bareLines=0)`）。`goal check --stale-pass` ⇒ failing **8** 条 `[AC-179, AC-255, AC-289, AC-296, AC-298, AC-299, AC-300, AC-302]`，**AC-303 不在内**、且在 `verifiedFresh` 内（立案轮基线 15 条、AC-303 在内 —— 差额是同期其它同族任务已各自重锚）。

**AC7** — `bash scripts/test.sh --for-task gap-ac303-criterion-cmdline-port-literal-stale --allow-thin` ⇒ `exit 0`（`tests 20 / pass 20 / fail 0`；`warning: test-selection-thin … resolved tests for 1/3 Touches entries` 是**选择广度**不是红，故用 `--allow-thin` 形态）。随后已写 scoped-gate 缓存：`key = "gap-ac303-criterion-cmdline-port-literal-stale\t353fa7e791be6616bf9520609f377a9b959416da"`、`ok:true`。

**配套夹具** `packages/quay/test/ac303-criterion-address-derivation.test.mjs`（`// @test-group product`）：按 marker 从 `goals/AC-303-*.md` **逐字抽取**派生块（单一正本，⛔ 不是逻辑副本），在 `git init` 过的临时 root 里对**真实** serve 形状进程与**真实**载体跑 20 例正/负两向（显式端口 / `--host=``--port=` 等号形 / 通配归一化 / `--port 0`+载体 / 载体通配 host / argv 优先 / 无载体 / 载体 pid 不符 / 无 `web` 条目 / `up:false` / 死 pid / 载体不可读 / 无候选 / 有候选但都不可派生 / runner 自身 sh 也是候选 / 归因契约 2 例 / 判据全文取半身 2 例）。

**⛔ 越界声明**：只重锚了 AC-303 一条。AC-179、AC-288…AC-302 的 criterion 未动（它们的 `goals/AC-*.md` 不在本任务 Touches 内，逐条前后读数也未测 ⇒ 按 DoD 不批量改）。

## Touches

- goals/AC-303-architecture-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- packages/quay/test/ac303-criterion-address-derivation.test.mjs (new)
- tasks/gap-ac303-criterion-cmdline-port-literal-stale.md

（说明：第一条是本任务的落地面 —— criterion 的地址派生那一步，经 `quay goal write AC-303 --criterion …` 落库，`expect` 与 chrome 作用域语义逐字不变、只补「为什么改」；第二条是配套夹具（按 marker 从 goal 文件逐字抽取派生块，与 `packages/quay/test/ac288-criterion-address-derivation.test.mjs` 同族、页面各一）；第三条是 self-touch。⛔ 不新增 `plugin/scripts/*.ts` —— 派生助手若要抽出，默认放 `packages/quay/src/`；若最终落在 `plugin/scripts/`，必须同时把 outline、`plugin/scripts/capability-catalog-declarations.json` 与本任务 Touches 一并更新。⛔ `packages/quay/src/serve-architecture.ts` / `serve-i18n.ts` **不在本 Touches 内** —— 它们已被本 AC 的 done 任务修好且本轮实测为真。）

## Evidence

**AC1 — 重锚后判据在活实例上为真**（读数在**落脚本轮**重新取一次，⛔ 非转述上一轮）

- criterion md5 **修订前** = `441ab29887d0a4f2572b03a3ad7791d6`（3075 bytes；逐字复跑得 `CAUSE=en-fetch-failed -- GET http://127.0.0.1:0/architecture returned nothing (addr=127.0.0.1:0)`）
- criterion md5 **修订后** = `7b35d8c0511508643b9c0c484a55700a`（8247 bytes）
- 活载体 `/data/home/yale/work/quay/.quay/server.json`：`pid=2035152`，`name=="web"` ⇒ `0.0.0.0:10539` `up=true`（`control` 是同 pid 的另一个端口，⛔ 取错会打到控制面）
- 判据**自己那一步**派生的地址（`bash -x` 抓 `+ addr=`）：`127.0.0.1:10539`，`src=carrier`（通配 host 已归一化到 loopback；⛔ 不是 0）
- `GATE_EXIT=0` —— `goal gate AC-303 --dry-run --json` ⇒ `verdict: "pass"`，`"acceptance passed (exit 0)"`
- en/zh 两条读数（在**判据实际使用的地址**上由响应体直读，chrome 作用域 = criterion 自己的取法：`tr '\n' ' '` 后 `grep -o '<nav.*</nav>'` / `grep -oE '<title>[^<]*</title>'`）

| 读数 | en | zh |
|---|---|---|
| `<html lang=…>` | `<html lang="en"` | `<html lang="zh"` |
| `<nav>…</nav>` 区块内 `Architecture` **条数** | **2** | **0** |
| nav 区块字节数 | 2642 | 2637 |
| 本页自己的 `<title>` | `quay — Architecture — system component map` | `quay — 架构 — 系统组件图` |
| （判别性对照）整段响应 `Architecture` **条数** | **4** | **0** |

⇒ en 基线在场 ∧ zh 三条断言臂（`<html lang="zh"`、nav 无该字面量、本页 `<title>` 变中文）都成立。⚠️ en 全响应 4 条里约 3 条落在 `<nav>` 之外（`<h1>`/图例/表格）—— 这正是作用域必须窄的原因；⛔ 修订未放宽作用域。

**AC2 / AC4 — 负控制两向 + 归因**（原始读数 `.quay/ac303-crit-evidence/neg-controls.out`，驱动脚本同目录 `neg-controls.sh`）

(a) **无活候选**（cwd = 一个没有对应 serve 进程的 git root）：
```
CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=<worktree>; the locale mechanism cannot be evaluated on a live surface (AC-179 probe pattern)
CANDIDATES: none -- pgrep -f 'quay.ts serve' x cwd=<worktree> matched no process
EXIT_A=1
```
(b) **候选可派生但无人应答**（显式 `--port` 指向一个刚释放的死端口）：
```
CAUSE=en-fetch-failed -- GET http://127.0.0.1:2297/architecture returned nothing (addr=127.0.0.1:2297)
EXIT_B=1
```
两侧具名成因**不同形**（`no-running-serve-instance` vs `en-fetch-failed`），⛔ 不是同一个裸失败。

AC4 **归因**（候选存在但无一可派生 ⇒ 每个候选各成一行，`addr=-` + 成因；⛔ 无空 `addr=` 的裸失败）：
```
CAUSE=no-derivable-address -- pgrep -f 'quay.ts serve' x cwd=<tmp root> matched candidate(s) but none yielded a live web address (an explicit --port >= 1 on the process's own argv, or this root's .quay/server.json naming that pid's web service)
CANDIDATES: | pid=2306119 addr=- cause=argv-port-kernel-assigned,carrier-absent | pid=2306124 addr=- cause=argv-port-kernel-assigned,carrier-absent
EXIT_C=1
```
反向配套（一可派生 + 一不可 ⇒ 成功，且**两行都不丢**）：
```
DERIVED_ADDR=127.0.0.1:46021
REPORT= | pid=2306119 addr=- cause=argv-port-kernel-assigned,carrier-absent | pid=2306124 addr=- cause=argv-port-kernel-assigned,carrier-absent | pid=2308393 addr=127.0.0.1:46021 cause=derived-from-argv
EXIT_D=0
```

**AC3 — 非字面量 + 同一谓词对已知为真样本的检测半边**
```
$ grep -c "19071\|172\.28\.0\.1" goals/AC-303-*.md
0                                  (rc=1)
$ printf 'addr 127.0.0.1:19071\n' | grep -c "19071\|172\.28\.0\.1"
1                                  (rc=0)   ← 非恒零，谓词本身有效
```

**AC5 — 作用域与语义不变**
- `expect`、`ROUTE="/architecture"`、`LABEL_EN="Architecture"` 与 chrome 作用域（只匹配 `<nav>…</nav>` 与 `<title>`）逐字未变；修订只经 `quay goal write AC-303 --criterion …` 落库，⛔ 未直接 `Edit` goal 文件；「为什么改」写在 criterion 顶部的 `# WHY THIS STEP WAS RE-ANCHORED` 注释块里。
- 新 `criterionHash` = `abc74ce6609f1567`（≠ 修订前 `f452c81b20f3ae15`），有**两条独立落账**：`actor=goal-amend` `2026-09-23T16:11:31.630Z` 与 `actor=goal-sweep` `2026-09-23T17:23:51.587Z`，均 `verdict:"pass"`。
- 单一正本关系的机械保证：夹具 `packages/quay/test/ac303-criterion-address-derivation.test.mjs` 有一条用例断言「按 marker 从 goal 文件抽出的块 == 落库的派生块」且 why/route/label 留在块外。

**AC6 — 本仓库自身行为不回退**（本轮实测）
- `node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts` ⇒ `PASS: criterion failure attribution intact: inDomain=155 bareAcs=0 ≤ baseline 0 (bareLines=0)`，`exit 0`。
- `node --experimental-strip-types packages/quay/bin/quay.ts goal check --stale-pass` ⇒ failing 集合 = `AC-179`（**1 条**），**AC-303 不在内**（立案当轮基线 = **15 条**且 AC-303 在内）。

**AC7 — scoped 门**：`bash scripts/test.sh --for-task gap-ac303-criterion-cmdline-port-literal-stale --allow-thin` ⇒ `exit 0`（本 AC 夹具 20 条用例全绿，含 9 条派生分支的负向枚举）。