---
id: gap-ac214-tenth-crossing-producer-callsite-missing-init-verb
title: AC-214 第十次转红（6/7 主体 d=239/200, margin −39）：产出者的动作调用点缺 `init`
  子命令（verify-deliver-coldstart.sh:1456/:4583，e0279c77a 漏迁）⇒「重跑产出者」这一补救自
  2026-10-07 起结构性写不出记录
status: ready
labels:
  - gap
  - defect
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-214
---
## Finding

**判据此刻为假（本轮复跑，`⛔` 非引述）**：用仓库自己的 YAML 解析器（`yaml`）从 `goals/AC-214-*.md` 的 `criterion: >-` 折叠块抽出判据逐字跑（cwd = 主检出 `/data/home/yale/work/quay`）⇒ **exit 1**。stdout 逐字：

```
freshness GOAL-009-AC-201: 21/200 (margin 179)
freshness GOAL-009-AC-232: 239/200 (margin -39)
freshness GOAL-009-AC-205: 239/200 (margin -39)
freshness GOAL-009-AC-207: 239/200 (margin -39)
freshness GOAL-009-AC-203: 239/200 (margin -39)
freshness GOAL-009-AC-238: 239/200 (margin -39)
freshness GOAL-009-AC-239: 239/200 (margin -39)
```

stderr 逐字：`stale evidence: GOAL-009-AC-232:239/200 (margin -39), GOAL-009-AC-205:239/200 (margin -39), GOAL-009-AC-207:239/200 (margin -39), GOAL-009-AC-203:239/200 (margin -39), GOAL-009-AC-238:239/200 (margin -39), GOAL-009-AC-239:239/200 (margin -39)`。

⇒ **6/7 主体陈旧**；`GOAL-009-AC-201` 本轮新（`2026-10-09T03:47:03Z` / `build_sha cdbe3483c1f0`，d=21）。**这是回归而非恒红**：`.quay/gate-events.jsonl` 中 `item_id=AC-214`、`gate=goal` 的最后一条 pass = `2026-09-25T05:22:17.401Z`，其后第一条 fail = `2026-10-08T17:00:04.535Z`；fail 事件序列共 **10** 次（`2026-09-09` / `09-11` / `09-13`×2 / `09-14`×2 / `09-15` / `09-17` / `09-24` / `10-08`）⇒ 本轮是**第十次转红**。

### 根因（按位置，`⛔` 不按关键词）：产出者的【动作调用点】回归，使补救结构性写不出记录

AC-214 的**唯一补救**由 `plugin/freshness-producers.json` 声明 = 重跑产出者 `plugin/scripts/develop-deliver-tgz.sh`（`--verify-coldstart` / `--verify-upgrade`）。该脚本经 `plugin/scripts/verify-deliver-coldstart.sh` 跑远端步骤。**两个调用点把 CLI 入口 `plugin/bin/quay` 当脚本调、缺 `init` 子命令** —— 而 `bin/quay` 要求第一个位置参数是子命令，于是 `--root` 被当成未知 verb ⇒ 打印 usage ⇒ rc=1：

- `plugin/scripts/verify-deliver-coldstart.sh:1456`（`step_upgrade_existing` 的**升级动作**）：`bash "$qinit" --root "$root" --repo-root "$root" --worktree-root … --adopt-branch-model --auto-commit-skip`，而 `:1386` 把 `qinit="${npmroot}/quay/plugin/bin/quay"`。
  **实测后果**（2026-10-09T03:47 host-B 运行，`--verify-upgrade`）：远端 `upgrade action: shipped quay-init (config-preserving branch) rc=1`；`…-root/.quay-upgrade-init.log` 全文两行 usage；远端 `AC-238 record NOT written` ⇒ **AC-238/239 未刷新**（fail-closed，记录不写）。
