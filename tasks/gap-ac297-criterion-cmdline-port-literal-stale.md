---
id: gap-ac297-criterion-cmdline-port-literal-stale
title: AC-297 判据从 cmdline 的 `--port` 字面量派生地址，而生产启动器默认已是 `--port 0`（内核分配临时端口）⇒
  判据在真实部署上结构性失效（addr=172.28.0.1:0，curl 失败）；机制本身为真（实测 /git-history 四条断言全过）——
  重锚地址派生那一步（照搬 AC-288 已落地的同族形态，同一行）
status: todo
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-297
---
**type:** execution

## Proposal

**缺口（立案当轮直接量，2026-09-23T09:19:23Z，cwd = 主检出 `/data/home/yale/work/quay`）**

```
node packages/quay/bin/quay.js goal gate AC-297 --dry-run --json
⇒ {"id":"AC-297","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=en-fetch-failed -- GET http://172.28.0.1:0/git-history returned nothing (addr=172.28.0.1:0)",
   "timestamp":"2026-09-23T09:19:23.171Z","dryRun":true}
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
curl -sf --max-time 10                      http://172.28.0.1:14037/git-history  → 523694 bytes
curl -sf --max-time 10 -H 'Cookie: lang=zh' http://172.28.0.1:14037/git-history  → 522964 bytes
```

| 断言（criterion 自己的 chrome 作用域取法：`tr '\n' ' '` 后 `grep -o '<nav.*</nav>'` / `grep -oE '<title>[^<]*</title>'`） | en | zh |
|---|---|---|
| `<html lang=…>` | `<html lang="en"` | `<html lang="zh"` |
| nav 区块字面量 `Git History` | 2 | 0 |
| （对照）nav 区块 `Git 历史` | 0 | 2 |
| 本页自己的 `<title>` | `quay — Git history — vertical commit timeline` | `quay — Git 历史 — 提交纵向时间轴` |
| （硬规则 3：给条数，不给单一布尔）整段响应里 `Git History` 残留 | 2 | 0 |

⇒ criterion 的四条独立断言臂（en nav 基线在场、zh 响应 `<html lang="zh">`、zh nav 无 `Git History`、本页 `<title>` 相对 en 变化）**都在活服务上为真**；**fail 只发生在派生地址那一步**，且它以具名 `CAUSE=en-fetch-failed` 报出（硬规则 3b：判据没有伪装成通过）。

**台账：判据随「哪一代 serve 在跑」翻转，不是随页面**（硬规则 3：给条数）：

```
grep '"item_id":"AC-297"' .quay/gate-events.jsonl | grep -o '"verdict":"[a-z]*"' | sort | uniq -c
⇒ 36 pass / 50 fail
末次 pass 2026-09-23T05:20:52.430Z（goal-sweep）
其后  08:43:46Z / 08:57:35Z / 09:18:31Z  fail  CAUSE=en-fetch-failed addr=172.28.0.1:0（--port 0 实例起来之后）
全部 pass 事件带同一 criterionHash bbace9c25e47832d ⇒ 判据文本从未变过，翻转纯属部署形态
```

**⛔ 本任务不是「上一次修复没保住」**：`gap-ac297-git-history-page-zh-chrome-nav-current-and-own-title`（**done**）修好的 `/git-history` zh 接线，本轮四条断言逐条实测仍为真（上表）。AC 变假是**承载体位移**：`ce0f47518`（`gap-serve-same-root-admission-lock`，done）把 web 端口默认改成内核分配（`--port 0`），真实端口只存在于活宿主载体 `.quay/server.json` 的 `web` 条目里；判据仍解析 cmdline 字面量 ⇒ 在任何使用该默认的部署上结构性失效，与页面实现无关。⇒ 修的是**判据的派生那一步**，不是回退产品。

**同族已落地的正本形态（本任务照搬，⛔ 不另造第二套）**：`gap-ac288-criterion-cmdline-port-literal-stale` 已把 AC-288 的 criterion 重锚为一个带 marker 的可复用块——`# >>> addr-derivation`（块首注释写明「run verbatim by `packages/quay/test/ac288-criterion-address-derivation.test.mjs`」，`goals/AC-288-*.md` 第 8–88 行），该版 criterion 实测 `quay goal gate AC-288` ⇒ `exit 0`（新指纹 `23c1927ab51c48b3`）。本任务让 AC-297 采用**同一块**（route `/git-history` / label `Git History` 在块外，各自保留）。⚠️ 块首注释里那句 fixture 自指需要随落点改（AC-297 的抽取夹具不是 ac288 那份）——执行时按块内语义逐字保留、只把自指路径改成实际落在的夹具名，并在 diff 里显式标出这一行。

