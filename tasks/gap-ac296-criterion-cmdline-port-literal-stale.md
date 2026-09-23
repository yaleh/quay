---
id: gap-ac296-criterion-cmdline-port-literal-stale
title: AC-296 判据从 cmdline 的 `--port` 字面量派生地址，而生产启动器默认已是 `--port 0`（内核分配临时端口）⇒
  判据在真实部署上结构性失效（addr=172.28.0.1:0，curl 失败）；机制本身为真（实测 /journal 四条断言全过）——
  重锚地址派生那一步（照搬 AC-288 已落地的同族形态，同一行）
status: ready
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-296
---
**type:** execution

## Proposal

**缺口（立案当轮直接量，2026-09-23T09:08:44.887Z，cwd = 主检出 `/data/home/yale/work/quay`）**

```
node packages/quay/bin/quay.js goal gate AC-296 --dry-run --json
⇒ {"id":"AC-296","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=en-fetch-failed -- GET http://172.28.0.1:0/journal returned nothing (addr=172.28.0.1:0)",
   "timestamp":"2026-09-23T09:08:44.887Z","dryRun":true}
GATE_EXIT=1
```

**成因不是「机制坏了」—— 是判据派生地址的那一步解析了一个启动器已按设计置 0 的字面量。**

同一进程、同一时刻的三个读数（立案轮实测，⛔ 非转述）：

| 面 | 读数 | 取法 |
|---|---|---|
| 生产实例 | pid `3121749`，cwd = `/data/home/yale/work/quay`，cmdline `node --experimental-strip-types packages/quay/bin/quay.ts serve --host 172.28.0.1 --port 0` | `readlink /proc/3121749/cwd` + `tr '\0' ' ' < /proc/3121749/cmdline` |
| 判据按 cmdline 派生的地址 | `172.28.0.1:0` ⇒ `curl -sf --max-time 10` 失败 ⇒ `CAUSE=en-fetch-failed` | criterion 里 `grep -oE -- '--host [^ ]+ --port [0-9]+'` 那一步 |
| 同一进程的**真实**监听地址（活宿主载体） | `name=="web"` ⇒ `172.28.0.1:14037`（另有 `control 127.0.0.1:26533`，**同 pid 不同端口**，取错会打到控制面） | `cat .quay/server.json` |

**机制本身为真（同一轮，用真实端口直读响应体；⛔ 不是 grep 源码）**：

```
curl -sf --max-time 10                      http://172.28.0.1:14037/journal  → 68742 bytes
curl -sf --max-time 10 -H 'Cookie: lang=zh' http://172.28.0.1:14037/journal  → 68708 bytes
```

| 断言（criterion 自己的 chrome 作用域取法：`tr '\n' ' '` 后 `grep -o '<nav.*</nav>'` / `grep -oE '<title>[^<]*</title>'`） | en | zh |
|---|---|---|
| `<html lang=…>` | `<html lang="en"` | `<html lang="zh"` |
| nav 区块字面量 `Journal` | 2 | 0 |
| （对照）nav 区块 `日志` | 0 | 2 |
| 本页自己的 `<title>` | `quay — Journal — recent loop record` | `quay — 日志 — 循环最近记录` |
| （硬规则 3：给条数，不给单一布尔）整段响应里 `Journal` 残留 | 4 | 0 |

⇒ criterion 的四条独立断言臂（en 基线在场、zh 响应 `<html lang="zh">`、zh nav 无 `Journal`、本页 `<title>` 相对 en 变化）**都在活服务上为真**；**fail 只发生在派生地址那一步**，且它以具名 `CAUSE=en-fetch-failed` 报出（硬规则 3b：判据没有伪装成通过）。

**台账：判据随「哪一代 serve 在跑」翻转，不是随页面**（硬规则 3：给条数）：

