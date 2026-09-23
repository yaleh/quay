---
id: gap-suite-ambient-reds-block-all-code-landings
title: 全量 suite 的四类环境红挡住一切 code 任务落地——自 2026-09-16 无一次 suite 绿，需一次修完才能破锁
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**这是一个引导自锁，不是一个普通的红。**

ff 闸读 suite 证书并要求 `state === "green"`（`plugin/scripts/worker-fan-in.ts:1588` 起；`readGreenMirrorCommit` 取不到就返回 `""` ⇒ fail-closed）。**红 suite ⇒ 不落地，没有 override。**

实测（`.quay/gate-events.jsonl`，`gate=complete` 事件按日计数）：

| 日期 | 完成数 |
|---|---|
| 09-13 … 09-20 | 19–63/天 |
| 09-21 | 8 |
| 09-22 | 3 |
| 09-23 | 6 |

**本机最后一次 fan-in suite 跑绿 = 2026-09-16 19:08**（`gap-release-softprops-missing-explicit-tag-name`，RESULT: PASS）。此后每一条跑到全量 suite 的 fan-in 日志都是红的（09-16 / 09-21 / 09-23 共 5 条）。而近三日"落地"的 17 个任务，**suite 日志数 = 0** ⇒ 它们走的是 **doc-only / inert delta 跳过 suite** 的路径。⇒ **凡是 delta 需要跑全量 suite 的 code 任务，自 09-16 起全部落不了地。**

**为什么必须一次修完（这是本任务存在的理由）**：下面四类红任意一类单独修，其余三类仍红 ⇒ **那个任务自己的 worktree 内 suite 仍是红的 ⇒ 它自己也落不了地**。所以"每类各立一个任务"在结构上不可能成功（这正是 `gap-suite-entry-inherits-host-locale-and-tz` / `gap-arch-coverage-report-couples-to-archguard-manifest-path-form` / `gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check` 三个任务被本任务取代的原因）。只有一个"worktree 内 suite 为绿"的落地能破锁。

⛔ 四类红**没有一类是"被测代码逻辑坏了"**——它们都是"判据/仪器与宿主环境不一致"。

### 第 1 类 · locale + 时区（3 个文件）

`scripts/test.sh`（唯一测试入口，ADR-019/DIR-109）**不声明 locale 与时区**，直接继承宿主。本机：`LANG=en_US.UTF-8`、`LC_ALL` 空、`TZ` 空（CST）、`TMPDIR=/data/scratch/yale`。
CI 早声明了（`.github/workflows/ci.yml:38-40`：`LC_ALL: C.UTF-8` / `LANG: C.UTF-8`，2026-09-16 `gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red`），但**本地入口与 driver 的 fan-in 仍继承宿主**（硬规则 5b：同一原则只修了 CI 那一半）。

实测（同一 commit，逐字）：

| 文件 | 宿主 env（现状） | `LC_ALL=C.UTF-8 LANG=C.UTF-8 TZ=UTC` |
|---|---|---|
| `plugin/test/laydown-set-check.test.mjs` | 8 pass / 1 fail | **9 / 0** |
| `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs` | 19 / 1 | **20 / 0** |
| `plugin/test/outer-tick-log-check.test.mjs` | 25 / 2 | **27 / 0** |

失败明细是排序 collation / 时区分歧（例：`AssertionError: helper derived set must EQUAL quay-init derive_loop_scripts() (single source, no second list)`，`laydown-set-check.test.mjs:95`；分歧项是 `per-task-suite-record.ts` 与 `precommit-guard.ts` 的落位）。

**只钉 locale 不够**：用 CI 逐字那两条（`LC_ALL=C.UTF-8 LANG=C.UTF-8`）而**不设 `TZ`** ⇒ `outer-tick-log-check` 仍 **25 / 2**；加上 `TZ=UTC` 才 27/0。CI 看不到这一半是因为它的 runner 本身就是 UTC —— 硬规则 4 推论二的形状（「在本机等价于无限制」的宿主属性不是声明）。