<!-- dedup-ref -->
去重（按机制，⛔ 不按症状关键词）：`grep -rn '^goal_ac: AC-297' tasks/*.md` ⇒ **1 命中** = `gap-ac297-git-history-page-zh-chrome-nav-current-and-own-title`，`status: done` ⇒ 不是重复（重复只算 in-flight）；本 AC 无在飞主。同机制、不同 AC 的在飞任务：`gap-ac179-criterion-cmdline-port-literal-stale`（ready）、`gap-ac291/292/293/294/295/296-criterion-cmdline-port-literal-stale`（ready/todo）——各自重锚自己那一份 goal 文件，互不覆盖。本 AC 是同族里尚未立案的一格（AC-288 的落地记录把 `AC-179 与 AC-289…AC-303` 点名为同族复用面；AC-297 在其中）。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-297 --dry-run --json` ⇒ `verdict: fail` 且 `addr=172.28.0.1:0`；同一时刻 `cat .quay/server.json` 取 `name=="web"` 的端口读数，**两者必须指向同一 pid**。
2. **取正本块，⛔ 不另造**：从 `goals/AC-288-*.md` 抽出 `# >>> addr-derivation` … `# <<< addr-derivation` 块用于 AC-297（正本 reader = `packages/quay/src/server-state.ts` 的 `readServerState` / `ServerServiceEntry` / `pidAlive` / `probeAddress`）；⛔ 不把本机当前端口/主机写成字面量。块首 fixture 自指那行按实际落点改名（见 Proposal 末段）。
3. **重锚**：`quay goal write AC-297 --criterion "$(cat <新 criterion 文件>)"` 落库（贴逐字 diff：只有派生块与「为什么改」变化），`expect` 与 chrome 作用域语义逐字不变；⛔ 不得直接 `Edit` goal 文件。
4. **配套夹具** `packages/quay/test/ac297-criterion-address-derivation.test.mjs`（`// @test-group product`，`node:test`）：按 marker 从 `goals/AC-297-*.md` **逐字抽取**派生块（单一正本关系，⛔ 不是逻辑副本），在 `git init` 过的临时 root 里对真实进程与真实载体跑正/负两向（显式端口 / `--port 0` + 载体 / 通配 host 归一化 / 无载体 / 载体 pid 不符 / 无 `web` 条目 / `web.up:false` / 死端口）。
5. **两个负控制**（硬规则 4 推论三：判据必须能取假）：① 无实例 ⇒ 非 0 且以具名成因（`no-derivable-address`）可区分；② 候选地址指向必然连不上的端口 ⇒ 非 0 且成因与 ① **不同形**（`connection refused`）。⛔ 不得靠改 `expect` 或放宽断言来「凑绿」。
6. **落账**：`node packages/quay/bin/quay.js goal gate AC-297` ⇒ exit 0，且台账新增一条 `verdict:"pass"`，其 `payload.criterionHash` **≠ 修订前指纹 `bbace9c25e47832d`**。

## AC

