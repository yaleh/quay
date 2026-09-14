---
id: gap-closure-lag-driver-runtime-promotion-hardcoded-wallclock-margin
title: 三个测试文件的硬编码墙钟余量在负载下击穿（closure-lag-check / driver-runtime / promotion-driver）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

**轮次**: 2026-09-13 round 3（worker，gap-goal-sufficiency-prompt-blind-to-scope 任务的 fan-in）
**结论**: 该轮 fan-in 全量 suite 的 3 条红与该任务的 delta 无关，是**负载相关的墙钟余量脆测**
（load-correlated wall-clock-margin flake）——三个测试文件各自把一个墙钟余量写成了硬字面值，
在高并发负载下文件自身运行时间变慢 2–3 倍即可击穿该余量。

### 1. 失败的三条（全部来自 `~wk-prod-1789139008~1789320730372-59df6c.log`）

| 测试文件 | 断言 | 失败文本 | 该文件本轮用时 | 同 lineage 绿跑用时 (ac252, 1789317948862) |
|---|---|---|---|---|
| `plugin/test/closure-lag-check.test.mjs:171` | `\|parsed.ranAt - nowEpoch\| < 60` | `trace timestamp is fresh` | 116s | 27s |
| `plugin/test/driver-runtime.test.mjs:617` | `start > Date.now() - 60_000` | `procStartTimeMs 合理` | 139s | 36s |
| `plugin/test/promotion-driver.test.mjs:636` | `r.exitCode === 3`（`spawnFixWorker(..., 5000)`） | `exit code recorded` | 222s | 70s |

三条形状完全相同：一个写死的墙钟余量（60s 模块加载余量 ×2、5000ms spawn 超时 ×1），被「文件本身
在并发下降速 2–3 倍」击穿。三条都不在触发该轮 fan-in 的原任务 Touches 内
（原 Touches = `goal-driver.ts` + 2 个 goal-sufficiency 测试）。

- `closure-lag-check.test.mjs:90` 的 `nowEpoch` 在模块加载时取值，断言要求 `--record` 的
  写入时刻落在其后 60s 内 ⇒ 该文件只要跑超过 60s 必红（本轮 116s，绿跑 27s）。
- `driver-runtime.test.mjs:617` 用 `procStartTimeMs(process.pid)` 与 `Date.now()-60_000` 比 ⇒
  测试进程自身存活超过 60s 必红（本轮文件 139s）。
- `promotion-driver.test.mjs:636` 给 `spawnFixWorker` 传死字面 `5000` ms 超时 ⇒ 并发下子进程
  超过 5s 即判超时，`exitCode` 不是 3（本轮文件 222s）。

### 2. 判别性对照（硬规则 4 推论四：造一个能区分的对照）

**对照 A（隔离运行，delta 在两条件中都存在 ⇒ delta 不可能是差异源）**
在同一个 worktree、同一个 delta 下单独跑这三个文件：

```
node --test plugin/test/closure-lag-check.test.mjs plugin/test/driver-runtime.test.mjs plugin/test/promotion-driver.test.mjs
⇒ exit 0，fail 0；三条具体测试全部 ✔
   ✔ AC3 — --record --flipped N writes timestamp + flip count; measure reads it fresh (2461ms)
   ✔ supervisor-stale — supervisorStaleness 三态 (8.26ms)
   ✔ gap-fix-worker-spawn-timeout-persists-post-fix AC4 — failure record carries argv + durationMs + exitCode (279ms)
```

⇒ 同一份代码，并发=22 时红、隔离时绿 ⇒ 差异源是负载，不是 delta。

**对照 B（跨轮次）** 同一 develop lineage 的近期 fan-in 跑：

| 跑 | tests | fail | closure-lag | driver-runtime | promotion-driver |
|---|---|---|---|---|---|
| ac252 `1789317948862` | 4760 | 0 | 27s | 36s | 70s |
| 触发本条 finding 的任务 `1789320730372` | 4760 | 3 | 116s | 139s | 222s |

同一 develop 内容、同一测试总数（4760），三条在 ac252 全绿。

**对照 C（跨任务：flake 非某单一任务独有）** 近期每次 fan-in 都至少一条红，且每次红的测试都不同：

```
ac252                                → 0 fail
quay-init-profiles 1789305506637     → packages/quay/test/install-config-driven-e2e.test.mjs:300
observation-hard  1789293616079      → plugin/test/driver-runtime.test.mjs:716   ← 同一文件、另一条断言
goal-driver-ring  1788723279654      → packages/quay-native/test/relation-sync.test.mjs
closure-ratchet   1788712293864      → serve.test.mjs + cap-from-gate-{cli,bands,config-budget,hysteresis}
writestate-atomic 1788699165902      → plugin/test/writestate-atomicity-split.test.mjs
```

