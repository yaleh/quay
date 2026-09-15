---
id: gap-release-run-tests-hangs-on-shared-mcp-client-leak
title: mcp-server.test.mjs 的共享 MCP client 在断言失败路径上不关闭 ⇒ release 的 Run tests
  泄漏子进程、node --test 永不退出撞 30m job 超时（AC-266 静态臂 + hang 根）
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-266
---
**type:** execution

## Finding

**直接量（本机 2026-09-15 复现，不是推断）**——把 release job 的测试步逐字搬下来、去掉 token 跑：

```
env -u GH_TOKEN -u GITHUB_TOKEN -u QUAY_TEST_LIVE_GITHUB timeout 150 \
  node --test packages/quay/test/mcp-server.test.mjs
→ exit=124（150s 内没有退出）
→ ℹ tests 1 / pass 0 / fail 0 / cancelled 1 / duration_ms 149941
→ ✖ 'Promise resolution is still pending but the event loop has already resolved'
```

**结构根因（一条，不是两条）**：该文件在 `:227` 起**一个共享 client**（`connectStdio("node", [coreBin, "mcp"], workspaceRoot)`），
直到 `:1358` 才 `await core.close()`，中间 ~1130 行**没有任何 try/finally**（`grep -c finally` = 0）；
而 `:486-489` 的注释把「`core` is deliberately NOT closed here」写成了**有意设计**。
⇒ **任何一个块抛异常**都会跳过 `:1358` 的 close ⇒ `quay mcp` 子进程（及其自己的 provider 子进程）继续活着
⇒ stdio handle 吊住事件循环 ⇒ `node --test` 永不退出。这正是本仓已知的 `detached-test-child-leak-hangs-suite` 形态。

**release job 里的触发点是哪一条**：v0.6.2 / v0.6.3 的日志停在 `task_list via quay mcp (provider=github)` →
`TypeError: Cannot read properties of undefined (reading 'tasks')`（`:530`）。
`:492-572` 的 block 10 打真实线上 `yaleh/quay` issue，**却没有 opt-in 闸**——同文件 `:24-28` 的头部注释自称
「so the test suite has zero external-network dependency」，`release.yml:65-68` 也自称「live-GitHub tests
self-skip unless opted in」，**两处对本块都为假**。而 `release.yml:70-79` 按设计不传 `GH_TOKEN`
⇒ 该调用失败 ⇒ `tl.structuredContent` 为 undefined ⇒ `:530` 的裸 deref 抛 ⇒ 泄漏 ⇒ hang。
实测量级：v0.6.2 = 30m21s、v0.6.3 = 30m17s，撞 `timeout-minutes: 30`，其中 26 分钟零输出。

**⚠️ 关键：本机的首个抛点不是 block 10，是 `:461`**（`dir.total`——block 7b 的 `instrument` 调用在本机返回 isError）。
两者形状逐字相同，这恰好证明**根因不是「github 块写错了」，而是「共享 client 在失败路径上不关闭」**：
只给 block 10 加闸能让 AC-266 的静态臂转真，**但关不掉 hang 根**——本机这一跑就是反例（闸还没轮到它，它已经挂在 7b 了）。
⇒ 修法必须两条都做，其中第 1 条是根、第 2 条是触发点。

**5b 扫描（同一载体内还有几处，先数再改）**：release job 的 glob = `packages/quay/test/*.mjs` + `packages/quay-native/test/*.test.mjs`，共 **250** 个文件。
- spawn stdio MCP client（`connectStdio`）的 = **6** 个：acceptance / acceptance-env / core-three-way-symmetry / **mcp-server** / **mcp-gate-dryrun** / provider-abi-conformance。
- 其中**一处 `finally` 都没有**的 = **2** 个：`mcp-server.test.mjs`（finally=0）、`mcp-gate-dryrun.test.mjs`（finally=0）；其余 4 个有 1–5 处。
- glob 内**真的会打线上 GitHub**（真仓 `yaleh/quay` 且无 opt-in 闸）的 = **1** 个，即 block 10；
  另 4 个提到 `yaleh/quay` 的文件是本地字符串夹具，已逐条打印确认（`live-b-provider-env.test.mjs:49` 是 config env 夹具、`config-validate.test.mjs:1261` 是注释）。