- [ ] **AC1（承载体已重锚且不减强度）**：`goals/AC-297-*.md` 的 criterion 不再解析 `--port [0-9]+` 字面量派生地址，改用 AC-288 已落地的 `# >>> addr-derivation` 块（`--port N`（N≥1）⇒ 该候选自己的 argv；否则 `.quay/server.json` 中 `pid` 相符 ∧ `kill -0` 活 ∧ `name=="web"` ∧ `up` 为真 ⇒ `host:port`；两者皆取不到 ⇒ 记该候选成因、**继续下一候选**，⛔ 不清空已派生地址、⛔ 不放弃后续候选）；`expect` 与 chrome 作用域语义（导航只匹配 `<nav>…</nav>`、标题只匹配 `<title>`，⛔ 不对整段响应体做子串匹配）逐字不变（贴 `git diff`，只有派生块与「为什么改」变化）。⛔ 除非经 `quay goal write` 落库否则不算。
- [ ] **AC2（判据能取假 —— 两个负控制）**：① 该 root 无运行实例时 `quay goal gate AC-297` 非 0 且以具名 `CAUSE=no-derivable-address`（或其同族具名成因）可区分；② 候选地址指向必然连不上的端口时非 0 且成因与 ① **不同形**（如 `connection refused`）。两条均贴退出码与逐字 stderr。
- [ ] **AC3（正控制：修订后在活实例上为真）**：`node packages/quay/bin/quay.js goal gate AC-297` ⇒ **exit 0**，逐字贴出；且同一时刻四条断言各自独立可核（en nav `Git History` 计数 / zh 响应含 `<html lang="zh">` / zh nav `Git History` 计数 = 0 / zh 本页 `<title>` ≠ en `<title>`），并贴出 zh 响应里 `Git History` 的残留条数（硬规则 3：给条数）。
- [ ] **AC4（地址覆盖两种部署形态，非字面量）**：对显式端口实例与 `--port 0` 实例（或用两种 cmdline 的夹具）各断言派生地址正确；**重启**生产 serve（内核分配**另一个**端口）后同一份 criterion 文本仍 `exit 0`、派生端口随载体变化（贴两次端口值 + 两次 exit）。⛔ 不把本机当前端口写进任何被提交的文件。⚠️ 重启前按负面记忆：**永不 `pkill -f` 匹配 `quay.ts serve` 的模式**（会连带杀掉自己的 shell 包装与生产实例）——解析出 pid 再按号杀，并用同一命令行重启、端口从载体重读。
- [ ] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac297-criterion-cmdline-port-literal-stale` 绿；② 作用域举证：`grep -rlF "grep -oE -- '--host [^ ]+ --port [0-9]+'" goals/` **逐文件**贴出并与立案基线对照（**立案基线 16**，含 AC-297；AC-288 已于本族先行重锚、不在基线内）：本任务后 **AC-297 那一条 1→0**，其余 **15 个文件不受本条影响**。⛔ 同族在飞任务若已落地，本条判据是**逐文件差量**，不是绝对值。
- [ ] **AC6（新指纹落账）**：台账 `.quay/gate-events.jsonl` 中 `item_id=AC-297` 的最后一条为 `verdict:"pass"`，且其 `payload.criterionHash` ≠ `bbace9c25e47832d`（贴两行）。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是 **一条真实的、在活服务上为真的判据落了账**：

1. **落地对象**：`goals/AC-297-*.md` 的 criterion 经 `quay goal write` 落库（⛔ 非手工 Edit），且 `quay goal gate AC-297` 在**运行中的** `quay.ts serve`（cwd = 仓库根）上返回 exit 0；重锚版落在 **develop**（`git show develop:goals/AC-297-*.md` 可见新派生块）。
2. **台账**：`.quay/gate-events.jsonl` 出现 `item_id=AC-297` / `gate=goal` / `verdict=pass` 的新事件，其 `criterionHash` ≠ `bbace9c25e47832d` —— 一条 dry-run 输出**不算**。
3. **负控制留痕**：两个负控制（无实例 / 连不上的端口）的退出码与 `CAUSE=` 逐字留存，证明判据不是恒真（硬规则 4 推论三）。
4. **家族差量**：AC5 的逐文件计数表贴出，证明本次作用域**只有 AC-297 那一格**发生变化。
5. **⛔ 三种「凑绿」明令禁止**：改 `expect` 语义、把端口写死回固定值、把 `/git-history` 的判据放宽成整段响应体子串匹配（`origin` 明写这是 chrome 作用域断言）。
6. **不越界**：AC-179 与 AC-298…AC-303 的同一行派生**不在本任务 Touches 内**；若执行者选择一并重锚，须把对应 `goals/AC-*.md` 加进 Touches 并对每条逐条实测前后读数（⛔ 不得批量改未测量的判据）。
7. 本任务自身 `done` 并随 fan-in 落地。

## Touches

- `goals/AC-297-git-history-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md`
- `packages/quay/test/ac297-criterion-address-derivation.test.mjs` (new)
- `tasks/gap-ac297-criterion-cmdline-port-literal-stale.md`

（说明：第一条是本任务的落地面——criterion 的地址派生那一步，经 `quay goal write AC-297 --criterion …` 落库，`expect` 与正文语义逐字不变、只补「为什么改」；第二条是配套夹具（按 marker 从 goal 文件逐字抽取派生块，与 `packages/quay/test/ac288-criterion-address-derivation.test.mjs` 同族、页面各一）；第三条是 self-touch。⛔ 不新增 `plugin/scripts/*.ts` —— 派生助手若要抽出，默认放 `packages/quay/src/`；若最终落在 `plugin/scripts/`，必须同时把 outline、`plugin/scripts/capability-catalog-declarations.json` 与本任务 Touches 一并更新。⛔ `packages/quay/src/serve-git.ts` / `serve-i18n.ts` **不在本 Touches 内** —— 它们已被本 AC 的 done 任务修好且本轮实测为真。）