不同的测试每次失败是负载相关 flake 的签名；`driver-runtime.test.mjs` 在别的任务的跑里
（:716，另一条断言）也红过 ⇒ 与触发本条 finding 的那个具体任务的 delta 无关，可由第三方任务复现。

### 3. 机械 delta-relatedness 与实测一致

该轮 driver 给出的提示判这三个文件对触发任务 = `UNRELATED`（不在 Touches/diff，direct import
不相交）。上面的对照 A/B/C 独立证实了这个提示——没有采信提示本身。

### 4. 现状核查（立案时补做，`known-load-sensitive.ts` 注册表当前未覆盖这三个文件）

```
$ node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --list | grep -E "closure-lag-check|driver-runtime|promotion-driver"
（无输出，exit 1）
```

三个文件头部均无 `// @load-sensitive` 或 `// KNOWN-LOAD-SENSITIVE` 注解。三条断言把墙钟余量写成
了硬字面，与 CLAUDE.md 硬规则 4 推论二同族（「依赖宿主/负载状态的字面值」）。

## AC

- [x] `closure-lag-check.test.mjs` 的 fresh-timestamp 断言（现 `:171` 附近）不再依赖固定 60s 模块
      加载余量——`nowEpoch`（或等价基准）改为在断言前取值，或改为 `parsed.ranAt <= Date.now()`
      一类不设余量上限的比较，语义（"记录是刚刚写的"）不变；`node --test plugin/test/closure-lag-check.test.mjs` 单独跑 exit 0
- [x] `driver-runtime.test.mjs` 的 procStartTimeMs 断言（现 `:617` 附近）改为与测试进程实际启动
      时刻比较，不再使用硬编码 `Date.now() - 60_000`；`node --test plugin/test/driver-runtime.test.mjs` 单独跑 exit 0
- [x] `promotion-driver.test.mjs` 传给 `spawnFixWorker` 的超时字面值（现 `:636` 附近的 `5000`）
      改为在正常负载下不会误触发超时的宽松值，或断言改为「exitCode===3 或 timedOut 均可、但
      argv 逐字校验」；`node --test plugin/test/promotion-driver.test.mjs` 单独跑 exit 0
- [x] 三个文件的最终状态在 `known-load-sensitive.ts --list` 输出与 DoD 里的落地方式一致——若选择
      「消除硬编码墙钟依赖」（AC 前三条）则三个文件可以不进入该注册表；若改为「登记为已知负载
      敏感」则三个文件头部须新增 `// @load-sensitive wall-clock`，且
      `node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --check` exit 0
- [x] 落地后至少一次全量 fan-in suite 跑（`verification-round.jsonl` 等价载体，落地提交之后的轮次，
      按硬规则「推论三」窗口约束）里，这三个测试文件不再出现在该轮失败列表中——若立案时尚无
      该轮次，在 DoD 里明确记录「待下一次 fan-in 验证」并给出如何核验的命令，不得用隔离跑代替

## DoD

真实落地 = 上述三个测试文件（或注册表二选一路径里被登记的文件头部）的改动实际合入 develop
（`git show develop:plugin/test/closure-lag-check.test.mjs` 等命令能看到改动后的内容），而不仅
是本任务体里写了修复方案。落地后必须有至少一次真实 fan-in 全量 suite 跑经过这三个文件且不再
因本条描述的墙钟余量问题失败（隔离跑绿只是必要非充分条件，不能替代生产载体上的验证——同硬
规则「推论三」：只能被 fixture/单独隔离满足的判据不是测量）。

### 落地记录（worker 提交；合入 develop 由 fan-in 完成）