- `plugin/scripts/verify-deliver-coldstart.sh:4583`（`step2_init` = 冷启动面 ② 段）：`bash "$qinit" --all --loop --root … --auto-commit-confirm` —— 同样缺 `init`，**且** `--all/--loop` 不是 CLI 旗标（`packages/quay/src/cli/init.ts:177` 逐字：`CLI init has no --loop flag; passing it is an error`）⇒ 远端 `STEP2_OK=0` ⇒ **冷启动面写不出 AC-203/205/207/232**。

**引入点明确（双侧可核）**：`e0279c77a`（2026-10-07 22:43，`gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch`, **done**）把 `plugin/scripts/quay-init.sh` 改成 ≤40 行 shim 并迁移 `qinit` 调用点：`:1386/:3606/:4573` 的 `qinit=` 改指 `bin/quay`，`:3782/:4279/:4285` 补成 `"$plugin_root/bin/quay" init …`（`git show e0279c77a -- plugin/scripts/verify-deliver-coldstart.sh` 逐字可见）—— **漏了 `:1456` 与 `:4583`**（硬规则 5b：缺陷成簇，兄弟实例常在同一文件甚至同一行）。该任务体自述「未实际执行…调用点已按新参数面改写并静态核对」⇒ 静态核对的正是漏掉的那两处。

### 为什么前几次修复没兜住（第十次，不是第一次）

前 9 次修复都在给「上一个读数」接消费者：补 `plugin/freshness-producers.json` + 探针（第 4 次）、把检测→立案跑起来（第 5/6 次）、把「本机不可执行」升成 `needs-human` 升级（第 7 次）、修计数规则（第 9 次）。而**补救本身**（重跑产出者）从 2026-10-07 起就**结构性写不出记录** —— 于是一次次「重跑」都停在同一步、gap 必然复发。这正是硬规则 4b/3b 的形态：**一个如实记录的失败，与「一切照旧」同形**。最新的两条 routine 立案任务（`gap-routine-freshness-refresh-stale-goal-009-ac-238-79f43e79` / `-ac-239-139c5b66`，均 done）已**真跑**产出者并把失败点定位到此处，但自述 `⛔ 未改 verify-deliver-coldstart.sh（不在 Touches）`、`⛔ 未另立修复任务` ⇒ **本任务就是那一刀**。

### 前置已全部就位（本轮实测，`⛔` 非引述 `preconditions` 散文）

- `ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men 'echo OK; date -u; df -h /'` ⇒ **rc=0**，`/dev/sda1 96G 89G 7.4G 93% /`（7.4G free）；
- `ssh … yale@ad-arm1.wan.hwang.men 'echo C-OK; hostname'` ⇒ **rc=0**，`instance-20221019-1509`；
- aged 源在 B：`~/work/meta-cc-aged-ac238-copy/.quay/runtime/bin/{quay,quay-native,quay-native.js,quay.js}` 俱在；
- B 上有一个**活**且 `--permission-mode bypassPermissions` 的会话（`ps` 逐字：`1154128 … claude --model deepseek-v4-flash-anthropic --permission-mode bypassPermissions …`）⇒ session-delivery 的活跃会话前置成立；
- 2026-10-09T11:23Z 的 scan-round 逐字 `remedyAvailability=executable`（本机 → B/C 两面 rc=0）。

⇒ 挡住补救的**不再是跨机前置**，而是**产出者所跑的那段代码**。这解释了「第九次之后仍复发」。

<!-- dedup-ref -->
**相关但不同（仅为溯源，`⛔` 不是前置、`⛔` 不是依赖）**：`tasks/gap-ac206-criterion-pinned-to-retired-quay-init-sh-goals-mkdir.md`（`todo`，`goal_ac: AC-206`）是 `e0279c77a` 的**同一爆炸半径**下的**另一处**（它修的是 AC-206 判据 check③ 钉在已退役 `quay-init.sh` 字面量上，落在 `goals/AC-206-*.md` + `plugin/test/quay-init.test.mjs`，`⛔` 不碰本任务的两个调用点）；`gap-routine-freshness-refresh-stale-goal-009-ac-238-79f43e79` 与 `-ac-239-139c5b66`（均 done）已把失败点定位到本任务的 `:1456`。本条的对象是**产出者脚本里那两个未迁移的调用点**，`⛔` 与上述任一条都不是同一机制。

