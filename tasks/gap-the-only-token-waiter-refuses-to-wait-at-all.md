---
id: gap-the-only-token-waiter-refuses-to-wait-at-all
title: "The one real heavy-op token waiter passes --timeout 0, so a 30-second grace window becomes a failed suite run"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

**本任务的第一版标题与规模都是错的，先记录更正，因为它改变了要做多少事。**

原标题是 `a token held by nobody can starve a live waiter`（一个谁也没在用的令牌饿死了活的等待者），
原范围是给令牌加公平性/排队。**管理者推翻了这个定性，实测支持推翻。**

### 更正一：没有饥饿。外层升级时的数字是错的

外层当时报「12 次套件尝试全部没跑成」「quay 永远抢不到」。**重算实测**：

| 结果 | 次数 | 证据 |
|---|---|---|
| 因 token 退出 | **2** | `batch7-suite5.log`（mtime 25s）、`batch7-suite11.log`（mtime 8s） |
| **真跑完** | **3** | suite7 `fail 2`、suite9 **`fail 0`**、suite12 `fail 2` |
| 尾部不可判 | 2 | suite10 / suite13 |

**⇒ 12 次里只有 2 次死在令牌上，其余跑起来了。不存在无界饥饿。**
管理者的独立实测同向：mtime 292s 时 `--acquire` **当场回收**（`RECLAIMED reclaim #17`、`waited_ms=0`）。

### 更正二：等待者存在，但它拒绝等——这才是剩下的那个真缺陷

管理者查过谁真的在等：`--status` 的调用点全是测试、文档、和同名无关工具；
**真正的等待者只有 `scripts/test.sh` 与 `prepare-admission-check.ts`，两个都走 `--acquire`。**

而 `scripts/test.sh:237` 逐字是：

```bash
if ! bash "${repo_root}/plugin/scripts/heavy-op-token.sh" --acquire quay --timeout 0; then
  echo "scripts/test.sh: heavy-op token HELD by another project — not running the full suite"
  exit 1
fi
```

**`--timeout 0` 是零等待。** suite11 的 `waited_ms=0 acquired=no` 不是被饿死，是**一秒都没等就退出**。

**⇒ 缺陷的真实形状**：令牌机制没问题（懒回收 + `mtime 超时 AND pid 不活` 的 AND 是站得住的，
它保护的是「刚写完令牌、进程尚未可见」的竞态）。问题在于**唯一的真实等待者把一个上界 30 秒的
瞬态，直接变成一次失败的套件运行**——而失败之后，读日志的人看到的是「被另一个项目占着」，
于是去查跨项目资源竞争，而不是去等 30 秒。**今晚内层反复重试、外层升级误判，都源于这一行。**

**规模因此大幅缩小**：不是令牌公平性重设计，是**给唯一的等待者一个有界等待**。

### 一条要单独记住的事：机制的价值证据长什么样

`reclaim #17` 里**多数不是异常，是管理者今天为换模型杀掉的 6 个会话**——
每次被杀的持有者都留下一个死 pid，机制每次都默默兜住了。

**机制的价值证据不是它拦下了什么，是它兜住了一个没人注意到的常态。**
一个「从没报过警」的兜底件很容易被当成没用而删掉；这条记录就是它的存在理由。
**推论用于本任务**：不要因为「今晚只有 2 次」就认为不值得修——
同样也不要因为「有 17 次回收」就认为它在失控。

## Contract

```
measure token_bail_runs = `scripts/test.sh` 因令牌未获取而 exit 1 的次数字段
measure waited_ms = `--acquire <project> --timeout <s>` 输出的 waited_ms 字段
band token_bail_runs = 0
invariant 有界等待优于立即失败；等待上界必须小于一次真实重活的时长，否则等于串行化
invoke `bash scripts/test.sh`
control 持有者为死 pid + mtime 5s ⇒ 等待后成功且 waited_ms>0；持有者活着且长跑 ⇒ 有界超时后仍失败、不误抢
resume 先确认 `--acquire --timeout N` 是否真的循环重试，再定 test.sh 的等待上界
```

## Chosen mechanism

