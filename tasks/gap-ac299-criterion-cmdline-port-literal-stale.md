---
id: gap-ac299-criterion-cmdline-port-literal-stale
title: AC-299 判据从 cmdline 的 `--port` 字面量派生地址，而生产启动器默认已是 `--port 0`（内核分配临时端口）⇒
  判据在真实部署上结构性失效（addr=172.28.0.1:0，curl 失败）；机制本身为真（实测 /sessions 四条断言全过）——
  重锚地址派生那一步（照搬 AC-288 已落地的同族形态，同一行）
status: done
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-299
---
**type:** execution

## Proposal

**缺口（立案当轮直接量，`2026-09-23T09:25:48.506Z`，cwd = 主检出 `/data/home/yale/work/quay`；`--dry-run` ⛔ 不写台账）**

```
node packages/quay/bin/quay.js goal gate AC-299 --dry-run --json
⇒ {"id":"AC-299","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=en-fetch-failed -- GET http://172.28.0.1:0/sessions returned nothing (addr=172.28.0.1:0)",
   "timestamp":"2026-09-23T09:25:48.506Z","dryRun":true}
GATE_EXIT=1
```

**成因不是「机制坏了」—— 是判据派生地址的那一步解析了一个启动器已按设计置 0 的字面量。**

同一进程、同一时刻的三个读数（立案轮实测，⛔ 非转述）：

| 面 | 读数 | 取法 |
|---|---|---|
| 生产实例 | pid `3121749`，cwd = `/data/home/yale/work/quay`，cmdline `node --experimental-strip-types packages/quay/bin/quay.ts serve --host 172.28.0.1 --port 0`，`startedAt 2026-09-23T09:07:10.451Z` | `readlink /proc/3121749/cwd` + `tr '\0' ' ' < /proc/3121749/cmdline` |
| 判据按 cmdline 派生的地址 | `172.28.0.1:0` ⇒ `curl -sf --max-time 10` 失败 ⇒ `CAUSE=en-fetch-failed` | criterion 里 `grep -oE -- '--host [^ ]+ --port [0-9]+'` 那一步 |
| 同一进程的**真实**监听地址（活宿主载体） | `name=="web"` ⇒ `172.28.0.1:14037`（另有 `control 127.0.0.1:26533`，**同 pid 不同端口**，取错会打到控制面） | `cat .quay/server.json` |

**机制本身为真（同一轮，用真实端口直读响应体；⛔ 不是 grep 源码）**

把 criterion **原文逐字复制，只把 `addr` 一处换成真实值**，其余（含 nav 区块抽取、`<title>` 抽取、三段断言、OK 文本）一字不改：

```
OK -- /sessions: default nav region carries "Sessions" and <title>="quay — Sessions — session observation";
under Cookie: lang=zh the response is <html lang=zh>, that English nav label is gone from the nav
region, and this page's own <title> became "quay — 会话 — 会话观测"
EXIT=0
```

| 断言（criterion 自己的 chrome 作用域取法：`tr '\n' ' '` 后 `grep -o '<nav.*</nav>'` / `grep -oE '<title>[^<]*</title>'`） | en | zh |
|---|---|---|
| `<html lang=…>` | `<html lang="en"` | `<html lang="zh"` |
| nav 区块字面量 `Sessions`（条数） | 2 | 0 |
| （对照）nav 区块 `会话`（条数） | 0 | 2 |
| 本页自己的 `<title>` | `quay — Sessions — session observation` | `quay — 会话 — 会话观测` |
| （硬规则 3：给条数，不给单一布尔）整段响应里 `Sessions` 残留 | 4 | 0 |
| （判据读不到的 chrome，AC-299 done 任务 AC1b 的口径）`<span class="mobile-header-page">` | `sessions` | `会话` |

⇒ criterion 的四条独立断言臂（en 基线在场、zh 响应 `<html lang="zh">`、zh nav 无 `Sessions`、本页 `<title>` 相对 en 变化）**都在活服务上为真**；**fail 只发生在派生地址那一步**，且它以具名 `CAUSE=en-fetch-failed` 报出（硬规则 3b：判据没有伪装成通过）。