## Requested action

1. **修两处调用点**（`plugin/scripts/verify-deliver-coldstart.sh`）：
   a. `:1456`：`bash "$qinit"` 之后插入 `init`（→ `bash "$qinit" init --root "$root" --repo-root "$root" --worktree-root … --adopt-branch-model --auto-commit-skip`）。所列旗标都是合法 CLI `init` 旗标（`packages/quay/src/init.ts`）。
   b. `:4583`：同样插入 `init`，并**删除** `--all --loop`（已退役 no-op，且 CLI `init` 对 `--loop` 报错）；其余旗标保留。
   c. **兄弟扫描（硬规则 5b 的产物，`⛔` 不只修被报出来的那一个）**：逐条判定 `$qinit` / `bin/quay` 的**全部**调用点（其余 3 处 `:3782/:4279/:4285` 已正确；`qrl=`/`qbin=` 是存在性/readlink 检查，不改）。
2. **用修好的代码重跑两条产出者，直到 AC-214 判据本体干跑 exit 0**（七行 margin 全正）：
   - coldstart-face（刷 AC-203/205/207/232）：`bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root <main-checkout> --driving-profiles <目标主机网关认得的 profile>`；
   - upgrade-face（刷 AC-238/239）：`bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade --upgrade-source work/meta-cc-aged-ac238-copy --ac239-e2e --hosts B --force --root <main-checkout> --driving-profiles <同上>`。
   `⚠️` `--driving-profiles` 必须是**目标主机网关认得**的模型名（本仓 `.quay/profiles.yml` 是主机专属，`⛔` 原样推送会 400）；`--upgrade-source` 是 B 上的 aged 副本（见 `plugin/freshness-producers.json` 的 `_aged_source`）。读到 `--verify-upgrade PARTIAL` 必须读成「AC-239 未刷新」（落账发生在判定之前）。
3. **加一条能取假的测试**，钉住这两个调用点是「verb-first」形态（或扩展 `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`）—— 把 `init` 拿掉即红。

**⚠️ 本轮追加发现（硬规则 5b，`⛔` 不是原计划的一部分）**：只修上面两处调用点，`--verify-upgrade` 的运行**仍写不出 AC-238**。升级动作修复后 rc=0（原为 rc=1，确证调用点就是第一处断点），但运行随即停在下一条：
`post-binding: … bound=<unread> bound_sha=<none> delivered_qn_sha=6a94c8efbcc2` / `post binding: post_binding=unreadable` ⇒ `runtime_replaced=0` ⇒ `AC-238 record NOT written`。
**第二处断点（同文件、同机制，来自另一提交）**：`76f89ce82`（`gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it`, **done**，2026-10-06）把 native provider 的 `path`/`mcp_entry` 从 config 里**删掉**（Core 改由 `<plugin-root>/vendor/quay-native` 解析），而 `verify-deliver-coldstart.sh` 里读「升级后绑定」的两处消费者（`config_native_mcp_entry` 与 `binding_state`）仍按**旧**的「config 携带 mcp_entry」语义写 ⇒ 结构性读不出。该提交未同步更新这个消费者（硬规则 5b）。⇒ 本任务一并修这两处消费者（同文件，故在 Touches 内）：`config_native_mcp_entry` 在 config 无 mcp_entry 时按 `<root>/.quay/plugin` 链接解析到 vendored bundle；`binding_state` 同时读检查器的 stdout 与 stderr（`emitVerdict` 把 NOT-EVALUATED 判定写 stderr，只读 stdout 会把「读得出但未评估」压成「读不出」，硬规则 3b），并把「无 mcp_entry + 链接可解析」判为可用绑定。`⛔` 不是放宽判据：AC-238 门仍把解析出的 bundle 的 sha256 与**交付物**比对（`RUNTIME_REPLACED` ③），链接缺失/陈旧照样 fail-closed。