- 实现提交：`2665cbf1d` — 分支 `task/gap-closure-lag-driver-runtime-promotion-hardcoded-wallclock-margin`
- 三处修法（语义不变，只换基准）：
  1. `closure-lag-check`：模块加载常量 `nowEpoch` → 用时取值 `epochNow()`；AC3 的 fresh 窗口改由
     `--record` **调用前后各取一次读数**夹住（`beforeRecord <= ranAt <= afterRecord`）——比原来的
     单边 60s 余量**更强**（双侧夹逼），且与文件跑多久完全解耦。
  2. `driver-runtime`：`start > Date.now() - 60_000` → 与**本进程实际启动时刻**比（`process.uptime()`
     推导），容差 10s。负控制（落笔当轮实测）：两个读数相差 **0.14ms**，而「返回 now」的回归会偏
     一个完整进程年龄（本文件内 ≈90s）⇒ 判据能取假，不是恒真。
  3. `promotion-driver`：`spawnFixWorker(argv, root, 5000)` → 生产默认 `FIX_WORKER_TIMEOUT_MS`（180s）
     ＋ 显式 `timedOut === false` 断言，与相邻 `runFixPass` 测试一致；超时路径仍由后一条
     `sleep 5` / 200ms 用例覆盖（该用例负载安全：`sleep 5` 在任何负载下都超 200ms）。
- 隔离跑（必要非充分，⛔ 不是 AC5 的满足条件）：closure-lag-check **18/18**（41s）·
  driver-runtime **27/27**（93s）· promotion-driver **41/41**（118s），各自 exit 0。
  （注意 driver-runtime 隔离跑本身就 93s > 旧断言的 60s 上限 ⇒ 旧判据在本机已处于必红边缘。）
- 注册表路径核查：`known-load-sensitive.ts --list` 命中这三个文件 = **0**；`--check` exit 0。
  选的是 AC 允许的「消除硬编码墙钟依赖」路径 ⇒ 三文件不进注册表，且**不加**
  `@load-sensitive` / `@test-group-downgrade`（两者都会 stale：负载依赖是被**移除**而非**换址**）。
- 硬规则 5b 扫描（同一载体里的同原则其它适用点）：三文件内
  `grep -nE '[<>]=? *(Date\.now\(\)|[0-9_]{3,})|timeout: *[0-9_]+'` 命中 **29** 条，前 3 条 =
  driver-runtime `:104` `timeout: opts.timeout || 30000`（`run()` 默认）·
  `:363` `run(["stop"], { timeout: 15000 })` · `:689` 夹具 `if (Date.now() - first < 3000) process.exit(1)`。
  **评估后不改**：两条 `>=`/`<` 是**下界**（越忙读数越大，负载不可能击穿），`timeout:` 是**杀进程
  的死线**（有限挂起保护）而非余量。其中 `driver-runtime:410` 的 `start failed:`（30s `run()` 默认
  被杀）是已知宿主负载形态 (c)（见 memory `driver-runtime-ac4-confirmed-ms-asserts-step1-walltime`），
  **发生率 = 1**，且在 1688 轮载体里**从未作为失败断言行出现** ⇒ 按硬规则 12 记为本任务的
  **观察项**，不据此放宽一条挂起保护死线（改它需要逐个分析 ~20 处 spawnSync 站点）。**此处登记，
  不是静默忽略。**

### AC5 的第二分支（本任务按 AC 原文的分支条款执行）

AC5 原文自带分支：「若立案时尚无该轮次，在 DoD 里明确记录『待下一次 fan-in 验证』并给出如何核验
的命令」。本任务的落地提交只能由 driver 在我退出后合入 develop ⇒ **写这一行时结构上不存在
「落地之后的轮次」**，故按该分支执行：**待下一次 fan-in 验证**。⛔ 上面那三行隔离跑**不能**代替它
（硬规则推论三：只能被隔离跑满足的判据不是测量）。

核验命令（落地后在下一次 fan-in 之后跑，读的**生产载体**是 `.quay/verification-round.jsonl`，
⛔ 不是隔离跑；三态：无轮次 / 没跑到 / 通过 三者可区分，⛔ 不把「没跑到」读成「通过」）：

```bash
LAND=2665cbf1d   # 本任务实现提交（落地后 git log --grep 可重新定位）
python3 - "$LAND" <<'PY'
import json, subprocess, sys
land = sys.argv[1]
names = ('closure-lag-check.test.mjs', 'driver-runtime.test.mjs', 'promotion-driver.test.mjs')
def after(c):
    return bool(c) and subprocess.run(['git','merge-base','--is-ancestor',land,c],
                                      capture_output=True).returncode == 0
rounds = [json.loads(l) for l in open('.quay/verification-round.jsonl') if l.strip()]
cand = [r for r in rounds if after(r.get('commit'))]
if not cand:
    print('NOT-EVALUATED: 还没有「落地之后」的轮次（⛔ 不等于通过）'); sys.exit(3)
r = cand[-1]
pf = [p for p in (r.get('perFile') or []) if any(n in str(p.get('file','')) for n in names)]
bad = [p for p in pf if p.get('passed') is False]
print('round=%s commit=%s perFile_hits=%d' % (r.get('round'), str(r.get('commit'))[:12], len(pf)))
for p in pf:
    print('   %s passed=%s durationMs=%s' % (p.get('file'), p.get('passed'), p.get('durationMs')))
if not pf:
    print('NOT-EVALUATED: 这三个文件在该轮根本没跑到（⛔ 不等于通过）'); sys.exit(3)
print('PASS — 三个文件本轮均 passed=true' if not bad else 'FAIL — %s' % bad)
PY
```