**为什么这是 release 渠道的结构性风险**：该 job 的产物是 npm .tgz，而 glob 里**任何**一次「失败 ⇒ 泄漏」
都会把「一条 red」变成「30 分钟零输出后 cancel」——门从「能报红」退化成「不报任何东西」。

<!-- dedup-ref -->
**查重（按机制）**：`gap-release-timeout-10min-cancels-npm-tgz`（done）当时把 `timeout-minutes` 10→30 是对的（那次的坑是正常时长超限），但它把 hang 的代价从 10 分钟放大到 30 分钟——它治症状，本条治根；`gap-create-test-mjs-suite-context-hang-after-create-mcp-fix`（done）是全量套件并发下另一个文件（`packages/quay-github/test/create.test.mjs`）的 spawn 竞争挂死、solo 绿，机制是并发争抢而非失败路径不 close；`gap-runner-no-kill-on-red-and-no-max-runtime-hang-leak`（done）的对象是本地 full-suite-runner 而不是测试文件。三条同族，都不含「release job 测试步 + 共享 client 无 finally + live 块无闸」这条链。

## Requested action

1. **`mcp-server.test.mjs`：让共享 client 的生命周期异常安全。** 把 `:227`→`:1358` 的整段块序列包进
   `try { … } finally { await core.close(); }`，并让**每个块自己的 client**（`coreGh` / `coreBroken` / `corePrefix` /
   `coreSchema` / `coreSrch` / `corePag` / `coreMlt` / `coreQx42` / `coreGate` / `coreEnv`）同样走 `try/finally`。
   ⛔ 要的是「**所有路径都 close**」这条性质，不是「happy path close 了」；`:486-489` 那句
   「deliberately NOT closed here」的注释必须一并改写，否则下一个人还会照它办。
2. **block 10 加 opt-in 闸——⚠️ 形状有硬约束（已实测，见下）。** 复用本仓既有常量（`cli.test.mjs:189-190` 的
   `LIVE_GITHUB_ENV = "QUAY_TEST_LIVE_GITHUB"` + `liveGithubEnabled`），但 AC-266 判据的 `guarded` 是
   **逐物理行 + 剥 `//` 注释 + 大小写敏感**地判的：该行必须**同时**命中
   `(GH_TOKEN|GITHUB_TOKEN|QUAY_TEST_LIVE_GITHUB)` 与 `(skip|return|t\.skip|it\.skip|describe\.skip)`（**无 `re.I`**）。
   实测四种写法（已逐条跑过判据谓词）：
   ```
   ✅ `if (!liveGithubEnabled) { console.log("SKIP: … opt in with QUAY_TEST_LIVE_GITHUB=1"); return; }`  → 一行内 token+return，MATCH
   ❌ 同一句拆成多行                                   → 每行都不同时含两者，不 MATCH
   ❌ `if (process.env[LIVE_GITHUB_ENV] !== "1") { … return; }` → 该行没有字面量 QUAY_TEST_LIVE_GITHUB，不 MATCH
   ❌ `// QUAY_TEST_LIVE_GITHUB controls …; it returns early`     → 注释被剥掉，不 MATCH
   ```
   ⇒ **守则写成一物理行，且行内出现字面量 `QUAY_TEST_LIVE_GITHUB` 与小写 `return`**；`SKIP` 大写不匹配 `skip`，别指望它。
3. **⛔ 不要改成让 `release.yml` 委托 `scripts/test.sh`。** 判据的静态臂是 OR（两条任一条即可），而 `release.yml:59-63`
   明确按设计收窄 glob（排除 `packages/quay-github`——那些测试要更宽的 org 权限）；改成委托**会改变这个门的语义**
   （放进来一批它故意不要的测试），等于用一个更大的改动去满足一条 OR 判据。走第 2 条。
4. **5b：同形处一并处理**——`mcp-gate-dryrun.test.mjs`（glob 内、`connectStdio`、finally=0）给同样的 try/finally；
   它本地-only、没有 live 触发点，但失败路径泄漏的机制逐字相同。
5. **加机械防回归产物**（硬规则 9：没有产物就只能靠意志）：新增 `plugin/scripts/release-test-client-close-check.ts`——
   位置判定（先剥 `//` 注释）从 `release.yml` 的 `Run tests` 实际 run 命令取 glob，逐个文件断言「每个
   `const { client: X } = await connectStdio(…)` 绑定的 `X` 在该文件里有 `finally` 内的 `X.close()`」；
   **解析不出 ⇒ `NOT-EVALUATED` 独立取值**（硬规则 3b，⛔ 不与「合格」同形）；违规 ⇒ 非零退出并给出行号。
   按本仓对新 checker 的四件义务同时登记：catalog 六表 / `runner-static-gate.ts` 的 `run_static_checks`（带
   `# @static-tier` + `# @static-object`）/ `checker-mutation-cases/release-test-client-close-check.sh` / 把该函数上的
   `# @checker-count` 注解 +1（`checker-count-drift-check.ts` 会机械核对，别只在散文里改）。