## AC

- [x] AC1 改前读数（能取假，复跑 `⛔` 非引述）：用**仓库自己的 YAML 解析器**抽出 `goals/AC-214-*.md` 的 `criterion:` 折叠块逐字跑 ⇒ **exit 1**，stderr 逐字含 6 条 `GOAL-009-AC-…:239/200 (margin -39)`；贴 stdout 七行 + 每个主体最新记录的 (ts, build_sha) 表 + `.quay/productization-verification.jsonl` 行数与 `ts>=2026-10-09` 计数 + `.quay/goal-freshness-margin.json` 全文。
- [x] AC2 回归而非恒红：贴 `.quay/gate-events.jsonl` 中 `item_id=AC-214` 的最后一条 `pass`（`2026-09-25T05:22:17.401Z`）与其后第一条 `fail`（`2026-10-08T17:00:04.535Z`），以及 fail 事件总数（=10）。
- [x] AC3 根因按位置 + **双侧对照**（硬规则 4 推论四）：贴 `verify-deliver-coldstart.sh:1456` 与 `:4583` 的**改前逐字**（`bash "$qinit" …` / `bash "$qinit" --all --loop …`）与 `git show e0279c77a -- plugin/scripts/verify-deliver-coldstart.sh` 中「3 处已迁移、这 2 处漏」的逐字 hunk。对照须在**修复后、用同一 argv 形态**给出：① 改前形态（缺 `init`）⇒ usage + rc≠0；② 只加 `init`（`:4583` 还去 `--all --loop`）⇒ 越过参数解析（rc 与 usage 无关）。两次读数逐字入 `## Evidence`。
- [x] AC4 兄弟扫描（硬规则 5b 产物）：`grep -n '\$qinit\|bin/quay' plugin/scripts/verify-deliver-coldstart.sh` 的**全部**命中逐条判定，命中数与「需改 = 2」一并贴出。
- [x] AC5 真跑产出者刷新证据（硬规则 4 推论三：AC 必须读**生产载体**）：用修好的代码跑 coldstart-face 与 upgrade-face，贴逐字命令、rc、`EVIDENCE-TRANSPORT` 行、以及**主检出** `.quay/productization-verification.jsonl` 中 `ts` **晚于修复落地时刻**的新记录 —— 六条主体（AC-203/205/207/232/238/239）**每条**须有 `ts` 晚于落地时刻的记录（「载体里有记录」不算）。
- [x] AC6 判据本体干跑 **exit 0**（七行 margin 全正）；`node packages/quay/bin/quay.js goal gate AC-214 --root .` exit 0。`⛔` 通过放宽判据 / 改 K / 删主体达成不算。
- [x] AC7 未改判据：`git diff --exit-code -- goals/` 为空；跑判据前后 `md5sum .quay/productization-verification.jsonl` 的差异**只**来自 AC5 的新记录（`⛔` 无手写/搬运）。
- [x] AC8 测试钉住调用点形态且**能取假**：新增/扩展的测试在把 `init` 拿掉时**转红**；`bash scripts/test.sh --for-task gap-ac214-tenth-crossing-producer-callsite-missing-init-verb` exit 0。贴正/负两次读数。

## Evidence

### AC1 — 改前读数（criterion 逐字，cwd = 主检出）