⚠️ **`expect` 里没有钉死 en 的 `<title>` 文本**（如实登记，硬规则 2 下半）：AC-299 立案时（done 任务正文 `:51`）的 en 标题是 `quay — Sessions — 会话观测`，**现在是 `quay — Sessions — session observation`** —— 这是 `c9a6d2436`（`webui(/sessions): body copy localization (serve-i18n ROW 15)`）把页内副标题也纳入字典所致，**不是回退**。criterion 只要求「本页 `<title>` 在 zh 下与 en 不同」＋「默认语言 nav 区块含字面量 `Sessions`」，两者现在都成立 ⇒ 该漂移不影响本任务，但**执行者不得把 old 立案基线当成本轮读数**。

**台账：判据文本没变，是它读取的宿主移动了**（硬规则 4b：不用被测对象自报的量判它；`criterionHash` 是判据的指纹）：

```
2026-09-23T05:21:06.688Z  goal-sweep  pass  criterionHash 4043d01f90aa9a56   ← gen-1 实例（cmdline 有可解析的 --port）
2026-09-23T08:42:34.487Z  goal-sweep  fail  criterionHash 4043d01f90aa9a56   ← gen-2 实例（--port 0）
（其后 08:43:48Z / 08:57:36Z / 09:18:32Z 三次 fail，addr 恒为 172.28.0.1:0）
```

红绿两侧的 `criterionHash` **相同** ⇒ 判据文本没有被改过，改的是它读取的宿主（承载体搬迁）。这是「判据 stale」与「代码回退」最省事的分辨器：**先看这个指纹，不要先去找代码回归。**

⚠️ **同一 AC 的两种红不要混淆**（`CAUSE=` 是分辨器）：`CAUSE=en-fetch-failed … (addr=<host>:0)` 是**本任务**处理的承载体缺陷；`CAUSE=no-running-serve-instance` 意味着**那一刻**没有 cwd = 仓库根的 serve 进程在跑 —— 那是探针设计上的 fail-closed 前提，**不是**本任务的机制，重锚派生那一步不会（也不应）修它。同族曾在同一 AC 上先后出现过两种形态。

**为什么更早的修复没兜住这一条（本 AC 上已有一条 done 任务）**

`gap-ac299-sessions-page-zh-chrome-nav-current-and-own-title`（done，实现 commit `7be25acc3`）**做出了页面侧的真实接线**（`serve-sessions.ts` 的 `renderSessionsPage` + `serve-i18n.ts` 的 `PAGE_LABELS` 词条），**且它今天仍然成立** —— 上面 `EXIT=0` 的读数就是它成立的直接量。它**从未碰过判据**：该任务正文逐字写着两处排除 —— `tasks/gap-ac299-…-own-title.md:147`（AC4：⛔「明令禁止」的三种「凑绿」之一即「改判据（`goals/AC-299-*.md` ⛔ 不在本 Touches 内）」）与 `:168`（「`goals/AC-299-*.md` 属人与驱动维护面，⛔ 不在本 Touches」）。⇒ 该任务从来不是「页面缺失」，本次红也**不是它回退**；**没有任何任务碰过地址派生这一步**，而这次坏掉的恰是它。

**承载体何时搬的**：`ce0f47518`（2026-09-18，`gap-serve-same-root-admission-lock`，done）把 web 端口默认改成**内核分配临时端口**（`--port 0`）。⛔ 本任务不逐字转述其源码注释 —— 正本是 `plugin/scripts/start-drivers.ts` 与 `packages/quay/src/cli/server.ts`，执行者按盘上**当前**内容读（硬规则 5b：别只信本文的转述）。**为什么它 09-18 落码、09-23 才红**：旧的 gen-1 实例在码变**之前**就以显式端口起好并一直活着，判据照旧可派生；实例重启出 gen-2（走新默认 `--port 0`）后，下一次判据轮才第一次拿到 `addr=…:0`。⇒ 一次承载体搬迁同时打中**整族**同型判据（本仓库实测：AC-179 + AC-288 + AC-289…AC-303）。