1. **先确认 `--acquire --timeout N` 的重试语义**——它是否真的在超时窗口内循环重试，
   还是判一次即返回。**这一步不能跳过**：若它本身不重试，则 `test.sh` 改超时值是无效改动
   （**「改了参数但底层不重试」正是本仓反复栽的「存在≠生效」**）。
2. **给 `test.sh` 一个有界等待**（上界待定，量级应覆盖宽限期而非覆盖一次重活）。
3. **失败文案要改**：当前印的是「被另一个项目占着」，误导读者去查跨项目竞争。
   死持有者时应直说**持有者已死、等了多久、还差多久到可回收**。
4. **不做**：不给令牌加排队/公平性（无饥饿证据，见更正一）；不移除 pid 存活检查；
   不加后台清扫守护进程（本仓已裁定懒回收是对的）。

## Acceptance Criteria

- [x] AC1: **重试语义先落定**——`--acquire --timeout N` 在窗口内是否循环重试，实跑输出为证。
      **已确认并钉死**：`do_acquire` 的 `while :` 循环逐秒重新 `try_acquire`（重新检查回收条件、
      重试原子 claim），窗口内真的重试，不是判一次即返回。实跑（AC2/AC3 输出）里每行
      `token held — waited Ns (bounded wait, not silent)...` 即逐秒重试的可见证据。
      新测试 `heavy-op-token-wait.test.mjs` AC1 用 node:test 钉死该语义（live 持有者 + `--timeout 2`
      ⇒ 逐秒重试 2 次、`waited_ms=2000 acquired=no`、令牌原样保留）。
- [x] AC2: **正向**——持有者为死 pid + mtime 5s ⇒ `test.sh` 等待后**成功跑起套件**，`waited_ms>0`（实跑贴出）。
      **实跑（默认 STALE_TIMEOUT_S=30、`--timeout ${HEAVY_OP_ACQUIRE_TIMEOUT_S:-40}`，即 test.sh 的
      逐字 acquire 行 + `--root` 测试缝，下同）**：
      ```
      fixture: dead pid 3530518, mtime 5s old, STALE_TIMEOUT_S=30 (default)
      heavy-op-token: HELD by deadproj (pid 3530518 dead, mtime only 5s old) — holder DEAD; reclaimable in 25s ...
      heavy-op-token: token held — waited 1s (bounded wait, not silent)...
      ...（每秒一行，reclaimable in 从 25s 倒数到 1s）...
      heavy-op-token: token held — waited 23s (bounded wait, not silent)...
      heavy-op-token: RECLAIMED stale token (mtime 30s old, pid 3530518 not alive) — reclaim #1
      waited_ms=23000 holder=quay acquired=yes
      exit=0 elapsed_s=25
      ```
      改前 `--timeout 0` 是零等待直接 `exit 1`；改后同一个死持有者场景被**等待吸收了**：25 秒内
      逐秒倒数、在第 30 秒回收、`waited_ms=23000 > 0`、acquire 成功。
- [x] AC3: **反向负控制（不得误抢）**——持有者**活着**且长跑 ⇒ 有界超时后仍失败、**绝不回收**。
      **实跑**（live 持有者 archguard 长跑，STALE_TIMEOUT_S=30，bound 缩短为 3s 演示）：
      ```
      fixture: LIVE holder archguard, long-running
      heavy-op-token: HELD by archguard (pid 3531953, held 551ms) — quay did not acquire (no silent wait)
      heavy-op-token: token held — waited 1s ...
      heavy-op-token: token held — waited 2s ...
      heavy-op-token: token held — waited 3s ...
      heavy-op-token: did not acquire within 3s wait window — token held by archguard (pid 3531953, ALIVE, held 3748ms) — quay did not acquire
      waited_ms=3000 acquired=no
      exit=1 elapsed_s=4
      token survives: holder=archguard pid=3531953 ...
      reclaim counter: 0
      ```
      有界超时后**仍失败**（`exit 1`）、令牌**原样保留**、`stale_reclaims` 仍为 0——**绝不误抢在跑的
      重活**。此条先于 AC2 通过：AC2 只在死持有者方向把等待变成成功，live 方向依旧失败。