### 第 2 类 · TMPDIR（1 个文件，且是生产探测器的盲区）

`plugin/scripts/tmux-leak-scan.sh` **硬编码 `/tmp`**：`:51` `run_root="/tmp/quay-run-${QUAY_RUN_ID}"`，legacy 绝对模式亦在 `/tmp` 下按前缀 glob（`:42-47`、`:89-90`）。而夹具与生产侧都用 `os.tmpdir()`（`plugin/test/tmux-leak-scan.test.mjs:224` `fs.mkdtempSync(path.join(os.tmpdir(), prefix))`）。

本机 `TMPDIR=/data/scratch/yale` ⇒ 夹具与扫描面**指向不同目录** ⇒ 扫描找不到本轮的残留。实测：

| env | 读数 |
|---|---|
| `TMPDIR=/data/scratch/yale`（现状） | 11 pass / **1 fail** |
| `TMPDIR=/tmp` | **12 / 0** |

失败断言：`the scan must FAIL with a private-socket dir present: actual: 0, expected: 1`。

⛔ **这不只是测试问题**：在任何 `TMPDIR ≠ /tmp` 的宿主上，该扫描会**静默报告"干净"**（它看错了目录）——正是硬规则 3b 的形状（读不懂/读错 ⇒ 与"合格"同形）。修法方向不锁定实现，但必须让扫描面与生产侧的实际 tmp 根一致，并保留一条能取假的读数（见 AC7）。

### 第 3 类 · `.archguard` manifest 的 symlink 路径形态（1 个文件）

`plugin/test/arch-coverage-report.test.mjs:255` 断言 `s.sources` 等于 `s.rawSources.map(r => path.relative(MAIN_ROOT, r))`；`MAIN_ROOT = mainCheckoutRoot(REPO_ROOT) || REPO_ROOT`（`:42`），`REAL_MANIFEST = <MAIN_ROOT>/.archguard/query/manifest.json`（`:43`，**机器态、gitignored**）。

该 manifest（实测 mtime `2026-09-20 15:39`）把 7 条 sources 记成 **symlink 形态** `/home/yale/work/quay/...`，而 `MAIN_ROOT` 是 realpath `/data/home/yale/work/quay`（该 symlink 于 2026-09-19 出现）⇒ 两边归一秒不掉。

实测失败原文：
```
actual:   ['packages/quay-backlog/src']
expected: ['../../../../../home/yale/work/quay/packages/quay-backlog/src']
```
⇒ 12 pass / 1 fail（`LC_ALL=C.UTF-8 LANG=C.UTF-8 TZ=UTC`，即已排除 locale 成因）。

⛔ **不得**用"删掉 `.archguard` 让它重新生成"当修法——manifest 会再次按 symlink 形态生成，只是把缺陷推后。

### 第 4 类 · reflog 的 `fetch` 形态（1 个文件）

`plugin/scripts/direct-to-develop-bypass-check.ts` 的分类器**声称**覆盖 `fetch …: storing ref`（`:24` / `:441` / `:479`：`/^fetch\b/ && /: storing ref\s*$/`），`:478` 注释预期 `fetch -q . <sha>:refs/heads/<b>: storing ref`。

但**本仓自己的分支同步机制**（author↔develop 传播）产生的实测形态是：
```
unsupported-reflog-action: fetch -q . author:develop, fetch -q . chore/quay-dev-marketplace:develop
```
即 `fetch -q . <branch>:<branch>`，**不带** `: storing ref` ⇒ 落 unknown ⇒ NOT-EVALUATED。

`plugin/test/direct-to-develop-bypass-check.test.mjs` 的 AC3 回放用例期望 `unclassifiable-commits-in-range`，实得上述串 ⇒ **57 pass / 1 fail**。

⛔ 修法**不得**是往白名单加字符串——本仓自己在该文件 `:1137` 附近逐字写明「⛔ Not a spelling whitelist — a spelling whitelist is structurally blind to the next landing form（这正是 `branch: Reset to HEAD` 破掉 AC-194 的方式）」。