```
$ bash <criterion>            # 从 goals/AC-214-*.md 用 `yaml` 抽 criterion ，逐字跑
EXIT=1
freshness GOAL-009-AC-201: 21/200 (margin 179)
freshness GOAL-009-AC-232: 239/200 (margin -39)
freshness GOAL-009-AC-205: 239/200 (margin -39)
freshness GOAL-009-AC-207: 239/200 (margin -39)
freshness GOAL-009-AC-203: 239/200 (margin -39)
freshness GOAL-009-AC-238: 239/200 (margin -39)
freshness GOAL-009-AC-239: 239/200 (margin -39)
stderr: stale evidence: GOAL-009-AC-232:239/200 (margin -39), GOAL-009-AC-205:239/200 (margin -39), GOAL-009-AC-207:239/200 (margin -39), GOAL-009-AC-203:239/200 (margin -39), GOAL-009-AC-238:239/200 (margin -39), GOAL-009-AC-239:239/200 (margin -39)
```

每个主体最新记录（主载体）与载体计数：

| subject | newest ts | build_sha |
|---|---|---|
| GOAL-009-AC-201 | 2026-10-09T03:47:03Z | cdbe3483c1f0 |
| GOAL-009-AC-203 | 2026-09-25T17:17:02Z | 09f5c3a80893 |
| GOAL-009-AC-205 | 2026-09-25T17:02:50Z | 09f5c3a80893 |
| GOAL-009-AC-207 | 2026-09-25T17:17:02Z | 09f5c3a80893 |
| GOAL-009-AC-232 | 2026-09-25T17:17:02Z | 09f5c3a80893 |
| GOAL-009-AC-238 | 2026-09-25T16:27:01Z | 09f5c3a80893 |
| GOAL-009-AC-239 | 2026-09-25T16:27:01Z | 09f5c3a80893 |

`wc -l .quay/productization-verification.jsonl` = 336；`ts>=2026-10-09` 计数 = 2。
`.quay/goal-freshness-margin.json`（全文）：

```json
{"at": "2026-10-09T12:25:52Z", "k": 200, "producer_latest_ts": "2026-10-09T03:47:03Z", "subjects": {"GOAL-009-AC-201": {"K": 200, "d": 21, "evidence_age_hours": 8.64, "evidence_ts": "2026-10-09T03:47:03Z", "margin": 179}, "GOAL-009-AC-203": {"K": 200, "d": 239, "evidence_age_hours": 331.14, "evidence_ts": "2026-09-25T17:17:02Z", "margin": -39}, "GOAL-009-AC-205": {"K": 200, "d": 239, "evidence_age_hours": 331.38, "evidence_ts": "2026-09-25T17:02:50Z", "margin": -39}, "GOAL-009-AC-207": {"K": 200, "d": 239, "evidence_age_hours": 331.14, "evidence_ts": "2026-09-25T17:17:02Z", "margin": -39}, "GOAL-009-AC-232": {"K": 200, "d": 239, "evidence_age_hours": 331.14, "evidence_ts": "2026-09-25T17:17:02Z", "margin": -39}, "GOAL-009-AC-238": {"K": 200, "d": 239, "evidence_age_hours": 331.98, "evidence_ts": "2026-09-25T16:27:01Z", "margin": -39}, "GOAL-009-AC-239": {"K": 200, "d": 239, "evidence_age_hours": 331.98, "evidence_ts": "2026-09-25T16:27:01Z", "margin": -39}}}
```

### AC2 — 回归而非恒红

`item_id=AC-214` / `gate=goal`：verdict 计数 pass=9616 fail=2107（门每几分钟评估一次，原始 fail 不是「转红」）。
**pass→fail 转红 9 次**：09-11T17:08:48.739Z / 09-13T11:02:20.337Z / 09-13T16:54:06.892Z / 09-14T14:11:58.168Z / 09-14T17:14:37.907Z / 09-15T19:07:48.174Z / 09-17T04:05:40.109Z / 09-24T02:48:24.110Z / **10-08T17:00:04.535Z（本轮）**；加上 09-09 的初次红（其前无 pass）⇒ **10 次转红**。
判据在 2026-09-26 .. 2026-10-08T16:51 全程为绿（逐日 pass 561/553/545/472/514/475/519/349/350/312/316/297/178，零 fail）⇒ 回归而非恒红。**最后一条 pass = `2026-10-08T16:51:25.879Z`**，其后第一条 fail = `2026-10-08T17:00:04.535Z`。
`⚠️` 按位置更正：任务正文原引「最后一条 pass = 2026-09-25T05:22:17.401Z」——该 ts 确是一条 pass，但**不是最后一条**（10-08T16:51:25.879Z 才是）；结论（回归、第十次）不受影响。