判据能取假：若这三个文件在下一次 fan-in 里**又**因墙钟余量红，上面命令输出 `FAIL` 并列出该文件
的 `durationMs` ⇒ 说明本次修法是**回归**，本任务应 `quay retreat` 而非当作已修好。

### 阻断记录（2026-09-14 worker 轮 · 第二次 `exited-not-landed`：suite 恒红**非本 delta**，已确证）

本轮 fan-in 的 `step=suite` 唯一红点**不在本任务 Touches 内**（是另一个已单独立案的文件）：

```
✖ AC3a' @ plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs:190
  AssertionError: 配置路径必须落在 quay 安装树下（⛔ 非 workspace root）
```

**两向对照（一条命令，差别只在环境）** —— worktree 内、同一文件、同一命令：

| 环境 | 读数 |
|---|---|
| `QUAY_PLUGIN_ROOT=/home/yale/work/quay/plugin` | `tests 6 / pass 5 / fail 1` ⇒ `✖ AC3a'` @ `:190` |
| `env -u QUAY_PLUGIN_ROOT`（同一命令） | `tests 6 / pass 6 / fail 0` ⇒ `✔ AC3a'` |

**「与本次改动无关」的三条独立读数**：① 该文件在本分支与 develop 上**逐字节相同**
（`git diff develop HEAD -- <该文件>` 为空）；② 机械 delta-relatedness 判 `UNRELATED`
（不在 Touches/diff，direct import 不相交）；③ 生产载体 `.quay/verification-round.jsonl` 里
该文件 r1686 及此前**每一轮** `passed=true`，r1688（06:40Z，driver 重启后）起 `passed=false`，
且跨 ≥2 个**互不相关**的任务（r1688 abi-task-list / r1689 fan-in-ts-typecheck / r1690 本任务 /
r1691 ac256 / r1693 ac179）。

**触发量（直接量，⛔ 非其自述）**：`tr '\0' '\n' < /proc/<live worker-driver pid>/environ | grep QUAY_PLUGIN_ROOT`
⇒ `/home/yale/work/quay/plugin`（主检出）；而 `plugin/scripts/suite-driver.ts:176` 以
`env: { ...process.env, … }` spawn 全量 suite ⇒ 该键被继承进**每一个** worktree 套件。

⇒ 已有专属任务在办且已 `needs-human`：`gap-worktree-suite-red-from-quay-plugin-root-override-in-driver-env`
（AC1/AC2 已勾，AC3「生产读数」待外部）。**本条不重复立案、不改该文件** —— 它在 Touches 之外，
改了会自招 anti-drift 常设红；且修法（a 环境面 / b 测试面）的选定权在该任务体里明示属 owning layer。

**本任务自身状态（本轮所做的事）**：实现提交 `2665cbf1d` 仍在分支上，AC 1–5 全勾；
`git merge develop` 干净（本轮并入的 17 个 develop 提交**全部是 `tasks/*.md` 写入，零代码改动**）；
scoped 门（本任务 Touches 选择集）在合并后的 tip 上 **exit 0 / 零 `✖`**。
scoped-gate 缓存按**门实际合并的 tip（`HEAD^2`）**写入 —— ⛔ 不用「写缓存那一刻的 `develop`」：
develop 在本次门运行期间又前进了（`a4086a1b → dd68bcde`），用后者会造出一次**假命中**
（我第一版正是这么写的，已当场改写为 `HEAD^2`；同 memory `scoped-gate-cache-sha-must-be-the-tip-you-gated`）。
⇒ 本任务只差 fan-in 全量 suite 这一步，而它被上述**环境**恒红挡住（与本次改动无关）。

## Touches

- `plugin/test/closure-lag-check.test.mjs`
- `plugin/test/driver-runtime.test.mjs`
- `plugin/test/promotion-driver.test.mjs`
- `plugin/scripts/known-load-sensitive.ts`（仅当选择注册表路径）
- `tasks/gap-closure-lag-driver-runtime-promotion-hardcoded-wallclock-margin.md`
