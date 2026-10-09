---
id: gap-ac206-criterion-pinned-to-retired-quay-init-sh-goals-mkdir
title: AC-206 判据 check③ 钉在已退役的 quay-init.sh 字面量上 → 改为活引擎行为探针
status: todo
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

- [ ] AC1 check ③ 从「grep 已退役的 `plugin/scripts/quay-init.sh` 字面量」改为**活引擎行为探针**：在一次性 git 工作区跑 init 引擎，断言 `goals/` ∧ `tasks/` 两者均被创建（双载体），并断言产出的 `.quay/config.yml` 把 `QUAY_NATIVE_GOAL_DIR` 绑到该项目自己的 `goals/`。⛔ 不得改为 grep 另一个实现文件（那只是把同一个病推迟到下次重构）——判据必须读**行为**（硬规则 4b/4c）。贴可复现命令与真实读数。
- [ ] AC2 check ①②④ 逐字不变；改完后在**本仓库 git root**（goal criterion 的固定 cwd）`bash -c "$(criterion)"` **exit 0**、stderr 为空。贴 exit code 与完整输出。
- [ ] AC3 **能取假，不是恒真空转**（硬规则 4 推论三）：负控制——用一次性副本/fixture 令引擎不建 `goals/`（⛔ 不改生产代码），同一条 check ③ 必须红（exit 1 且 stderr 指名 goals 未建）；恢复后转绿。贴正/负两次读数。
- [ ] AC4 声明侧与行为侧**成对**：check ①②（SPEC 闭集块、`CLOSED_SET_DIRS`）继续为真且与 check ③ 同时成立——任一单独成立都不够（避免 AC-204 风险 3 的「什么都不做也通过」）。贴 check ①② 的当前读数。

## DoD

- [ ] `goals/AC-206-目标项目具备-goals-tasks-双载体-goals-与-tasks-一同由-quay-init-创建.md` 的 `criterion:` 已改（经 `quay goal write <id> --origin ... --criterion ...` 或 `goal_write` MCP，⛔ 不手改 md 绕过 ABI）；`origin`/`expect` 同步更新——`expect` 里那句过期的「（当前：SPEC 闭集缺 goals/）」必须改成当前真实失败原因或删除（⛔ 不得留一句与 criterion 矛盾的散文）。
- [ ] AC-206 在仓库上复跑 **exit 0**；`quay goal check --achieved-failing` 读数中不再出现 AC-206（贴命令与输出）。
- [ ] 真落地点不是「文件里出现新字符串」，而是**判据本身在仓库上 exit 0 且负控制下 exit 1**。贴正/负两次 `bash -c "$(criterion)"` 的 exit code 与 stderr。
- [ ] 相关机制测试仍绿：`plugin/test/quay-init.test.mjs`（`:136`/`:329` 断言 goals/ 双载体）、`plugin/test/quay-init-loop.test.mjs`（`:149`）。贴命令与结果。
- [ ] 若改判据导致 develop 上的语料 pin / 测试转红（记忆 goal-criterion-rewrite-on-develop-stales-a-corpus-pin），一并修（先查有没有测试逐字 pin 这段 criterion——已查：`grep -rn 'GOAL-009-AC-206\|does not create goals' plugin/test packages experiments docs` 当前零命中，仍须改完复跑确认）。

## Touches
- goals/AC-206-目标项目具备-goals-tasks-双载体-goals-与-tasks-一同由-quay-init-创建.md
- tasks/gap-ac206-criterion-pinned-to-retired-quay-init-sh-goals-mkdir.md
- plugin/test/quay-init.test.mjs