## Acceptance Criteria

- [x] AC1（静态臂，按位置判定）：逐字跑 AC-266 判据的静态两半——`unified = any("scripts/test.sh" in ln.split("#", 1)[0] for ln in wf.splitlines())` 与 `guarded`（剥 `//` 后同一物理行同时命中 token 名与 skip/return）——**`unified or guarded` 为真**。⛔ 报数前先打印 `unified` / `guarded` 两个布尔与命中的前 3 行（硬规则 2：裸子串在本文件恒真——`scripts/test.sh` 出现 3 次全在注释里，且注释说的是「不委托给它」）。立案基线（本机实测）：`unified=False, guarded=False`。**实测：`unified=False`（3 处 `scripts/test.sh` 剥注释后全为空串，逐条已打印）、`guarded=True`（`mcp-server.test.mjs:564` 一行内同时含字面量 `QUAY_TEST_LIVE_GITHUB` 与小写 `return`），`unified or guarded = True`。**
- [x] AC2（hang 根的直接量，本任务核心，必须能取假）：`env -u GH_TOKEN -u GITHUB_TOKEN -u QUAY_TEST_LIVE_GITHUB timeout 300 node --test packages/quay/test/mcp-server.test.mjs` **exit ≠ 124**，且 node:test 摘要**不再是 `cancelled 1` / `pass 0 fail 0`**，而是一个**已决结论**（`fail 0` 且 `pass ≥ 1`，或干净 `fail ≥ 1` 且 exit 1）。修前基线（本机实测）：`exit=124` / `cancelled 1` / `duration_ms 149941` / `'Promise resolution is still pending but the event loop has already resolved'`。**实测（本任务 worktree、merge develop 之后、逐字命令）：`rc=0` / `pass 1` / `fail 0` / `cancelled 0` / `duration_ms 9471`；同一命令在 CI 等价环境（`GH_CONFIG_DIR` 指向空目录 ⇒ `gh` 未认证）下同样 `rc=0` / `pass 1` / `fail 0` / `cancelled 0`。⚠️ 该逐字命令在本机【修前也是 rc=0】——本机 `gh` 已登录（`gh auth status` = `✓ Logged in to github.com account yaleh`），env 变量不是闸、凭据库才是；故「修前 124」只能用 CI 等价环境复现，矩阵见 Evidence。**
- [x] AC3（负控制，必须给出**相反预测**才算做，硬规则 4 推论四）：把第 2 条（block 10 的闸）**单独回退**、保留第 1 条（try/finally），同一条命令必须得**不同**结果——run 以**干净 FAIL + exit 1 退出**（rc=1，不是 124）。这同时证明两件事：①泄漏路径确由第 1 条关闭；②AC2 测的是 finally 本身，而不是那条闸。两次读数（带闸 / 去闸）的 rc 与 node:test 摘要都要贴出。**实测（闸单独回退、finally 保留、CI 等价环境）：`rc=1`（不是 124）/ `pass 0` / `fail 1` / `cancelled 0` / `duration_ms 4711`；抛点与修前逐字相同（`TypeError: Cannot read properties of undefined (reading 'tasks')`）。对照同环境下修前 `rc=124` / `cancelled 1` / `149946ms`。另做 DoD 那半边的反证：保留闸、只去掉 `finally`、把 block 10 强制跑起来 ⇒ `rc=124` / `cancelled 1` / `149936ms`（重新 hang 回去）。**
- [x] AC4（5b，修完贴数）：在 250 文件的 glob 里重跑本 Finding 的三条计数，`connectStdio` 有而 `finally` 无的文件数由 **2 → 0**；并把扫描命中数与前 3 条命中逐条贴出，⛔ 不是「修好我看到的这一个」。**实测：glob=250（与 Finding 一致）；`connectStdio` 有而 `finally` 无 2 → 0（修前 `mcp-server.test.mjs`、`mcp-gate-dryrun.test.mjs`；修后为空）。⚠️ 位置判定下 `connectStdio` 作为【定义的 helper】只在 **4** 个文件（core-three-way-symmetry / mcp-gate-dryrun / mcp-server / provider-abi-conformance），Finding 的 **6** 是按关键词数出来的——`acceptance.test.mjs:415` 与 `acceptance-env.test.mjs:8` 只出现在注释里，正是判据头注释警告的那种假阳性。更宽的一遍（真 spawn stdio 子进程 = 代码里出现 `StdioClientTransport`，剥注释）：**16** 个文件，其中 5 个无 `finally`，但它们**全部用 node:test `after()` 钩子**（异常路径同样执行）⇒ 机制安全、不是缺陷。真打线上 `yaleh/quay` 且无闸的 = 1 → 0（`config-validate.test.mjs` 唯一一处是 `:1261` 的注释，已逐条确认）。**
- [x] AC5（机械产物能取假）：`release-test-client-close-check.ts` 存在且①在**故意去掉某文件 finally** 的变异下非零退出并打印该文件与行号（把原文件换回 ⇒ exit 0）；②对解析不出的输入返回 `NOT-EVALUATED`（与 exit 0 可区分）。四件登记义务齐备，且 `bash plugin/scripts/capability-catalog.sh --summary` 的自报脚本数与登记一致。**实测（真树，非夹具）：基线 `exit 0`（`files scanned 250 … bindings checked 13, NOT judged 4`）；把真文件 `mcp-server.test.mjs` 里 `coreGh` 的 `finally` 删掉 ⇒ `exit 1` 且打印 `packages/quay/test/mcp-server.test.mjs: 'coreGh' bound at line 555 is never closed inside a finally`；换回 ⇒ `exit 0`；`--root` 指向无 workflow 的目录 ⇒ `exit 3 NOT-EVALUATED`（与 0、1 均可区分）。四件义务齐：catalog 六表 / `run_static_checks`（`@static-tier change` + `@static-object`）/ mutation case / `@checker-count` 61→62；`--summary` = `334 scripts | 334 declared | 0 unclassified | 329 ship`。**
- [x] AC6（scoped 门）：`bash scripts/test.sh --for-task gap-release-run-tests-hangs-on-shared-mcp-client-leak` 绿。⛔ 只跑 scoped 不足以证明 AC2 的命题——AC2/AC3 的两条直接量是独立证据，两者都要。**实测：先 `git merge --no-edit develop`（`Merge made by the 'ort' strategy`，无冲突），再跑 `--allow-thin` ⇒ `rc=0`。`--allow-thin` 是因为选择器报 `tests for 3/7 Touches entries (0.43) < 0.5`（7 条 Touches 里 3 条是新增文件、无测试映射），是选择宽度告警不是失败。**

