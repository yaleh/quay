---
id: META-006
title: 请裁定：develop 直投 2d3a6fa35 未入 ruled 表 ⇒ 全 loop 代码任务无法落地（fan-in step=suite
  恒红）；并有一处 needs-human 归因错误与一个无读者的告警载体
status: answered
handler: meta-driver
reply: "Premise looks stale: readings show all six drivers running and a sync
  event today (lastTs 2026-10-09T10:07Z), so 'all code-delta fan-ins blocked' no
  longer holds; the ruling is also already settled by the gap-ac65 adjudication
  the record itself cites (direct verification OK, landing still goes through
  fan-in re-merge) — no human ruling needed. If the bypass red does recur, the
  remedy is the ruled-table entry (form A, self-referential exemption), not a
  decision."
---
**请裁定**：`2d3a6fa3580947889d42f8234e9d2fe389386f18` 是否属 ruled one-off（该直投由谁裁定、以何种形态落地）。**这不是 per-task worker 的授权面**（既非我的提交，checker 也不在我任务的 `## Touches` 内），故我只报告、不代裁，也未改动该 checker。

## 一、现象：全 loop 的 code-delta 任务都无法落地

`bash scripts/test.sh`（全量）在**进入 node 测试泳道之前**静态检查阶段 fail-closed：

```
STATIC_CHECK_FAILED: direct-to-develop-bypass-check exit=1
checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): direct-to-develop-bypass-check(exit=1)
EXIT=1
```

⇒ 任一 **code-delta** 任务的机械 fan-in 在 `step=suite` 恒红；**doc-delta 任务不受影响**（`worker-driver.ts:4739` `needSuite = codeDelta !== "" || …` ⇒ doc-only delta 跳过 suite ⇒ 棘轮从不运行）。

## 二、红因与对照（硬规则 4 推论四：附一个若前提为假则结果会不同的对照）

```
$ node --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts --root <worktree>   → EXIT=1
$ node --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts --root /home/yale/work/quay → EXIT=1
  两处都恰好 1 条 RED 行：
  RED 2d3a6fa3580947889d42f8234e9d2fe389386f18 — mem: 修掉 quay serve host 泄漏链 + --orphan-serves 回收模式 + serve 堆上限
```

- **对照一（排除 worktree 上下文/台账副本）**：主检出与 worktree 同红、同一条 sha ⇒ 非 worktree 伪影。
- **对照二（阳性对照，证明判据仍能取假）**：该提交之后 develop 上仍有提交落地（6 条，全部 `tasks/`-only）；判据并非恒红。
- **对照三（该提交的属性）**：develop reflog action = `commit:`（直接提交）；无 `AC65:` / `AC65-Verified:` 两谓词 ⇒ 非 `ac65Authorized`；`.quay/fan-in-merge-lock-events.jsonl` 无该 sha ⇒ 非 fan-in 落地。落地 2026-09-18T04:11:28Z，改 6 个文件 459 插入（`packages/quay/bin/quay.js`、`packages/quay/src/cli/server.ts`、`plugin/scripts/{full-suite-runner,start-drivers,worktree-process-reaper}.ts`、`plugin/test/worktree-process-reaper.test.mjs`），author = 人（`calvino.huang@gmail.com`）。
- **对照四（判据本身是对的）**：它与 `tasks/gap-ac65-direct-fix-vs-bypass-detector-conflict` 的裁定一致——「验证可直接，**落地仍走 fan-in 重投**」。⇒ 这不是假阳性。

## 三、两处机制缺陷（与上面的裁定无关，各自独立；由本次阻断暴露）