```
grep '"item_id":"AC-296"' .quay/gate-events.jsonl | grep -o '"verdict":"[a-z]*"' | sort | uniq -c
⇒ 36 pass / 50 fail
末次 pass 2026-09-23T05:20:51.905Z（goal-sweep）
其后  08:36:03Z / 08:36:28Z  fail  CAUSE=no-running-serve-instance（当刻该 root 无 serve）
      08:43:45Z / 08:57:34Z  fail  CAUSE=en-fetch-failed addr=172.28.0.1:0（--port 0 实例起来之后）
全部 pass 事件带同一 criterionHash 5f7c1821d4513af2 ⇒ 判据文本从未变过，翻转纯属部署形态
```

**⛔ 本任务不是「上一次修复没保住」**：`gap-ac296-journal-page-zh-chrome-nav-current-and-own-title`（**done**）修好的 `/journal` zh 接线，本轮四条断言逐条实测仍为真（上表）。AC 变假是**承载体位移**：`ce0f47518`（`gap-serve-same-root-admission-lock`，done）把 web 端口默认改成内核分配（`--port 0`），真实端口只存在于活宿主载体 `.quay/server.json` 的 `web` 条目里；判据仍解析 cmdline 字面量 ⇒ 在任何使用该默认的部署上结构性失效，与页面实现无关。⇒ 修的是**判据的派生那一步**，不是回退产品。

**同族已落地的正本形态（本任务照搬，⛔ 不另造第二套）**：`gap-ac288-criterion-cmdline-port-literal-stale` 已把 AC-288 的 criterion 重锚为一个带 marker 的可复用块——`# >>> addr-derivation`（块首注释写明「run verbatim by `packages/quay/test/ac288-criterion-address-derivation.test.mjs`」），该版 criterion 本轮实测 `quay goal gate AC-288` ⇒ `exit 0`（新指纹 `23c1927ab51c48b3`）。本任务让 AC-296 采用**同一块逐字**（route / label 在块外，各自保留）。

<!-- dedup-ref -->
去重（按机制，⛔ 不按症状关键词）：`grep -rn '^goal_ac: AC-296' tasks/*.md` ⇒ **1 命中** = `gap-ac296-journal-page-zh-chrome-nav-current-and-own-title`，`status: done` ⇒ 不是重复（重复只算 in-flight）；本 AC 无在飞主。同机制、不同 AC 的在飞任务：`gap-ac179-criterion-cmdline-port-literal-stale`（ready）、`gap-ac288`…`gap-ac295-criterion-cmdline-port-literal-stale`（ready/todo）——各自重锚自己那一份 goal 文件，互不覆盖。本 AC 是同族里尚未立案的一格；AC-297…AC-303 是同族后续格。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-296 --dry-run --json` ⇒ `verdict: fail` 且 `addr=172.28.0.1:0`；同一时刻 `cat .quay/server.json` 取 `name=="web"` 的端口读数，**两者必须指向同一 pid**。
2. **取正本块，⛔ 不另造**：从 `goals/AC-288-*.md` 抽出 `# >>> addr-derivation` 块逐字用于 AC-296（正本 reader = `packages/quay/src/server-state.ts` 的 `readServerState` / `ServerServiceEntry` / `pidAlive` / `probeAddress`）；⛔ 不把本机当前端口/主机写成字面量。
3. **重锚**：`quay goal write AC-296 --criterion "$(cat <新 criterion 文件>)"` 落库（贴逐字 diff：只有派生块与「为什么改」变化），`expect` 与 chrome 作用域语义逐字不变；⛔ 不得直接 `Edit` goal 文件。
4. **配套夹具** `packages/quay/test/ac296-criterion-address-derivation.test.mjs`（`// @test-group product`，`node:test`）：按 marker 从 `goals/AC-296-*.md` **逐字抽取**派生块（单一正本关系，⛔ 不是逻辑副本），在 `git init` 过的临时 root 里对真实进程与真实载体跑正/负两向（显式端口 / `--port 0` + 载体 / 通配 host 归一化 / 无载体 / 载体 pid 不符 / 无 `web` 条目 / `web.up:false` / 死端口）。
5. **两个负控制**（硬规则 4 推论三：判据必须能取假）：① 无实例 ⇒ 非 0 且以具名成因可区分；② 候选地址指向必然连不上的端口 ⇒ 非 0 且成因可区分。⛔ 不得靠改 `expect` 或放宽断言来「凑绿」。
6. **落账**：`node packages/quay/bin/quay.js goal gate AC-296` ⇒ exit 0，且台账新增一条 `verdict:"pass"`，其 `payload.criterionHash` **≠ 修订前指纹 `5f7c1821d4513af2`**。