**正本块（⛔ 取用，不另造）**：`goals/AC-288-*.md` 的 criterion 已含 `# >>> addr-derivation` … `# <<< addr-derivation` 块，且 AC-288 现判据在活实例上实测 `exit 0`（新 `criterionHash` `23c1927ab51c48b3`，台账 `2026-09-23T08:55:15.565Z` pass）。本 AC 的重锚**逐字采用该块**，route/label 声明留在块外（`ROUTE="/sessions"` / `LABEL_EN="Sessions"` 两行，逐字不变）。

<!-- dedup-ref -->
**去重（按机制，⛔ 不按症状关键词）与可追溯性**：顶层 `goal_ac: AC-299` 的 `grep -rn` ⇒ **1 命中**，`gap-ac299-sessions-page-zh-chrome-nav-current-and-own-title`，status **done** ⇒ 本 AC 无在飞主，本条不是重复立案，而是「承载体搬迁 ⇒ 判据 stale」这一机制在本 AC 上的实例。同机制、**不同 AC** 的在飞任务：`gap-ac297-criterion-cmdline-port-literal-stale` / `gap-ac298-criterion-cmdline-port-literal-stale`（`todo`）与 `gap-ac179-…` / `gap-ac288-…` / `gap-ac289-…` / `gap-ac290-…` / `gap-ac291-…` / `gap-ac292-…` / `gap-ac293-…` / `gap-ac294-…` / `gap-ac295-…` / `gap-ac296-…`（均 `ready`）—— 每条各自重锚**自己那一条** AC 的判据，**互不覆盖**（此族在本仓库是**一 AC 一任务**地排空的，本 AC 是本轮尚未立案的那一条；AC-300…AC-303 同族亦尚未立案，⛔ 不在本任务 Touches 内，各需自己的实测与立案）。同型先例（承载体搬迁后把判据移到真正承载该角色的地方）：`gap-ac286-fanin-merge-target-criterion-carrier-stale`（done）、`gap-ac157-catalog-carrier-moved-criterion-stale`（done）。引入临时端口默认的 `gap-serve-same-root-admission-lock`（done）改的是**启动器**，从未重锚过任何判据 —— 相关但不同机制。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-299 --dry-run --json` ⇒ `verdict: fail` 且 `addr=172.28.0.1:0`；同一时刻 `cat .quay/server.json` 取 `name=="web"` 的端口读数，**两者必须指向同一 pid**。若届时 `CAUSE` 是 `no-running-serve-instance`，**停下核对**：那说明此刻没有 cwd = 仓库根的实例在跑，⛔ 不得当成同一现象处理（见 Proposal 的两种红）。
2. **取正本块，⛔ 不另造**：从 `goals/AC-288-*.md` 抽出 `# >>> addr-derivation` 块逐字用于 AC-299（正本 reader = `packages/quay/src/server-state.ts` 的 `readServerState` / `ServerServiceEntry` / `pidAlive` / `probeAddress`）；⛔ 不把本机当前端口/主机写成字面量（换台机器或重启即失效；硬规则 4 推论二）。
3. **重锚**：`quay goal write AC-299 --criterion "$(cat <新 criterion 文件>)"` 落库（贴逐字 diff：只有派生块与「为什么改」变化），`expect`、`ROUTE`/`LABEL_EN` 与 chrome 作用域语义逐字不变；⛔ 不得直接 `Edit` goal 文件。
4. **配套夹具** `packages/quay/test/ac299-criterion-address-derivation.test.mjs`（`// @test-group product`，`node:test`）：按 marker 从 `goals/AC-299-*.md` **逐字抽取**派生块（单一正本关系，⛔ 不是逻辑副本），在 `git init` 过的临时 root 里对真实进程与真实载体跑正/负两向（显式端口 / `--port 0` + 载体 / 通配 host 归一化 / 无载体 / 载体 pid 不符 / 无 `web` 条目 / `web.up:false` / 死端口）。**同族夹具 `packages/quay/test/ac288-criterion-address-derivation.test.mjs` 立案当轮实测 ⛔ 仍未落在 develop/author（`ls` ⇒ No such file）** ⇒ 执行前先核对它是否已落地：已落地则**照其形态**写本 AC 的同族文件；未落地则**不得假定其内容**，按本 Plan 的枚举自行写全。
5. **两个负控制**（硬规则 4 推论三：判据必须能取假）：① 无实例 ⇒ 非 0 且以具名成因可区分；② 候选地址指向必然连不上的端口 ⇒ 非 0 且成因与 ① **不同形**。⛔ 不得靠改 `expect` 或放宽断言来「凑绿」。
6. **落账**：`node packages/quay/bin/quay.js goal gate AC-299` ⇒ exit 0，且台账新增一条 `verdict:"pass"`，其 `payload.criterionHash` **≠ 修订前指纹 `4043d01f90aa9a56`**。