## Definition of Done

- [x] AC1–AC6 全勾，**且 AC2 的读数是在本任务 worktree 上、用上面那条逐字命令**跑出来的（本文的立案基线只作「修前」对照保留，不作「修后」证据）。
- [x] **REAL LANDING（DIR-026 Reading A）**：判据不是「测试文件里加了几行」，而是**那条会 hang 的命令现在会退出**，且**去掉 finally 能让它重新 hang 回去**——AC3 / AC5 的变异控制操作的就是这个对象本身，不是描述它。**两条变异控制都跑在真树/真命令上：AC3 去掉闸 ⇒ rc 124→1；DoD 控制去掉 `finally` ⇒ 重新 rc=124（149936ms）。**
- [x] **AC-266 的载体臂如实交代**：AC-266 判据还有第二半——`.quay/ci-runs.jsonl` 里存在一条 `ts` 晚于修复落地、且未因 job 超时被杀的 release run。本任务**不生产该载体**（它的生产者是 AC-265 的 `plugin/scripts/ci-runs-collect.ts`；触发一次真实 release run 属 AC-268 的范围）。⇒ 收口时若载体仍不存在 / 仍无 post-fix release run，**如实记为「静态臂已闭合、载体臂待一次真实 release run」**，⛔ 不伪造一条记录去骗 AC-266，也不把这条缺口说成已完成。**如实记录：`.quay/ci-runs.jsonl` 仍不存在，无 post-fix release run ⇒ 静态臂已闭合、载体臂待一次真实 release run。未伪造任何记录。**
- [x] 负控制留档：AC3 的两个 rc 与 node:test 摘要、AC5 的变异/还原两次读数，落 `.quay/` 下一个证据文件并在本任务的 Evidence 段引用。