### 第 5 类 · 未注解的负载敏感测试（1 个文件）

**⚠️ 本节结论已更正一次（保留原文以示区别，硬规则 4 推论四）**：立案时本节写的是「未归因（超时/挂起/崩溃未知）」。**该说法已被复测推翻**，真因是我的测量谓词错了，不是测试有问题。

`packages/quay/test/serve-adversarial-eval.test.mjs` 是**真子进程 + 真端口绑定**的测试（实测它会启动 `quay serve` 并监听端口，control plane 与 web 同 pid）。但它**没有 `@load-sensitive` 注解，也不在 `plugin/scripts/known-load-sensitive.ts` 注册表里**。

- **隔离跑是绿的**：`RC=0`、`8 PASS / 0 FAIL`（主检出与 provisioned worktree 两处读数一致）。
- **它不产出 node:test 汇总行**（自带 harness，打印 `PASS: …` 并以 `All M26-adversarial-eval serve.js/provider-client.js fault-injection tests passed.` 收尾）。实测 `grep -cE '^ℹ (pass|fail)'` = **0** ⇒ 用「有没有 `ℹ pass` 行」当谓词读它必然得到 NR。**那是读法错误，不是缺陷**——⛔ 不得把 NR 当成一种失败形态记入本任务。
- **全量并发下它会红**：ac179 那次 fan-in 的 17 个失败文件里包含它 ⇒ 端口绑定在并发下的竞态。

⇒ **这不是「未归因」，是一处注册表缺口**：注册表 `child-spawn` 类的注释里逐字列着「serve（real subprocess + port binding）」，本文件符合该族却未注解 ⇒ 驱动侧 `relatednessSignalsFor` 的 load-sensitive 提示看不见它。修法 = 补注解，**或**让端口分配在并发下不冲突；⛔ 不是发明新机制、也不是把判据放宽。

## AC