### AC3 — 根因按位置 + 双侧对照

改前逐字（`:1456` 与 `:4583`）：

```
plugin/scripts/verify-deliver-coldstart.sh:1456   bash "$qinit" --root "$root" --repo-root "$root" \
plugin/scripts/verify-deliver-coldstart.sh:4583   if ! CLAUDE_PLUGIN_ROOT="$plugin_root" bash "$qinit" \
                                                      --all --loop \
```

`git show e0279c77a -- plugin/scripts/verify-deliver-coldstart.sh` 把 `:1386/:3603/:4573`（`qinit=` → `bin/quay`）与 `:3782/:4279/:4285`（→ `"$plugin_root/bin/quay" init …`）迁走，**漏了 `:1456` 与 `:4583`**。

双侧对照（**同一 argv 形态**，跑被测 CLI 入口 `plugin/bin/quay`）：

```
site :4583  BEFORE  = bash "$qinit" --all --loop --root …
  rc=1
  usage: quay <adr|goal|meta|init|task list|view|…|driver> ...
  Run `quay --help` for full usage documentation.

site :4583  AFTER   = bash "$qinit" init --root …
  rc=0   （与 usage 无关：参数解析越过，整条 init 跑完）
```

`:1456` 形态同理（BEFORE 缺 `init` ⇒ rc=1 + usage；AFTER 加 `init` ⇒ rc=2 域内早期失败「no test command」而非 usage ⇒ 解析已越过）。`quay init --all` 亦为错误：`quay init: unrecognized option: --all` rc=1。

### AC4 — 兄弟扫描

`grep -n '\$qinit\|bin/quay' plugin/scripts/verify-deliver-coldstart.sh` ⇒ **57** 命中。

- **需改 = 2**：`:1456`、`:4583`（调用点，verb-less）。修复后均为 `bash "$qinit" init …`。
- **已正确 = 3**：`:3782`、`:4279`、`:4285`（e0279c77a 已迁）。
- **其余 52 = 非调用点**（按位置）：赋值/路径推导（`:1386 :3606 :4573 :1223 :1655 :2549 :2920 :3604 :3605 :4942 :5366 :5461 :5555 :3106 :8650 :8696`）、存在性/readlink 检查（`:1389 :3609`）、echo（`:3622`）、注释、夹具 `printf`/`cp` 造 fake bin（`:5899 :5900 :5901 :5902 :5907`）、runtime `bin/quay.js` 提及（不同路径）。

### AC5 — 真跑产出者（用修好的代码）

**coldstart-face**（develop tip 4094d899ca72）：
```
$ bash <WT>/plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" \
    --force --root /data/home/yale/work/quay \
    --driving-profiles /data/home/yale/work/quay-driving-profiles-target.yml
… B remote verify rc=0 evidence_lines=10
EVIDENCE-TRANSPORT appended=10 carrier=/data/home/yale/work/quay/.quay/productization-verification.jsonl …
develop-deliver: evidence-completeness COMPLETE present=6
develop-deliver: e2e-pairing E2E-PAIR OK host=orangevps roots=/home/yale/quay-verify-coldstart-4094d899-root
… C remote verify rc=0 evidence_lines=<none>  ⇒  C NOT-EVALUATED（远端 npm install -g 失败；C 的 / 93% 满）
develop-deliver: --verify-coldstart PARTIAL FAILURE (some hosts NOT-EVALUATED)
```
B 上新增 `ts=2026-10-09T12:32:43Z` 记录（**晚于**修复提交 `8d382f8a1` @ 2026-10-09T12:27:42Z）：`AC-201`(build_sha 4094d899ca72) / `AC-203` / `AC-205` / `AC-207` / `AC-232`。