⚠️ **运行前提（运维须知，不是可选项）**：本 AC 的判据读**运行中的服务**（`pgrep -f 'quay.ts serve'` × cwd = 仓库根），⛔ 不自己启服务。本任务改的是**地址派生**那一步，页面代码未动 ⇒ **不需要重启 serve 实例**（与页面侧任务的要求相反）；但若实例在此期间被重启，判据必须仍 `exit 0`（AC3 的非字面量性质即测这一点）。立案当轮现场：5 个 `pgrep -f 'quay.ts serve'` 命中里只有 **1 个** cwd = 仓库根（另 2 个在 worktree 内、1 个是已消失的 bash 包装、1 个属别的用户/仓库）⇒ 重锚后的候选枚举必须仍只认 cwd = 仓库根那一个。

## AC

- [x] **AC1（重锚后判据在活实例上为真）**：`node packages/quay/bin/quay.js goal gate AC-299 --dry-run --json` 在**修订后** `exit 0`，且它实际派生/使用的地址 = **当次**载体里 `web` 服务的真实端口（⛔ 不是 0）。贴：修订前后 criterion 的 md5（**修订前 = `4b43b2403476a121ffb9befe4652f80d`**，取法 = `quay goal show AC-299 --json` 的 `.criterion` 字段逐字落盘后 `md5sum`）、派生地址、`GATE_EXIT=`、以及 `curl` 在 `http://<web addr>/sessions` 上的 en/zh 两条读数（`<html lang=…>`、nav 区块 `Sessions` 条数、本页 `<title>`）。
- [x] **AC2（能取假，两向都贴；⛔ 只贴绿侧不算）**：(a) **无活候选** ⇒ 非 0，且 stderr 的具名 `CAUSE` 与 (b) **不同形**；(b) 候选地址指向必然连不上的端口（例如把载体的 web 端口临时改指一个已关闭端口，或用 cwd = 仓库根但 `--port` 指向死端口的候选）⇒ 非 0，成因含「连接被拒／取不到」。两侧读数都贴。
- [x] **AC3（非字面量；硬规则 4 推论二 + AC3 的检测半边）**：`grep -c "14037\|172\.28\.0\.1" goals/AC-299-*.md` ⇒ **0**（⛔ 不得把本机当前端口/主机写成字面量），并贴出完整输出；**配套动作**：把同一谓词对着一个**已知为真**的样本（如本任务体里的 `172.28.0.1:14037` 串）干跑一次 ⇒ 必须非 0，证明谓词不是恒零（硬规则 2 下半）。
- [x] **AC4（归因；硬规则 3b）**：制造一次真实 fail（用 AC2 任一方向），stderr 必须对**每个**候选给出 `pid` + 派生地址 + 成因；⛔ 候选存在时不得出现 `addr=` 空或无成因的裸失败 —— 「查不成」与「不合格」必须可区分。
- [x] **AC5（作用域与语义不变）**：`expect` 逐字不变、`ROUTE="/sessions"` 与 `LABEL_EN="Sessions"` 逐字不变、chrome 作用域（只对 `<nav>…</nav>` 与 `<title>` 匹配）逐字不变；修订只经 `quay goal write AC-299 --criterion …` 落库且记录含「为什么改」；修订后**新** criterionHash 至少有一条独立的 `quay goal gate AC-299` 落账。
- [x] **AC6（本仓库自身行为不回退）**：`node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts` `exit 0`；`node --experimental-strip-types packages/quay/bin/quay.ts goal check --stale-pass` 的 failing 集合不再含 AC-299（贴该集合条数与 AC-299 是否在内）。
- [x] **AC7（scoped 门）**：`bash scripts/test.sh --for-task gap-ac299-criterion-cmdline-port-literal-stale --allow-thin` `exit 0`。

