---
id: gap-ac206-criterion-pinned-to-retired-quay-init-sh-goals-mkdir
title: AC-206 判据 check③ 钉在已退役的 quay-init.sh 字面量上 → 改为活引擎行为探针
status: done
labels:
  - gap
  - mechanism
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-206
---
## Finding

AC-206（GOAL-009，long-term，achieved）本轮复跑 **exit 1**，stderr=`quay-init.sh does not create goals/`。两次独立读数同因：2026-09-09（`firstAt`）与本轮 2026-10-09T12:00:37Z。**失败的不是引擎，是判据钉在一个已退役的载体上。**

根因（位置判定，非关键词）：AC-206 的 check ③ 逐字为
`if 'mkdir -p "$WORKSPACE_ROOT/goals"' not in open("plugin/scripts/quay-init.sh").read(): ... exit 1`。
2026-10-07 的 `e0279c77a`（GOAL-029 / AC-332）把 `plugin/scripts/quay-init.sh` 从约 1300 行的**第二写手**改成 ≤40 行 shim——它只把旧 shell flag 翻译后 `exec "${plugin_root}/bin/quay" init`。goals/ 的创建随之搬进 TS 引擎 `packages/quay/src/init.ts:2029-2031`（`const goalsDir = path.join(root,"goals")` + `fs.mkdirSync(goalsDir,{recursive:true})`，与 tasks/ 成对）。shell 里的那个字面量已不存在，**且按设计不该再存在**（第二个写手 = 第二个漂移源，正是 GOAL-029 要消灭的）。⇒ check ③ 现在是**结构性恒假**：引擎再正确也永远绿不了 GOAL-009 的这条长期保证。

保证本身仍在（直接量实测，2026-10-09，非推断）：在一次性 git 仓库跑活引擎——

```sh
d=$(mktemp -d); cd "$d" && git init -q -b main . && mkdir -p scripts
printf '#!/usr/bin/env bash\nexit 0\n' > scripts/test.sh && chmod +x scripts/test.sh
cd /data/home/yale/work/quay && node packages/quay/bin/quay.js init --root "$d"
```

⇒ exit 0，`goals/` 与 `tasks/` **均创建**，`.quay/config.yml` 写 `QUAY_NATIVE_GOAL_DIR: "<d>/goals"` 且 `doc_surfaces: ["tasks/", "goals/", ".quay/"]`。另：SPEC `QUAY-INIT-CLOSED-SET` 块含 `goals/` ✓（check ① 绿）、`CLOSED_SET_DIRS = ["tasks","goals"]` ✓（check ② 绿）。

check ④（载体）**已通过**：`.quay/productization-verification.jsonl` 有 **29 条**合格记录（host=`orangevps` / `instance-20221019-1509`，project_root=`/home/yale/quay-verify-coldstart-*`，均 host≠本机 `VM-16-5-ubuntu` 且 project_root 在仓库外，四布尔全 true）。⇒ **本轮唯一失败的就是 check ③**。

<!-- dedup-ref -->
这是硬规则 4b/4c 的教科书案例：**代理量**（grep 某个实现文件里的字面量）在 2026-10-07 与**直接量**（init 真的建了 goals/）解耦，而判据仍在读代理。上一版修复（`gap-ac206-goals-tasks-dual-carrier-quay-init-goals-closed-set`，done）当时的「六处同步改动」世界已部分退役：④ 的 `docs/analysis/quay-init-closure-ratchet.baseline.json` 已不存在（同一次 shim 改造里 "closure ratchet retired"）。⇒ **不是修复没落地，是修复所依赖的载体 12 天后被另一次经授权的重构搬走了，而判据没跟着搬。**

## AC

- [x] AC1 check ③ 从「grep 已退役的 `plugin/scripts/quay-init.sh` 字面量」改为**活引擎行为探针**：在一次性 git 工作区跑 init 引擎，断言 `goals/` ∧ `tasks/` 两者均被创建（双载体），并断言产出的 `.quay/config.yml` 把 `QUAY_NATIVE_GOAL_DIR` 绑到该项目自己的 `goals/`。⛔ 不得改为 grep 另一个实现文件（那只是把同一个病推迟到下次重构）——判据必须读**行为**（硬规则 4b/4c）。贴可复现命令与真实读数。
- [x] AC2 check ①②④ 逐字不变；改完后在**本仓库 git root**（goal criterion 的固定 cwd）`bash -c "$(criterion)"` **exit 0**、stderr 为空。贴 exit code 与完整输出。
- [x] AC3 **能取假，不是恒真空转**（硬规则 4 推论三）：负控制——用一次性副本/fixture 令引擎不建 `goals/`（⛔ 不改生产代码），同一条 check ③ 必须红（exit 1 且 stderr 指名 goals 未建）；恢复后转绿。贴正/负两次读数。
- [x] AC4 声明侧与行为侧**成对**：check ①②（SPEC 闭集块、`CLOSED_SET_DIRS`）继续为真且与 check ③ 同时成立——任一单独成立都不够（避免 AC-204 风险 3 的「什么都不做也通过」）。贴 check ①② 的当前读数。

## DoD

