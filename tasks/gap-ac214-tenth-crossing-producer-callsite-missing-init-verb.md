---
id: gap-ac214-tenth-crossing-producer-callsite-missing-init-verb
title: AC-214 第十次转红（6/7 主体 d=239/200, margin −39）：产出者的动作调用点缺 `init`
  子命令（verify-deliver-coldstart.sh:1456/:4583，e0279c77a 漏迁）⇒「重跑产出者」这一补救自
  2026-10-07 起结构性写不出记录
status: todo
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

## AC

- [ ] AC1 改前读数（能取假，复跑 `⛔` 非引述）：用**仓库自己的 YAML 解析器**抽出 `goals/AC-214-*.md` 的 `criterion:` 折叠块逐字跑 ⇒ **exit 1**，stderr 逐字含 6 条 `GOAL-009-AC-…:239/200 (margin -39)`；贴 stdout 七行 + 每个主体最新记录的 (ts, build_sha) 表 + `.quay/productization-verification.jsonl` 行数与 `ts>=2026-10-09` 计数 + `.quay/goal-freshness-margin.json` 全文。
- [ ] AC2 回归而非恒红：贴 `.quay/gate-events.jsonl` 中 `item_id=AC-214` 的最后一条 `pass`（`2026-09-25T05:22:17.401Z`）与其后第一条 `fail`（`2026-10-08T17:00:04.535Z`），以及 fail 事件总数（=10）。
- [ ] AC3 根因按位置 + **双侧对照**（硬规则 4 推论四）：贴 `verify-deliver-coldstart.sh:1456` 与 `:4583` 的**改前逐字**（`bash "$qinit" …` / `bash "$qinit" --all --loop …`）与 `git show e0279c77a -- plugin/scripts/verify-deliver-coldstart.sh` 中「3 处已迁移、这 2 处漏」的逐字 hunk。对照须在**修复后、用同一 argv 形态**给出：① 改前形态（缺 `init`）⇒ usage + rc≠0；② 只加 `init`（`:4583` 还去 `--all --loop`）⇒ 越过参数解析（rc 与 usage 无关）。两次读数逐字入 `## Evidence`。
- [ ] AC4 兄弟扫描（硬规则 5b 产物）：`grep -n '\$qinit\|bin/quay' plugin/scripts/verify-deliver-coldstart.sh` 的**全部**命中逐条判定，命中数与「需改 = 2」一并贴出。
- [ ] AC5 真跑产出者刷新证据（硬规则 4 推论三：AC 必须读**生产载体**）：用修好的代码跑 coldstart-face 与 upgrade-face，贴逐字命令、rc、`EVIDENCE-TRANSPORT` 行、以及**主检出** `.quay/productization-verification.jsonl` 中 `ts` **晚于修复落地时刻**的新记录 —— 六条主体（AC-203/205/207/232/238/239）**每条**须有 `ts` 晚于落地时刻的记录（「载体里有记录」不算）。
- [ ] AC6 判据本体干跑 **exit 0**（七行 margin 全正）；`node packages/quay/bin/quay.js goal gate AC-214 --root .` exit 0。`⛔` 通过放宽判据 / 改 K / 删主体达成不算。
- [ ] AC7 未改判据：`git diff --exit-code -- goals/` 为空；跑判据前后 `md5sum .quay/productization-verification.jsonl` 的差异**只**来自 AC5 的新记录（`⛔` 无手写/搬运）。
- [ ] AC8 测试钉住调用点形态且**能取假**：新增/扩展的测试在把 `init` 拿掉时**转红**；`bash scripts/test.sh --for-task gap-ac214-tenth-crossing-producer-callsite-missing-init-verb` exit 0。贴正/负两次读数。

## DoD

**真实落地 = 产出者脚本修好、两条产出者真跑、AC-214 判据本体干跑 exit 0。**

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