## DoD

- **真落地**：`goals/AC-299-*.md` 的重锚版落在 **develop**（`git show develop:goals/AC-299-*.md` 可见 `>>> addr-derivation` 块），且台账尾事件是**新 criterionHash 的 pass**，由**一次对活生产实例的真跑**产出（⛔ 不是夹具、不是 dry-run、不是引用旧 verdict 的轮转）。
- **保证本体重测**：在判据实际使用的那个地址上，`/sessions` 的 en 基线（nav 区块 `Sessions` 条数 ≥ 1 且本页 `<title>` 含 ASCII `Sessions`）与 zh（`<html lang="zh"` ∧ nav 区块 `Sessions` = 0 ∧ 本页 `<title>` 不含 ASCII `Sessions`）**各由响应体直读**（⛔ 不读 render 函数的返回值当「响应」—— 那测的是函数，不是线上行为）。
- **`node --experimental-strip-types packages/quay/bin/quay.ts goal check --stale-pass` ⇒ `exit 0`，`AC-299` 不在 `failing` 内。**
- AC1–AC4 的**正负两向**读数都在任务体或 `.quay/ac299-*` 未跟踪 scratch 里（⛔ 只贴绿侧不算），可被下一轮独立复算。
- **不越界**：AC-179、AC-288…AC-298 与 AC-300…AC-303 的 criterion 及它们的页面任务不在本任务 Touches 内；若执行者选择一并重锚，必须**先**把对应 `goals/AC-*.md` 加进 Touches 并对每条逐条实测前后读数（⛔ 不得批量改未测量的判据）。
- 本任务自身 `done` 并随 fan-in 落地。

## Touches

- `goals/AC-299-sessions-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md`
- `packages/quay/test/ac299-criterion-address-derivation.test.mjs` (new)
- `tasks/gap-ac299-criterion-cmdline-port-literal-stale.md`

（说明：第一条是本任务的落地面 —— criterion 的地址派生那一步，经 `quay goal write AC-299 --criterion …` 落库，`expect` 与 chrome 作用域语义逐字不变、只补「为什么改」；第二条是配套夹具（按 marker 从 goal 文件逐字抽取派生块，与 `packages/quay/test/ac288-criterion-address-derivation.test.mjs` 同族、页面各一）；第三条是 self-touch。⛔ 不新增 `plugin/scripts/*.ts` —— 派生助手若要抽出，默认放 `packages/quay/src/`；若最终落在 `plugin/scripts/`，必须同时把 outline、`plugin/scripts/capability-catalog-declarations.json` 与本任务 Touches 一并更新。⛔ `packages/quay/src/serve-sessions.ts` / `serve-i18n.ts` **不在本 Touches 内** —— 它们已被本 AC 的 done 任务修好且本轮实测为真。）

## 执行记录（落地读数 / 修法 / 为什么改）

**为什么改**：`ce0f47518`（`gap-serve-same-root-admission-lock`，done）把 web 端口默认改成内核分配（`--port 0`），派生那一步解析出的字面量恒为 `0` ⇒ `<host>:0` 是**结构性**不可 fetch 的地址，本 AC 在任何使用该默认的部署上恒假。机制本身从未坏：在**当次**载体 `web` 的真实地址上四条断言全过。坏的只是**判据的承载体**（地址派生那一步）。台账红绿两侧 `criterionHash` 相同（`4043d01f90aa9a56`）= 判据文本没变、变的是宿主。