## Evidence

`.quay/ac266-release-client-close-evidence.md`（实现提交 `630a10414`，worktree `gap-release-run-tests-hangs-on-shared-mcp-client-leak`）。

**两因子控制矩阵**（同一条逐字命令，只差 where the table says）：

| # | finally | 闸 | env | rc | node:test 摘要 |
|---|---|---|---|---|---|
| A | ✗ | ✗ | CI 等价（`gh` 未认证） | **124** | `pass 0 / fail 0 / cancelled 1`，`149946ms` |
| B | ✓ | ✗（闸单独回退 = **AC3**） | CI 等价 | **1** | `pass 0 / fail 1 / cancelled 0`，`4711ms` |
| C | ✓ | ✓（**AC2 逐字命令**） | 本机（`gh` 已登录） | **0** | `pass 1 / fail 0 / cancelled 0`，`9471ms` |
| D | ✓ | ✓ | CI 等价 | **0** | `pass 1 / fail 0 / cancelled 0` |
| E | ✓ | ✓ | `QUAY_TEST_LIVE_GITHUB=1` + 已登录 | **0** | `pass 1 / fail 0`；github 断言**跑了**（闸不是永久禁用） |
| G | ✗（只去 finally） | ✓ | CI 等价 + 强制 opt-in | **124** | `pass 0 / fail 0 / cancelled 1`，`149936ms` |

**必须记下的一条取证更正**：AC2 的那条逐字命令在本机**修前也返回 `rc=0`**（本机 `gh` 已登录，env 变量解不掉凭据）；它取假的能力来自「CI 等价环境」那一维。A/B/G 三行都在 `GH_CONFIG_DIR` 指向空目录下取得，A 与立案基线逐字一致（`cancelled 1` / `149946ms` / 同一句 `Promise resolution is still pending`）。

**本任务未覆盖、已如实记录的兄弟实例（硬规则 5b，⛔ 未扩入本任务范围）**：`provider-abi-conformance.test.mjs` 的 `const nativeClient = await connectStdio(…)`（`:151`，close 在 `:247`）与 `const githubClient = …`（`:256`，close 在 `:510`）是同一缺陷形状的**非解构**绑定，新检查器的谓词按任务书只判解构形式，故**抓不到**——该缺口已作为检查器的 declared blind spot 写进它的头注释并**每次运行都打印计数**（`NOT judged 4`），留作后续任务。

## Touches

- packages/quay/test/mcp-server.test.mjs
- packages/quay/test/mcp-gate-dryrun.test.mjs
- plugin/scripts/release-test-client-close-check.ts (new)
- plugin/scripts/capability-catalog.sh
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/checker-mutation-cases/release-test-client-close-check.sh (new)
- tasks/gap-release-run-tests-hangs-on-shared-mcp-client-leak.md