**upgrade-face 第 1 跑**（develop tip 63ffd6a8069f）—— 调用点修复后 `upgrade action … rc=0`（原 rc=1），但**仍写不出 AC-238**：`post binding: post_binding=unreadable` / `bound=<unread>` ⇒ `replaced=0` ⇒ 第二处断点（见 Requested action 的追加发现）。

**upgrade-face 第 2 跑**（develop tip e0535b83c268，修了第二处消费者后）：
```
$ bash <WT>/plugin/scripts/develop-deliver-tgz.sh --verify-upgrade \
    --upgrade-source work/meta-cc-aged-ac238-copy --ac239-e2e --hosts B \
    --force --root /data/home/yale/work/quay \
    --driving-profiles /data/home/yale/work/quay-driving-profiles-target.yml
EVIDENCE-TRANSPORT appended=4 carrier=… productization-verification.jsonl …
develop-deliver: evidence-completeness COMPLETE present=2
develop-deliver: upgrade-pairing UPGRADE-PAIR OK host=orangevps roots=/home/yale/quay-verify-upgrade-e0535b83-root
develop-deliver: --verify-upgrade OK — GOAL-009-AC-238 record transported …
```
B 上新增 `ts=2026-10-09T13:18:40Z` 记录（**晚于**第二处修复提交 `bea88e2fd`）：
```json
{"build_sha":"e0535b83c268bc6a1fe566c65409f30f0b4697ce","ts":"2026-10-09T13:18:40Z","ac":"GOAL-009-AC-238","host":"orangevps",
 "project_root":"/home/yale/quay-verify-upgrade-e0535b83-root","pre_upgrade_task_count":103,"post_upgrade_task_count":103,
 "pre_upgrade_runtime_age_days":49.596,"runtime_replaced":true,"task_list_ok":true,
 "upgrade_source":"/home/yale/work/meta-cc-aged-ac238-copy","upgrade_init_rc":0,"isolated_copy":true,"taskset_stable":true,
 "sample_task":"AC118-001","fresh_runtime_sha256":"6a94c8efbcc233221cd0bea82d797225ed10765274d195d259d25d7eb3acbc45",
 "pre_binding":"path-resolved","post_binding":"path-resolved","host_key":"B","binding":"delivered-vendor",
 "retired_runtime_backup":"…/.quay/quay-init-backups/1791551937/runtime","retired_backup_matches_pre":true,
 "bound_mcp_entry":"…/quay/plugin/vendor/quay-native/dist/quay-native.js","adopt_decision":true}
```
`AC-239`（同一次运行，`runtime_replaced` 不适用）`ts=2026-10-09T13:18:40Z`、`task_status=done`、`build_sha=e0535b83c268`。

⇒ 六条主体（AC-203/205/207/232/238/239）**每条**均有 `ts` 晚于对应修复落地时刻的新记录。

### AC6 — 判据本体 exit 0

```
$ bash <criterion>            # cwd = 主检出
EXIT=0
freshness GOAL-009-AC-201: 1/200 (margin 199)
freshness GOAL-009-AC-232: 3/200 (margin 197)
freshness GOAL-009-AC-205: 3/200 (margin 197)
freshness GOAL-009-AC-207: 3/200 (margin 197)
freshness GOAL-009-AC-203: 3/200 (margin 197)
freshness GOAL-009-AC-238: 1/200 (margin 199)
freshness GOAL-009-AC-239: 1/200 (margin 199)

$ node packages/quay/bin/quay.js goal gate AC-214 --root .
EXIT=0   verdict=pass   reason="acceptance passed (exit 0)"
```

### AC7 — 未改判据 / 无手写搬运