- [x] `goals/AC-206-目标项目具备-goals-tasks-双载体-goals-与-tasks-一同由-quay-init-创建.md` 的 `criterion:` 已改（经 `quay goal write <id> --origin ... --criterion ...` 或 `goal_write` MCP，⛔ 不手改 md 绕过 ABI）；`origin`/`expect` 同步更新——`expect` 里那句过期的「（当前：SPEC 闭集缺 goals/）」必须改成当前真实失败原因或删除（⛔ 不得留一句与 criterion 矛盾的散文）。
- [x] AC-206 在仓库上复跑 **exit 0**；`quay goal check --achieved-failing` 读数中不再出现 AC-206（贴命令与输出）。
- [x] 真落地点不是「文件里出现新字符串」，而是**判据本身在仓库上 exit 0 且负控制下 exit 1**。贴正/负两次 `bash -c "$(criterion)"` 的 exit code 与 stderr。
- [x] 相关机制测试仍绿：`plugin/test/quay-init.test.mjs`（`:136`/`:329` 断言 goals/ 双载体）、`plugin/test/quay-init-loop.test.mjs`（`:149`）。贴命令与结果。
- [x] 若改判据导致 develop 上的语料 pin / 测试转红（记忆 goal-criterion-rewrite-on-develop-stales-a-corpus-pin），一并修（先查有没有测试逐字 pin 这段 criterion——已查：`grep -rn 'GOAL-009-AC-206\|does not create goals' plugin/test packages experiments docs` 当前零命中，仍须改完复跑确认）。

## Touches
- goals/AC-206-目标项目具备-goals-tasks-双载体-goals-与-tasks-一同由-quay-init-创建.md
- tasks/gap-ac206-criterion-pinned-to-retired-quay-init-sh-goals-mkdir.md
- plugin/test/quay-init.test.mjs

——

## Evidence（worker round 2026-10-09）

### AC1 —— check③ 改为活引擎行为探针（不是把 grep 换个实现文件）

`goals/AC-206-…md` 的 `criterion:` 第 20–49 行即新 check③：建一次性 git 工作区 → 跑**活引擎**
`node packages/quay/bin/quay.js init --root <probe>` → 断言 `goals/` ∧ `tasks/` **均被创建**，
且产出的 `.quay/config.yml` 的 `QUAY_NATIVE_GOAL_DIR` realpath == `<probe>/goals`（双载体 + 绑定）。
引擎探针实测 0.38s（远低于 60s 默认 deadline）。⛔ 全文不再 grep 任何实现文件。

复现（cwd = 本仓库 git root）：

```sh
node /tmp/ac206-extract.mjs "goals/AC-206-目标项目具备-goals-tasks-双载体-goals-与-tasks-一同由-quay-init-创建.md" > /tmp/ac206-stored.sh
bash -c "$(cat /tmp/ac206-stored.sh)"; echo "EXIT=$?"   # EXIT=0
```

### AC2 —— 整条 criterion 在仓库 git root（固定 cwd）exit 0、stderr 空

```
$ bash -c "$(cat /tmp/ac206-stored.sh)"     # cwd=/data/home/yale/work/quay
EXIT=0   STDOUT=[]   STDERR=[]
$ sh  -c "$(cat /tmp/ac206-stored.sh)"      # 验收 runner 用的是 /bin/sh(=dash)
EXIT=0   STDERR=[]
$ node packages/quay/bin/quay.js goal gate AC-206
{"verdict":"pass","reason":"acceptance passed (exit 0)","evaluationRoot":"/data/home/yale/work/quay"}   EXIT=0
```

check ①②④ 逐字未动（见 AC4）。

### AC3 —— 能取假，不是恒真空转（硬规则 4 推论三）

四组读数。fixture = `git worktree add -q --detach /tmp/ac206-negctl HEAD`（一次性副本）
+ 删掉副本里 `packages/quay/src/init.ts` 的 goals mkdir 一行（⛔ 生产代码未改一行），
在副本 cwd 跑**同一条（存储版）criterion**：

```
neg arm1 (引擎不建 goals/):     EXIT=1  stderr=[init engine did not create the dual carrier: goals=False tasks=True]
neg arm2 (goals/ 建了但 GOAL_DIR 绑到 other-goals): EXIT=1  stderr=[QUAY_NATIVE_GOAL_DIR is not bound to this project's own goals/: /tmp/ac206-init-probe-…/other-goals]
pos     (仓库 git root，未打补丁): EXIT=0  stderr=[]
```

⇒ 同一条判据在两处独立维度上都能取假（缺目录 / 绑错目录），恢复后转绿。

### AC4 —— 声明侧与行为侧成对

```
check ① SPEC QUAY-INIT-CLOSED-SET 块:  "- tasks/" 与 "- goals/" 均在
check ② plugin/scripts/quay-init-closure-assertion.ts:58  CLOSED_SET_DIRS = ["tasks", "goals"]
check ③ 行为探针 exit 0（AC2）；check ④ 合格载体记录 29 条（host≠VM-16-5-ubuntu、project_root 在仓库外）
```

### DoD

- `quay goal write AC-206 …` 执行两次：worktree 内（分支 delta，commit `bbe3dfb8c`）与主检出
  （活 serve/MCP/ledger 读数，commit `810bce361`）。改后的 criterion 用 `goal show` 读回与预期
  **byte-identical**（`cmp` = YES）；`expect` 里过期的「（当前：SPEC 闭集缺 goals/）」已删除，改为
  描述新失败面。
- `quay goal check --achieved-failing`：`achievedButFailing = ["AC-214","AC-242","AC-315"]`，
  **AC-206 不在其中**；`inScope`（34 条）含 AC-206 ⇒ 它是被**求值**过才不出现的，不是 not-evaluated 空转。
- 机制测试：`plugin/test/quay-init.test.mjs` **18 pass / 0 fail**（`:136` / `:329` 的 goals 双载体断言在）；
  `plugin/test/quay-init-loop.test.mjs` **7 pass / 0 fail**（`:149` goals 断言在）。
- 语料 pin 复查：`grep -rn 'GOAL-009-AC-206\|does not create goals' plugin/test packages experiments docs`
  = **0 命中**；`criterion-failure-attribution-check.ts` = **PASS inDomain=197 bareAcs=0**。