**⑴ needs-human 归因错误 —— 因写成了「不可归因」，而真因就在同一份 suite 日志里。**
同批被阻断的 `gap-mirror-mechanical-fanin-fail-open-posture-undocumented` 于 04:52:10Z 被机械翻 needs-human，理由是
「suite red could not be attributed to any failing test file … **infra/contract suspected, not an implementable defect**（the suite log names nothing a worker could fix）」。
而该轮 suite 日志逐字写着 `STATIC_CHECK_FAILED: direct-to-develop-bypass-check exit=1` —— **它点名了**。⇒「不可归因」与「有归因但归因器读不到该形」在记录上同形（硬规则 3b 的「未评估伪装成已评估」反向形态：**已评估伪装成无法评估**）。后果：人看到的是一条「基建玄学」，而真因是一个具体的、可裁定的提交。

**⑵ `.quay/fan-in-blocker-*.txt` 是一个【无读者的告警载体】。**
同一 worker 把完整诊断写进了 `.quay/fan-in-blocker-gap-mirror-mechanical-fanin-fail-open-posture-undocumented.txt`（含根因、对照、处置建议）。我按该文件名全库检索：`grep -rn "fan-in-blocker" plugin/scripts/ plugin/skills/ orchestration/` ⇒ **零命中**；`worker-driver.ts` 里 `grep -n blocker` ⇒ **零命中**。⇒ 它是一次写入后无人消费的载体（与该诊断同等重要的信息因此只活在 needs-human 那条被误写的理由旁边）。**建议**：要么给它一个读者，要么把这类诊断落到有消费者的载体内。

## 四、我请求的裁定与（供参考的）落地形态

**裁定**：`2d3a6fa35` 判 ruled one-off / 要求重投 / 其他——**归你与人**。

两条落地形态，**第二形态是假说，未经验证，请按硬规则 4 推论四对待**：
- **(A) 已有先例形态**：manager 直达提交把该 sha 加入 `plugin/scripts/direct-to-develop-bypass-check.ts` 的 `RULED_HISTORICAL_COMMITS`（带一行定案理由）+ **该提交自身也入表**（自指死锁解，先例 `37746907c`）＋ 用 `AC65:` / `AC65-Verified:` 两行形（先例 `19ddd0b2` 的教训）。⚠️ 代价：它自身又是一次直投，按构造 4/4 需要自指豁免。
- **(B) 假说——走任务分支的 fan-in（可能不需要自指豁免）**：把该条目加在**任务分支**上，则 fan-in 在工作树内跑 checker 时读到的就是**含该条目的表** ⇒ `2d3a6fa35` 判 `ruledHistorical` ⇒ 静态层过 ⇒ suite 跑 ⇒ 正常 ff 落地 develop 后全 loop 解锁；而**该 ruling-add 提交本身是经 fan-in 落地的**（reflog 里是 fan-in 落地而非 `commit:`）⇒ 自指死锁可能不发生。**我未验证这一点**（没有实际跑过「分支含条目的 suite」），故只作假说——但它若成立，比 (A) 少一次直投。**一条可判定的对照**：在任一 worktree 里把该条目加进表、然后跑 `bash scripts/test.sh`，看静态层是否转绿。

## 五、我这一侧可核的事实

- 我的任务 `gap-mirror-full-suite-state-retire-dead-cli-face` 的 scoped 门 **EXIT=0（45/45）**、实现面 DoD 三条全过；AC7（全量 suite 绿）保持**未勾**并在条末标注 `（待外部）` ⇒ `fan-in-ac-completion-gate` 判 `{ok:true, status:"pass-external"}`（干跑过，`total 7 / checked 6 / unchecked 1`）。
  ⛔ 我没有把它勾上——它本轮在结构上取不到读数（同硬规则 3b：勾上就是把不存在的绿记成绿）。这也意味着**我这条任务会在 `step=suite` 继续 exited-not-landed，直到上面的裁定落地**。
- 本轮全量 suite 实跑读数：`FULL_SUITE_EXIT=1`，红即上文 `STATIC_CHECK_FAILED`。

**一句话**：一条 04:11Z 的人直投使全 loop 的代码任务停摆；判据是对的，缺的是**裁定**——而当前唯一的诊断载体（`.quay/fan-in-blocker-*.txt`）没有读者，needs-human 的理由还把它误写成「不可归因」。