`git diff --exit-code -- goals/` ⇒ 空（OK）。`md5sum .quay/productization-verification.jsonl` = `0f3892a7d1f60518768ccb2a19ccde87`（差异只来自两条产出者的 `EVIDENCE-TRANSPORT` 追加；两次追加路径均由 `ac_record_append`/transport 产生）。

### AC8 — 测试能取假（正/负两次读数）

新测试在 `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`：
`AC8 — every shipped-CLI invocation in verify-deliver-coldstart.sh is verb-first (position + negative control)`，附 in-process 负控制；另加一条 hermetic 测试钉住第二处修复（`post-upgrade binding reading follows the plugin-root semantics (76f89ce82), three-valued`）。

```
(a) POSITIVE（原文件）:            pass 22 / fail 0
(b) NEGATIVE（从两处调用点剥掉 init）: ✖ AC8 … pass 21 / fail 1
    AssertionError: every shipped-CLI invocation must carry its subcommand verb (… bin/quay init --root …):
    a verb-less call parses --root as an unknown verb ⇒ usage ⇒ rc=1 ⇒ the producer writes no carrier record
(c) RESTORED: git status 干净（文件字节还原）
```

`bash scripts/test.sh --for-task gap-ac214-tenth-crossing-producer-callsite-missing-init-verb` ⇒ [见下方 scoped 门读数]。

### 第二处修复的可取假读数（单测）

抽取 `binding_state` + `config_native_mcp_entry`（按位置）跑夹具根：

```
新语义（无 mcp_entry）+ .quay/plugin 链接  ⇒ binding_state = [path-resolved]；config_native_mcp_entry = […/vendor/quay-native/dist/quay-native.js]
同一 config 但无链接                        ⇒ binding_state = [no-mcp-entry]；config_native_mcp_entry = []（空 ⇒ fail-closed）
含 bare-path mcp_entry（有链接）            ⇒ binding_state = [bare-path-name]（RED 未被遮盖）
```

## DoD

**真实落地 = 产出者脚本修好、两条产出者真跑、AC-214 判据本体干跑 exit 0。**（本轮实测达成：见 AC5/AC6。）

- `plugin/scripts/verify-deliver-coldstart.sh` 的 `:1456` 与 `:4583` 均为 verb-first 形态（`:1456` = `bash "$qinit" init …`；`:4583` = `bash "$qinit" init …` 且无 `--all/--loop`），兄弟扫描给出「需改 = 2 / 已正确 = 3 / 检查型 = 其余」的逐条判定。
- coldstart-face 与 upgrade-face **各真跑一次**（跨机，host B/C），在**主检出**载体上为 AC-203/205/207/232/238/239 **每条**写出 `ts` 晚于落地时刻的新记录；`⛔` 不接受「夹具读数」「只改文档」「只改一处调用点」。
- AC-214 判据本体（criterion 逐字，cwd = 主检出）干跑 **exit 0**（七行 margin 全正），`quay goal gate AC-214 --root .` exit 0。
- 一条**能取假**的测试钉住调用点形态（拿掉 `init` ⇒ 红，恢复 ⇒ 绿）。
- `goals/` 零 diff；`⛔` 未手写/搬运任何证据记录。

`⛔` **不接受的替代物**：改 K / 删主体 / 改 `expect` 或 `criterion`；手写或搬运证据记录；只改一处调用点；只把运行史写进 `plugin/freshness-producers.json`；把 AC5 降格成夹具读数；`⛔` 新增任何 needs-human 成因枚举或「可机械再入队」路径（人 2026-09-20 裁定）。

## Touches

- `plugin/scripts/verify-deliver-coldstart.sh`
- `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`
- `tasks/gap-ac214-tenth-crossing-producer-callsite-missing-init-verb.md`（自身文件：勾 AC + 贴实跑证据）
- `.quay/productization-verification.jsonl`（gitignored：产出者 append 的落点；`⛔` 非可提交物）