- [ ] AC1（第 1 类·复现 + 修后 + 取假）① 贴三个文件在宿主 env 下与 `LC_ALL=C.UTF-8 LANG=C.UTF-8 TZ=UTC` 下的 A/B 读数；② `scripts/test.sh` 中显式 export `LC_ALL`/`LANG`/`TZ`（贴行使与行号）；③ **负控制**：把钉住行注释掉 ⇒ `outer-tick-log-check` 重新变红（贴两次读数）；④ `LC_ALL`/`LANG` 与 `.github/workflows/ci.yml` 逐字一致，并给 CI 补 `TZ: UTC`（或写明 CI 依赖 runner-UTC 的理由）
- [ ] AC2（第 2 类·复现 + 修后 + 取假）① 贴 `TMPDIR=/data/scratch/yale` ⇒ 11/1 与 `TMPDIR=/tmp` ⇒ 12/0 两条读数；② 修后在不改 `TMPDIR` 的宿主 env 下该文件全绿；③ **负控制**：构造一个此前未见过的私有 socket 前缀夹具，扫描仍能报红（证明是"看对了目录"，不是"把判据放宽了"）
- [ ] AC3（第 3 类·复现 + 修后 + 取假）① 贴失败断言 `actual`/`expected` 原文与 manifest 的 mtime、`grep -c '/home/yale/' .archguard/query/manifest.json` 的读数；② 修后该文件全绿；③ **位置判定**：manifest 仍是 symlink 形态（上述 `grep -c` 仍非零）而测试绿 ⇒ 证明是归一生效，不是"机器态碰巧被清理"
- [ ] AC4（第 4 类·复现 + 修后 + 取假）① 贴 57/1 与失败断言的 `actual`（`unsupported-reflog-action: …`）/`expected` 原文，并贴 `git reflog show develop` 中该条目的完整 `%gs`；② 点名 `fetch -q . author:develop` 由哪个机制、哪个文件:行产生；③ 修后该文件全绿，且该形态被**按结构**归类（贴分类结果）；④ **负控制**：构造一个此前未出现过的 `fetch` 变体（如 `fetch -q . <sha>:refs/heads/x`），分类器仍正确归类 ⇒ 证明不是白名单
- [ ] AC5（第 5 类·注册表缺口 + 读法更正）① 贴隔离读数 `RC=0` 与 `8 PASS / 0 FAIL`，以及 `grep -cE '^ℹ (pass|fail)'` = **0** 的直接读数 —— 证明它不是"未归因"而是"读法与它的 harness 不匹配"；② 贴它启动真实 serve 子进程与端口绑定的证据（监听行原文）；③ 修后 `known-load-sensitive.ts` 的输出中包含本文件（贴该行），且全量 suite 中它不再出现在 `passed=false` 行；④ 若最终判定它不应进注册表，须给出**可区分**的替代处置（例如让端口分配不冲突）并贴读数——⛔ 不得以"与本任务无关"直接略过
- [ ] AC6（sources 面完整性，硬规则 5b）除上述 5 个文件外，在同一 provisioned worktree 内系统扫描**同族**（读 `os.tmpdir()`/`TMPDIR` 的、读 symlink 形态绝对路径的、读 reflog action 词的），把命中数与前 3 条贴出；命中者一并纳入本任务或各立任务并贴 id
- [ ] AC7（**破锁判据·本任务存在的理由**）**落地证书 = driver 为本任务跑的那份 fan-in suite 日志**（`.quay/fan-in-suite-<本任务id>*.log`）中 `# fail 0` 且红桶为空——它是决定 ff 能否执行的证书（`plugin/scripts/worker-fan-in.ts:1588` 要求 `state === "green"`，`readGreenMirrorCommit` 取不到即 fail-closed）。⛔ worker **不得自行跑全量 suite**：suite 有单飞锁（`QUAY_MAX_CONCURRENT_SUITES=1`），自行跑会与 driver 的 fan-in 争用，且派发契约明文写着「You do NOT run the suite」。worker 的义务是在自己的 worktree 内**逐文件**验证四类红与第 5 类全部转绿（逐文件不占锁）并把每条读数贴出。⛔ 不得只跑子集冒充全量、不得只跑 scoped 门、不得在钉过 env 的壳里跑（env 必须与 fan-in 实际继承的一致——即修法本身必须让默认入口绿）。该读数的产出时刻在落地之时（待外部）
- [ ] AC8（**生产读数·锁真的开了**）落地后时间窗内，`.quay/gate-events.jsonl` 出现**至少一条** `gate=complete` ∧ `payload.from=ready` ∧ `payload.to=done` 的记录，其任务**不是** doc-only 跳过 suite 的（该任务存在 `.quay/fan-in-suite-<id>*.log` 且其中 `# fail 0`）；贴两条记录的原文与时间戳（均晚于本任务落地提交）。⛔ 这是本任务与"只修好文件"的分界：证明另一个 code 任务真的过了那堵墙。该读数只能在本任务落地之后产生（待外部）
- [ ] AC9 `bash scripts/test.sh --for-task gap-suite-ambient-reds-block-all-code-landings` 绿

## DoD

真实落地：**另一个需要跑全量 suite 的 code 任务在本任务落地之后成功落地，其 fan-in suite 日志 `# fail 0`**（AC8），且本任务自己是在宿主 env（未钉 env）下通过全量 suite 的（AC7）。文件改了、单测绿了、scoped 门绿了都只是必要条件——判据是别人能过墙。⛔ 若 AC8 在窗口内取不到，本任务**不得**翻 done，应在 `## Notes` 记下实测读数与阻塞。

## Touches

- scripts/test.sh
- .github/workflows/ci.yml
- plugin/scripts/tmux-leak-scan.sh
- plugin/test/tmux-leak-scan.test.mjs
- plugin/test/arch-coverage-report.test.mjs
- plugin/scripts/arch-coverage-report.ts
- plugin/scripts/direct-to-develop-bypass-check.ts
- plugin/test/direct-to-develop-bypass-check.test.mjs
- packages/quay/test/serve-adversarial-eval.test.mjs
- tasks/gap-suite-ambient-reds-block-all-code-landings.md