## AC

- [x] **AC1（承载体已重锚且不减强度）**：`goals/AC-296-*.md` 的 criterion 不再解析 `--port [0-9]+` 字面量派生地址，改用 AC-288 已落地的 `# >>> addr-derivation` 块（`--port N`（N≥1）⇒ 该候选自己的 argv；否则 `.quay/server.json` 中 `pid` 相符 ∧ `kill -0` 活 ∧ `name=="web"` ∧ `up` 为真 ⇒ `host:port`；两者皆取不到 ⇒ 记该候选成因、**继续下一候选**，⛔ 不清空已派生地址、⛔ 不放弃后续候选）；`expect` 与 chrome 作用域语义（导航只匹配 `<nav>…</nav>`、标题只匹配 `<title>`，⛔ 不对整段响应体做子串匹配）逐字不变（贴 `git diff`，只有派生块与「为什么改」变化）。⛔ 除非经 `quay goal write` 落库否则不算。
- [x] **AC2（判据能取假 —— 两个负控制）**：① 该 root 无运行实例时 `quay goal gate AC-296` 非 0 且以具名 `CAUSE=`（如 `no-derivable-address`）可区分；② 候选地址指向必然连不上的端口时非 0 且成因与 ① **不同形**（如 `connection refused`）。两条均贴退出码与逐字 stderr。
- [x] **AC3（正控制：修订后在活实例上为真）**：`node packages/quay/bin/quay.js goal gate AC-296` ⇒ **exit 0**，逐字贴出；且同一时刻四条断言各自独立可核（en nav `Journal` 计数 / zh 响应含 `<html lang="zh">` / zh nav `Journal` 计数 = 0 / zh 本页 `<title>` ≠ en `<title>`），并贴出 zh 响应里 `Journal` 的残留条数（硬规则 3：给条数）。
- [x] **AC4（地址覆盖两种部署形态，非字面量）**：对显式端口实例与 `--port 0` 实例（或用两种 cmdline 的夹具）各断言派生地址正确；**重启**生产 serve（内核分配**另一个**端口）后同一份 criterion 文本仍 `exit 0`、派生端口随载体变化（贴两次端口值 + 两次 exit）。⛔ 不把本机当前端口写进任何被提交的文件。
- [x] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac296-criterion-cmdline-port-literal-stale` 绿；② 作用域举证：`grep -rlF "grep -oE -- '--host [^ ]+ --port [0-9]+'" goals/` **逐文件**贴出并与立案基线对照（**立案基线 16**，含 AC-296；AC-288 已于本族先行重锚、不在基线内）：本任务后 **AC-296 那一条 1→0**，其余 **15 个文件不受本条影响**。⛔ 同族在飞任务若已落地，本条判据是**逐文件差量**，不是绝对值。
- [x] **AC6（新指纹落账）**：台账 `.quay/gate-events.jsonl` 中 `item_id=AC-296` 的最后一条为 `verdict:"pass"`，且其 `payload.criterionHash` ≠ `5f7c1821d4513af2`（贴两行）。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是 **一条真实的、在活服务上为真的判据落了账**：

1. **落地对象**：`goals/AC-296-*.md` 的 criterion 经 `quay goal write` 落库（⛔ 非手工 Edit），且 `quay goal gate AC-296` 在**运行中的** `quay.ts serve`（cwd = 仓库根）上返回 exit 0；重锚版落在 **develop**（`git show develop:goals/AC-296-*.md` 可见新派生块）。
2. **台账**：`.quay/gate-events.jsonl` 出现 `item_id=AC-296` / `gate=goal` / `verdict=pass` 的新事件，其 `criterionHash` ≠ `5f7c1821d4513af2` —— 一条 dry-run 输出**不算**。
3. **负控制留痕**：两个负控制（无实例 / 连不上的端口）的退出码与 `CAUSE=` 逐字留存，证明判据不是恒真（硬规则 4 推论三）。
4. **家族差量**：AC5 的逐文件计数表贴出，证明本次作用域**只有 AC-296 那一格**发生变化。
5. **⛔ 三种「凑绿」明令禁止**：改 `expect` 语义、把端口写死回固定值、把 `/journal` 的判据放宽成整段响应体子串匹配（`origin` 明写这是 chrome 作用域断言）。
6. **不越界**：AC-179 与 AC-297…AC-303 的同一行派生**不在本任务 Touches 内**；若执行者选择一并重锚，须把对应 `goals/AC-*.md` 加进 Touches 并对每条逐条实测前后读数（⛔ 不得批量改未测量的判据）。
7. 本任务自身 `done` 并随 fan-in 落地。

## Touches

- `goals/AC-296-journal-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md`
- `packages/quay/test/ac296-criterion-address-derivation.test.mjs` (new)
- `tasks/gap-ac296-criterion-cmdline-port-literal-stale.md`

（说明：第一条是本任务的落地面——criterion 的地址派生那一步，经 `quay goal write AC-296 --criterion …` 落库，`expect` 与正文语义逐字不变、只补「为什么改」；第二条是配套夹具（按 marker 从 goal 文件逐字抽取派生块，与 `packages/quay/test/ac288-criterion-address-derivation.test.mjs` 同族、页面各一）；第三条是 self-touch。⛔ 不新增 `plugin/scripts/*.ts` —— 派生助手若要抽出，默认放 `packages/quay/src/`；若最终落在 `plugin/scripts/`，必须同时把 outline、`plugin/scripts/capability-catalog-declarations.json` 与本任务 Touches 一并更新。⛔ `packages/quay/src/serve-i18n.ts` / `serve-live.ts` **不在本 Touches 内** —— 它们已被本 AC 的 done 任务修好且本轮实测为真。）

## 执行记录（落地读数 / 修法 / 为什么改）

**为什么改**：`ce0f47518`（`gap-serve-same-root-admission-lock`，done）把 web 端口默认改成内核分配（`--port 0`），而派生那一步解析的是 cmdline 里的**字面量** `--port N` ⇒ 在任何使用该默认的部署上恒得 `<host>:0`，结构性不可 fetch，本 AC 恒假。机制本身从未坏：本轮在**当次**载体 `web` 的真实地址上四条断言逐条为真（下表）。坏的只是**判据的承载体**（地址派生那一步）。

**修法（只重锚派生那一步）**：逐字取用 `goals/AC-288-*.md` 的 `# >>> addr-derivation` … `# <<< addr-derivation` 块（同一行、同族形态；仅把 marker 注释里的夹具路径 `ac288`→`ac296`，与 AC-299 同款），`ROUTE="/journal"` / `LABEL_EN="Journal"` 两行留在块外逐字不变。候选仍由 `pgrep -f 'quay.ts serve'` × `/proc/<pid>/cwd == $root` 产生；每个候选先读**它自己的 argv**（NUL 分隔、**按位置**判 `serve … --host H --port N`，N ≥ 1），否则读 `$root/.quay/server.json`（要求顶层 `pid` == 该候选 ∧ `kill -0` 活 ∧ `services[].name=="web"` ∧ `up` 为真）；两者取不到 ⇒ 记该候选成因、**继续下一候选**（⛔ 不清空已派生地址、⛔ 不放弃后续候选）。载体只用于**派生地址**，判定仍是外部 HTTP GET（硬规则 4b）。

**⛔ 一处刻意与 AC-299 同族不同的选择（如实登记）**：AC-299 的落地把 fetch 半段的失败发射也换成了块自带的 `fail()`（为满足它自己的 AC4「逐候选归因」）。本任务 **AC1 逐字钉死「只有派生块与『为什么改』变化」**，而本任务没有任何一条 AC 要求 fetch 半段给出候选归因 —— fetch 半段原有的 `echo "CAUSE=…" >&2; exit 1` **每一条都带具名成因**（硬规则 3b 已满足，无洞要补）⇒ **fetch 半段逐字保留**，`expect` 与 chrome 作用域取法一字未动。强度只增不减：`--port [0-9]+` 字面量解析 **1→0**，两条负控制的成因**不同形**（见 AC2）。

**正负两向读数**（可被下一轮独立复算）：

- **AC1**（`git diff` 逐字段）：改动**只经 `quay goal write AC-296 --criterion …` 落库**（⛔ 未 `Edit` goal 文件）。`git diff` 的两个提交面：worktree `f93e936ec`（`goals: AC-296 field:criterion by cli:518826`，1 file changed, 79 insertions(+), 11 deletions(-)）、主检出同一文本的第二写（两个 root 从不分叉 —— 落库后 develop 的 criterion 与 `/tmp/ac296-criterion.txt` **逐字节相同**）。字段级 diff：只有 `criterion` 变；`expect` / `origin` / `title` / `status` / `activatedAt` / `statusLog` / `fidelity` **逐字 SAME**（`git show HEAD | grep -E '^[+-]  (expect|origin|title|status):'` ⇒ 零命中）。`# >>> addr-derivation` 块体与 AC-288 的**逐字节相同**（断言 `between(newCriterion).body === block`）；`ROUTE`/`LABEL_EN` 居块外且块内无 `ROUTE=`/`LABEL_EN=`（route-agnostic，同族复用契约）。落 **develop**：`git show develop:goals/AC-296-*.md` 含 `addr-derivation`（2 处 marker）、`grep -c -- '--port \[0-9\]'` ⇒ **0**。

- **AC2（两个负控制，两向都贴；⛔ 只贴绿侧不算）**：
  - ① **该 root 无运行实例**（全新 `git init` root + `goals/AC-296-*.md` 副本，`quay goal gate AC-296 --store --root <r>`）⇒ `EXIT=1`，逐字 stderr：`CAUSE=no-derivable-address -- pgrep -f 'quay.ts serve' x cwd=/tmp/ac296-neg-wXcOBd matched candidate(s) but none yielded a live web address (an explicit --port >= 1 on the process's own argv, or this root's .quay/server.json naming that pid's web service)` + `CANDIDATES: | pid=1009634 addr=- cause=argv-no-serve,carrier-absent`。（候选非空是必然：判据自己的 `sh -c` 脚本文本含 pgrep 模式且 cwd = 该 root，它必须被**归因**而非静默丢弃；`no-running-serve-instance` 是 pgrep 一个都不命中时的更窄分支。）
  - ② **候选地址指向必然连不上的端口**（kernel 刚交出又释放的 `30389`，serve 形进程 cwd = 该 root、argv 显式 `--port 30389`）⇒ `EXIT=1`，逐字：`CAUSE=en-fetch-failed -- GET http://127.0.0.1:30389/journal returned nothing (addr=127.0.0.1:30389)`。
  - ①/② **成因不同形**（`no-derivable-address` = 派生失败；`en-fetch-failed` = 取不到）。⛔ 未改 `expect`、未放宽任何断言。

- **AC3（正控制：修订后在活实例上为真）**：`node packages/quay/bin/quay.js goal gate AC-296` ⇒ **`GATE_EXIT=0`**（`verdict=pass`，`2026-09-23T16:37:28.528Z`，随后 16:39:34Z / 16:40:31Z 两次亦 pass）。四条断言各自独立可核（同一时刻、响应体直读，⛔ 非 grep 源码）：

  | 断言 | 读数 |
  |---|---|
  | en `<html lang=…>` | `<html lang="en"` |
  | en nav 区块字面量 `Journal`（条数） | **2** |
  | zh 响应 `<html lang="zh"` 条数 | **1** |
  | zh nav 区块 `Journal` 条数 | **0**（对照：zh nav `日志` = **2**） |
  | en 本页 `<title>` | `quay — Journal — recent loop record` |
  | zh 本页 `<title>`（相对 en 变化） | `quay — 日志 — 循环最近记录` |
  | （硬规则 3：给条数）整段响应里 `Journal` 残留 | zh = **0**（en = 4） |

- **AC4（两种部署形态 + 重启后端口随载体变化，⛔ 非字面量）**：夹具对**两种 cmdline 形态**各断言派生地址正确（显式 `--port 46011` ⇒ `DERIVED_ADDR=127.0.0.1:46011 SRC=argv`；`--port 0` + 载体 ⇒ `SRC=carrier`，且**只取 `name=="web"`** —— 同 pid 的 `control` 端口 34568 必须**不被**选中）。**生产 serve 的真实重启**（经 `quay server stop --only web,control` + host `SIGTERM` + `quay server start --only web,control --host 0.0.0.0 --port 0`，内核重新分配）：端口 **#1 = `0.0.0.0:25991`（pid 4066428）⇒ exit 0**，**#2 = `0.0.0.0:10539`（pid 2035152）⇒ exit 0**，**同一份 criterion 文本**两次都过（`/health` 直读 `processStartedAt=2026-09-23T16:40:21.519Z`）。⛔ 没有任何被提交的文件里出现本机当前端口：`grep -c '25991\|10539\|172\.28\.0\.1' goals/AC-296-*.md` ⇒ **0**（`grep` exit 1 = 无命中）；**配套正控制**（硬规则 2 两半都做）：同一谓词对**已知为真**的样本（本任务体，引用了 `172.28.0.1:0` / `:14037`）⇒ **9**，并贴出前 3 条实际命中行（均为 `172.28.0.1`）⇒ 谓词不是恒零，「0」是真读数而非仪器故障。

- **AC5**：
  - ① **scoped 门**：`bash scripts/test.sh --for-task gap-ac296-criterion-cmdline-port-literal-stale --allow-thin` ⇒ **`exit 0`**（夹具 15 例全绿）。**同一命令的 bare 形态**（⛔ 未 `--allow-thin`）⇒ `exit 1`，但其原因是**选择面宽度**而非用例失败，逐字：`test-selection-thin: task gap-ac296-criterion-cmdline-port-literal-stale resolved tests for 1/3 Touches entries (0.33) < 0.5; pass --allow-thin to run anyway`（三个 Touches 条目里只有夹具一个能映射到测试；goal 文件与 self-touch 都不映射）。两向读数都贴，⛔ 不把 bare 形态的 exit 1 说成绿。scoped-gate 缓存已写（`developSha=d60b0a463291f57f919cb8e66222e734f951dd69`）。
  - ② **作用域逐文件差量**（谓词 `grep -rlF "grep -oE -- '--host [^ ]+ --port [0-9]+'" goals/`）：**本提交**（`f93e936ec`）**只改一个文件的成员资格** —— `git show --stat f93e936ec` ⇒ 1 file changed；成员集 `f93e936ec^` = **5** → `f93e936ec` = **4**（AC-296 那一条 **1→0**）。

    | 文件 | 本提交前 | 本提交后 |
    |---|---|---|
    | `goals/AC-296-journal-…-都相对英文基线发生变化.md` | 1 | **0** |
    | `goals/AC-179-web-card-and-cli.md` | 1 | 1（不受本条影响） |
    | `goals/AC-289-dashboard-…` | 1 | 1（不受本条影响） |
    | `goals/AC-298-tests-…` | 1 | 1（不受本条影响） |
    | `goals/AC-302-doc-…` | 1 | 1（不受本条影响） |

    ⚠️ **与立案基线 16 的关系**（硬规则 12b：查历史而非等下一轮）：立案轮谓词命中 **16** 个文件；此后同族任务陆续落地重锚，本任务 **fork 点（`f19df3043`）**实测只剩 **5**。⛔ 故本条判据是**逐文件差量**、不是绝对值；本任务后 merge 进 develop 的 HEAD 上该集合为 **3**（AC-298 由同族兄弟落地移除），与本案无关。

- **AC6（新指纹落账）**：台账 `.quay/gate-events.jsonl` 中 `item_id=AC-296` 的最后一条带指纹的事件为

  ```
  2026-09-23T16:37:49.475Z gate=goal actor=goal-amend verdict=pass criterionHash=b8570550cea09b7d
  ```

  **≠ 修订前指纹 `5f7c1821d4513af2`**（旧指纹在台账中仍有 **37** 条历史事件）。该指纹行由 `env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node packages/quay/bin/quay.js goal check --stale-pass --sweep --budget 1` 对**活生产实例**真跑产出（`sweep.ran[0]={id:"AC-296",verdict:"pass",reason:"acceptance passed (exit 0)",ms:202}`，修正优先级把它排在第一）；其后的两次 `goal-cli` pass（16:39:34Z / 16:40:31Z）不带指纹 —— **这正是修订前该 AC 的形态**（硬规则 3b：不带指纹的 pass 不冒充「已验证过这段文本」）。

**夹具** `packages/quay/test/ac296-criterion-address-derivation.test.mjs`（`// @test-group product`，15 例全绿）：**不是**派生逻辑的副本 —— 按 marker 从 `goals/AC-296-*.md` **逐字抽取** criterion 的 `addr-derivation` 块（单一正本关系），在 `git init` 过的临时 root 里对**真实进程**与真实载体跑正/负两向：显式端口 / `--port 0` + 载体 / **载体换端口后派生地址跟随**（AC4 的夹具半边）/ 通配 host 归一化（argv 与载体各一）/ 无载体 / 载体 pid 不符 / 无 `web` 条目 / `web.up:false` / 载体 pid 已死 / runner 自身 `sh` 候选的归因 / 死端口的 `en-fetch-failed` / 无实例的具名拒绝；另两例钉死「块是 route-agnostic、`ROUTE`/`LABEL_EN` 在块外」与「`--port [0-9]+` 字面量解析已从 shipped criterion 消失而 chrome 作用域取法仍在」。

**不越界**：AC-179、AC-289、AC-298、AC-302（以及其余同族）的判据**未被本任务触碰** —— 上表逐文件可核；AC5① 的 bare 形态读数与 ② 的差量表都按盘上当前内容取，⛔ 未批量改未测量的判据。

**一处运维副作用（如实登记）**：AC4 要求「重启生产 serve（内核分配另一个端口）」，故本轮对主检出的 serve 宿主做过一次**真实重启**（先 `quay server restart --only web` 取证 —— 面重开但端口**不变**，因为 `startWebFace()` 复用 `webBoundPort`；随后 `quay server stop --only web,control` + `SIGTERM` 宿主 + `quay server start --only web,control`），宿主 pid **4066428 → 2035152**、web 端口 **25991 → 10539**，两端口均从载体读回、两次 `/health` 均 `ok:true`。