- [x] AC4: **上界不得退化为串行化**——等待上界写进文件头并说明它为何小于一次真实重活的时长。
      `scripts/test.sh` 头注释 + `heavy-op-token.sh` 头注释均写明：`HEAVY_OP_ACQUIRE_TIMEOUT_S`
      （默认 40s）覆盖一个完整 stale-timeout 周期（默认 30s）+ 写入→回收竞态余量，但**远小于一次
      真实重活**（concurrency 8 下完整套件约 8 分钟）——最坏 40s 等待只吸收 ≤30s 瞬态宽限期，
      **不可能把两次重活背靠背串行化**（40/480 ≈ 8%）。
- [x] AC5: **失败文案**——死持有者时不得再印「被另一个项目占着」，须印持有者已死 + 等待时长 + 距可回收还差多久。
      `try_acquire` 死持有者分支现在打印 `holder DEAD; reclaimable in Ns`（距可回收还差多久），
      `do_acquire` 超时分支的最终行打印 `did not acquire within Ns wait window — token held by <holder>
      (pid <p> DEAD, mtime only <n>s old — reclaimable in <m>s) — <proj> did not acquire`（持有者已死 +
      等待时长），并保留契约行 `waited_ms=N acquired=no`。`scripts/test.sh` 的失败横幅改为中性的
      `could not acquire the heavy-op token within Ns (holder state printed above — dead vs alive)`，
      不再无条件断言「被另一个项目占着」。live 持有者方向同理印 `ALIVE`。
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`。
      新测试文件 `plugin/test/heavy-op-token-wait.test.mjs`：`import { test } from "node:test"` +
      `// @test-group governance`（含 governance 自跳模块，`--group governance` 或显式文件名运行）。

## Definition of Done

- [x] AC2 与 AC3 两个方向的实跑输出都贴进任务体（见上 AC2/AC3 的两段实跑）
- [~] 完整套件连跑 2 次全绿——**如实标注：仅 1 次全量绿**（协调方 fan-in，批 3 套件 **2157 tests /
      2134 pass / 0 fail / 0 cancelled**，SUITE_EXIT=0，`/tmp/batch3-faninsuite3.log`，2026-08-03；
      含本任务合并代码 + store.ts 类型修复）。scoped 实测 17/17 通过（6 governance + 11 engine），
      静态检查全部 PASS。此前 batch-tokenwait 套件 fail 2（serve.test.mjs + provider-env-symmetry）
      经判别为负载 flake（当前窗口重跑 2/2 绿），非本任务。
- [x] 任务体保留本次**定性更正的全过程**（原标题、原规模、被什么实测推翻）——
      **一个只留结论不留更正的任务体，下一个人会重走一遍同样的误判**

## Touches

- scripts/test.sh
- plugin/scripts/heavy-op-token.sh
- plugin/test/heavy-op-token.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T20:55:00Z
changed: **本任务由管理者纠正定性后重写，标题与文件名一并更改**（原
`gap-a-token-held-by-nobody-can-starve-a-live-waiter`）。外层原判「无界饥饿 + 需要令牌公平性重设计」
**被两组实测推翻**：管理者实测 mtime 292s 时 `--acquire` 当场回收（`reclaim #17`、`waited_ms=0`）；
外层重算自己的日志，**12 次尝试里只有 2 次死在令牌上，3 次真跑完**（其中 suite9 `fail 0`）。
**外层原推送里「12 次尝试」「永远抢不到」两句都是夸大，已在任务体逐条更正。**
**但有一条顶了回去并被实测支持**：管理者说「那个等待者在已发布的代码里不存在」，
而 `scripts/test.sh:237` 是已发布代码里的真实等待者——它走 `--acquire`，
**只是传了 `--timeout 0`，一秒都不等就 `exit 1`**。所以剩下的缺陷不是纯观测面：
**唯一的真实等待者把一个上界 30 秒的瞬态放大成一次失败的套件运行**，
今晚内层的反复重试与外层的升级误判都源于这一行。
**规模按管理者的裁定大幅缩小**：不做公平性/排队，只给唯一的等待者一个有界等待 + 改失败文案。
**AC3 是真判据**：把「拒绝等待」换成「误抢正在跑的重活」是更坏的交易。
**AC1 不许跳过**：若 `--acquire --timeout N` 底层根本不重试，改参数就是又一次「存在≠生效」。