**修法**：只重锚**地址派生那一步** —— 逐字取用 `goals/AC-288-*.md` 的 `# >>> addr-derivation` … `# <<< addr-derivation` 块（同一行、同族形态；仅把 marker 注释里的夹具路径改为 ac299），`ROUTE="/sessions"` / `LABEL_EN="Sessions"` 两行留在块外逐字不变。候选仍由 `pgrep -f 'quay.ts serve'` × `/proc/<pid>/cwd == $root` 产生；每个候选先读**它自己的 argv**（NUL 分隔、**按位置**判 `serve … --host H --port N`，N ≥ 1），否则读 `$root/.quay/server.json`（要求顶层 `pid` == 该候选 ∧ 活 ∧ `services[].name=="web"` ∧ `up` 为真）；两者取不到 ⇒ 记成因、**继续下一候选**。载体只用于**派生地址**，判定仍是外部 HTTP GET（硬规则 4b）；只取 `name=="web"`（⛔ 不取 control —— 同 pid 不同端口）。

**⚠️ 超出 Plan 字面的一处改动（如实登记）**：Plan 3 写「只有派生块与『为什么改』变化」，但 AC4 要求真实 fail 时 stderr 对**每个**候选给出 `pid` + 派生地址 + 成因。原判据的失败发射是裸 `echo "CAUSE=…" >&2; exit 1`（**不带 pid**），只有零候选的 `no-running-serve-instance` 才「恰好」满足 AC4 —— 那是**空洞满足**（硬规则 4 推论三的形态）。⇒ 把**失败发射**改走正本块自带的 `fail()`（`CAUSE=` 仍单行，另加 `CANDIDATES:` 逐候选行；这正是 AC-288 同族已落地的形态）。**每个 cause token 逐字保留、断言作用域与 `expect` 一字未动**（AC5 的钉死项全部不变），强度只增不减。

**正负两向读数**（未跟踪 scratch `/data/home/yale/work/quay/.quay/ac299-criterion-reanchor/`，下一轮可独立复算）：

- **AC1**（`ac1-derived-addr.txt` / `ac1-en-zh-readings.txt`）：修订前 md5 `4b43b2403476a121ffb9befe4652f80d`（3067 B）；修订后 `a66e795424c2dd3145720daa2f16a0a3`（5684 B；取法 = `goal show AC-299 --json` 的 `.criterion` 逐字落盘后 `md5sum`）。`goal gate AC-299 --dry-run --json` ⇒ `verdict:"pass"`、`GATE_EXIT=0`。派生地址 = **当次**载体 `web` 的 `127.0.0.1:16377`（载体 `pid=850862, host=0.0.0.0, port=16377`；`SRC=carrier`）—— ⛔ 不是 0。`/sessions` 响应体直读：en `<html lang="en"`、nav 区块 `Sessions`=2、`会话`=0、本页 `<title>=quay — Sessions — session observation`；zh `<html lang="zh"`、nav `Sessions`=0、`会话`=2、本页 `<title>=quay — 会话 — 会话观测`。
- **AC2（两向都贴；`ac2-ac4-controls.txt`）**：(a) **无活候选** —— 全新 `git init` root + 判据作为**文件**运行（runner 自身 `sh` 的 argv 不含 pgrep 模式）⇒ `exit 1`，`CAUSE=no-running-serve-instance …` + `CANDIDATES: none -- pgrep -f 'quay.ts serve' x cwd=… matched no process`；(a′) worktree root（候选在场但无一条可派生地址）⇒ `exit 1`，`CAUSE=no-derivable-address …` + `CANDIDATES: | pid=2882683 addr=- cause=argv-no-serve,carrier-absent`；(b) **派生地址指向真死端口**（kernel 刚交出又释放的 `23575`）⇒ `exit 1`，`CAUSE=en-fetch-failed -- GET http://127.0.0.1:23575/sessions returned nothing (addr=127.0.0.1:23575)`。(a)/(a′) 与 (b) **成因不同形**。
- **AC3**（`ac3-non-literal.txt`）：`grep -c "14037\|172\.28\.0\.1" goals/AC-299-*.md` ⇒ **0**（`grep` exit 1 = 无命中）；**配套正控制**：同一谓词对**已知为真**的样本（本任务体，含 `172.28.0.1:14037`）⇒ **8**，并贴出前 3 条实际命中行 ⇒ 谓词不是恒零（硬规则 2 下半）。
- **AC4**：上面 (b) 是真实 fail，stderr 逐候选给出 `pid=2883104 addr=127.0.0.1:23575 cause=derived-from-argv` **与** `pid=2886341 addr=- cause=argv-no-serve,carrier-absent` —— ⛔ 无 `addr=` 空、无无成因裸失败；(a′) 同形给出 `pid` + `addr=-` + `cause`。
- **AC5**（`ac5-revision.txt`）：字段级 diff 仅 `criterion` 变；`expect` / `title` / `origin` / `status` / `statusLog` / `fidelity` / `activatedAt` 逐字 SAME；`ROUTE` / `LABEL_EN` 与 chrome 作用域取法逐字不变。写入面提交：worktree `b5124cb3d`（criterion）、`0621e78cf`（夹具）；主检出 `9dab0f92a`（criterion）。**新指纹 `2b77f04132787585`**（旧 `4043d01f90aa9a56`）的独立台账行：`2026-09-23T16:18:41.926Z actor=goal-amend verdict=pass criterionHash=2b77f04132787585` —— 由 `env -u QUAY_GOAL_ACCEPTANCE_ACTIVE … goal check --stale-pass --sweep --budget 1` 对**活生产实例**真跑产出（`sweep.ran[0]={id:AC-299,verdict:pass,ms:466}`）。
- **AC6**（`ac6-stale-pass.txt`）：`criterion-failure-attribution-check.ts` ⇒ `PASS: … inDomain=155 bareAcs=0 ≤ baseline 0`，`exit 0`；`goal check --stale-pass` 的 `failing` = **6** 条（`AC-179, AC-255, AC-289, AC-296, AC-298, AC-302`，均为**既存** stale 家族，⛔ 不在本任务 Touches 内），**AC-299 不在内**。修订前 AC-299 在该集合内；修订后进入 `amendedUnverified`，sweep 后该集合已空。
- **AC7**（`ac7-scoped-gate.txt`）：`bash <worktree>/scripts/test.sh --for-task gap-ac299-criterion-cmdline-port-literal-stale --allow-thin` ⇒ `exit 0`（夹具 12 例全绿）。scoped-gate 缓存已写（`developSha=353fa7e791be6616bf9520609f377a9b959416da`）。

**夹具** `packages/quay/test/ac299-criterion-address-derivation.test.mjs`（`// @test-group product`，12 例全绿）：**不是**派生逻辑的副本 —— 按 marker 从 `goals/AC-299-*.md` **逐字抽取** criterion 的 `addr-derivation` 块（单一正本关系），在 `git init` 过的临时 root 里对**真实进程**与真实载体跑正/负两向：显式端口 / `--port 0` + 载体 / 通配 host 归一化 / 无载体 / 载体 pid 不符 / 无 `web` 条目 / `web.up:false` / 载体 pid 已死 / runner 自身 `sh` 候选的归因 / 死端口的 `en-fetch-failed`；另加一例钉死「块是 route-agnostic、`ROUTE`/`LABEL_EN` 在块外」（同族复用契约）。同族夹具 `packages/quay/test/ac288-criterion-address-derivation.test.mjs` 在执行当轮**存在于同族任务分支**（`ae3edb47c`，⛔ 未落 develop/author）⇒ 已按盘上实际内容**照其形态**写本 AC 的同族文件（⛔ 非假定）。

**DoD 一处如实登记**：DoD 写「`goal check --stale-pass` ⇒ `exit 0`」，但该命令的退出码由**全体** frozen AC 共同决定；此刻仍有 6 条**既存** stale 家族 AC 在 `failing`，故**进程退出码为 1**。**AC6 的可满足项（AC-299 不在 `failing` 内）已达成**；把别人的判据改绿不在本任务范围内（⛔ 越界 + 硬规则 12）。同族先例 `gap-ac288-…` 的落地读数同形。