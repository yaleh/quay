---
id: gap-worker-prompt-guards-file-tools-not-bash
title: worker 派发提示的路径护栏只护 Edit/Write 的 file_path，对 Bash 只字未提 —— worker 用 Bash
  脚本硬编码主检出路径即可把整批文件写进 develop 共享检出（2026-09-30 实证），修法=两处 prompt
  模板（buildWorkerPrompt / buildContinueWorkerPrompt）的 CRITICAL 段扩到 Bash
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

**缺口（立案轮直接量，2026-09-30，cwd = 主检出 `/data/home/yale/work/quay`）**

worker `gap-criterion-live-web-address-derivation-17-copies-to-one`（pid 2939914）在 15:58–16:00 之间，
把它那批 17 个文件的重构**写进了主检出**（当时主检出 == `author` == `develop`，0/0 分歧）。

写向量只有一条，逐字可核：它的 Bash 命令块**设对了** `WT=<worktree>`，但脚本里硬编码了主检出路径 ——
`cat > "$WT/tmp/conv.mjs"` 之内是 `const TEST = "/data/home/yale/work/quay/packages/quay/test"` +
`fs.writeFileSync(f, s)`；另有数条内联 `node -e` 用 `const T="/data/home/yale/work/quay/packages/quay/test"`。
**意图是对的，字面量把它废掉了。**（同一 worker 的另外两处主检出字面量 `GOALS = "/data/home/yale/work/quay/goals"`
是**只读**的，产物落 `/tmp/crit`，不构成写入 —— 故本缺口的谓词是「写入目标」，不是「提到主检出」。）

**伤害形态**：它写进去的 17 个夹具 import `./helpers/live-web-address-fixture.mjs`，
而该 helper 只建在 worktree ⇒ **那两分钟里主检出处于坏态**：17 个测试文件 import 一个在该处不存在的模块
（`ls packages/quay/test/helpers/live-web-address-fixture.mjs` ⇒ No such file）。

**幸存是因为运气，不是因为护栏**：该 worker 随后自己改回、主检出恢复干净、**零持久化**
（`git status --porcelain | grep -v '^??'` = 0；`grep -rl 'live-web-address-fixture|installLiveWebAddressHelper' packages/ plugin/` = 0
⇒ 没有任何半成品进 develop 的树）。但按硬规则 11b，主检出是**生产写面**：那里的未提交改动「已生效而未记录」——
它正在影响生产，而对任何读 git 的人不可见，且**一次 `git checkout -- <path>` 或 worktree 刷新就会静默回退它**，
git 历史里不留任何痕迹。若它没自己改回，或被某条 driver 提交路径顺手带上 develop，代价就不是两分钟坏态。

**根因（两处，同一文件）**：`plugin/scripts/worker-driver.ts` 的两个 prompt 模板 ——
`buildWorkerPrompt`（`:1643`）与 `buildContinueWorkerPrompt`（`:2932`）—— CRITICAL 段逐字是：

> for CODE files, every Read/Edit/Write file_path MUST be the absolute path of the worktree …
> **Claude Code's file tools use absolute paths and do NOT sense shell `cd`**

它显式点名的是 **file tools**，对 **Bash** 一个字都没说。⇒ 一个在 Bash 里硬编码主检出根的脚本，
**完全符合该提示的字面要求**。护栏保护的是它点名的那条通道，漏掉的是实际出事的那条。

**发生率（硬规则 12b：查历史，⛔ 不等下一轮）**

- **已确证 = 1**：上面这一条，向量文件、时间窗（15:58–16:00）、持久化读数（0）都有直接量。
- 全量 transcript 搜索（`grep -rl` 广谓词）命中很多文件，**但该谓词被污染**：
  管理者/goal 侧对主检出根写入是**正当**的，在文本层面与漏写同形 ⇒ **⛔ 不得把它读成 N 次漏写**。
  此读数记在这里，是为了防止后来者把它四舍五入成一个更大的数。
- 本条**不是新增前置**，是**给一条已有护栏补上它漏掉的那条通道** ⇒ 硬规则 12 的「发生率」门槛按「洞是真的吗」判，⛔ 不按「发生了几次」。

**明确的非目标**：不主张新增仓库级检查器 / git hook 去扫「Bash 是否写了主检出」——
本缺口拿不出支撑它的发生率读数，且那是一个大得多的面。本任务只补提示文本。

## Plan

1. 改 `buildWorkerPrompt`（`plugin/scripts/worker-driver.ts:1643`）的 CRITICAL 段：把护栏从「file tools」扩到
   **任何会写文件的 Bash 命令或脚本**，并逐字写出「⛔ 不许在脚本里硬编码主检出根 `${root}` 作为写入目标；
   Bash 不感知 `cd`，所以目标路径必须显式写成 worktree 绝对路径」。
2. **同一个文件里的兄弟实例一并改**（硬规则 5b：`buildContinueWorkerPrompt`，`:2932`）——⛔ 只改被报出来的那一处视为未完成。
3. 在 `plugin/test/worker-driver.test.mjs` 加断言：**两个** builder 渲染出的文本都 (a) 显式点名 Bash/shell/脚本，
   且 (b) 逐字含「不得把主检出根作为写入目标」的约束。
4. **反例判据**（⛔ 缺此不算做完）：把该子句从 builder 里逐字删掉，断言必须转红；贴出红。

## AC

- [x] **AC1**：`buildWorkerPrompt(task, root)` 渲染文本里，护栏句**显式点名 Bash**（Bash / shell / 脚本 三者之一，按位置判：在护栏句内而非文件别处），且逐字含「不得把 `${root}` 作为写入目标」义；贴出渲染文本。
- [x] **AC2**：`buildContinueWorkerPrompt(...)` **同样**满足 AC1 —— 两处都改；贴出该 builder 的渲染文本，并贴出「两处都命中」的机械读数（例如对两个函数各取一次渲染再各自 grep）。
- [x] **AC3**：`plugin/test/worker-driver.test.mjs` 的新断言**覆盖两个 builder**；`node --test plugin/test/worker-driver.test.mjs` 绿。
- [x] **AC4（反例判据 · 一条命令可查）**：把该子句从 builder 里逐字删掉后，AC3 的断言**转红**；贴出红。⛔ 「测试绿」不算本条 —— 必须证明它**能取假**。
- [x] **AC5（不回归 + Touches 纪律）**：`bash scripts/test.sh --for-task gap-worker-prompt-guards-file-tools-not-bash` 绿；`git diff --name-only develop...HEAD` 逐条贴出且不出 `## Touches` 三条之外。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「prompt 文本改了、单测绿了」，而是
**下一条真实派发的 worker 命令行里逐字带着新护栏**。

1. **落地对象**：`plugin/scripts/worker-driver.ts` 的两处 prompt 模板经 commit 落 develop。
2. **活载体读数**：在该子句**落地之后**的派发记录里取一条 —— `.quay/worker-dispatch.json` 的
   `cmdlineFingerprint` 逐字保存着渲染后的完整 prompt —— 其中含 Bash 护栏句。⛔ 只计**落地之后**的时间窗；
   ⛔ fixture / 直接调函数渲染**不能**替代（硬规则 4 推论三：只证明「能产出」，不证明「已产出」）。
3. **反例**：删掉子句 ⇒ 测试转红（AC4），证明判据能取假、不是回声。

⚠️ **执行者注意**：DoD 第 2 条**在 fan-in 之后才可能兑现**（要先有 landed 代码，才会有一条带新护栏的真实派发）。
⛔ **不要**为了让它当轮可满足而把它降级成 fixture 检查 —— 该差额若存在，如实记进 Evidence，不要抹平。

## Touches

- `plugin/scripts/worker-driver.ts`
- `plugin/test/worker-driver.test.mjs`
- `tasks/gap-worker-prompt-guards-file-tools-not-bash.md`

（说明：第一条是落地面 —— 两处 prompt 模板（硬规则 5b：兄弟实例同文件）；第二条是覆盖两个 builder 的断言与反例；
第三条是 self-touch。⛔ 不新增 `plugin/scripts/*.ts`（本任务不需要新脚本，故不触发 outline / capability-catalog / laydown 登记）。）

## Evidence

**AC1/AC2（护栏渲染文本 + 「两处都命中」机械读数）**

渲染方式：在 worktree 内 `node --experimental-strip-types` 动态 import `./plugin/scripts/worker-driver.ts`，对两个 builder 各取一次渲染（root 传 `/MAIN-ROOT`），再对渲染文本按位置截取 `⚠️ CRITICAL` … `This rule does NOT cover the task file` 的子串并逐项判定：

```
buildWorkerPrompt:         guardChars=919 BashHitsInGuard=3 shellScriptInGuard=1 verbatimProhibition=true rootLiteral=</MAIN-ROOT>
buildContinueWorkerPrompt: guardChars=859 BashHitsInGuard=3 shellScriptInGuard=1 verbatimProhibition=true rootLiteral=</MAIN-ROOT>
```

两处 CRITICAL 段渲染（`root=/MAIN-ROOT`）：

- **CREATE**：`⚠️ CRITICAL: for CODE files, every Read/Edit/Write file_path MUST be the absolute path of the worktree you created in step 1 — never the main-checkout path \`/MAIN-ROOT\`, never a relative path. Claude Code's file tools use absolute paths and do NOT sense shell \`cd\`; a main-checkout or relative path lands your implementation in the develop shared checkout, not your worktree. ⛔ THIS GUARD ALSO COVERS BASH: any Bash command, shell script, or inline \`node -e\`/\`python -c\` that writes a file must target the absolute path of the worktree you created in step 1 — Bash does NOT sense shell \`cd\` either, so never hardcode the main-checkout root \`/MAIN-ROOT\` as a write target inside a script (e.g. \`cat > "$WT/x.mjs"\` whose script body contains \`const T = "/MAIN-ROOT/…"\` + \`fs.writeFileSync\`); writing under \`/MAIN-ROOT\` from Bash lands the files in the develop shared checkout exactly like a main-checkout file_path does.`
- **CONTINUE**：同上一段，仅 worktree 引用不同 —— `must target the absolute path of the existing worktree \`/WT\``（其余逐字相同）。

⇒ 护栏句**内**点名 Bash（3 次）与 shell script（1 次），逐字含 `never hardcode the main-checkout root \`<root>\` as a write target`。

**AC3**：`node --test plugin/test/worker-driver.test.mjs` ⇒ `tests 111 / pass 111 / fail 0`。新测试 `AC1/AC2 (能取假) — 两个 prompt builder 的 CRITICAL 段都把路径护栏从 file tools 扩到 Bash 写入目标` ✔（同一个 test 内对两个 builder 各跑一遍 per-builder 断言 + 一条共享标记的 fork 检测；注释里注明实质测量是 per-builder 那一半）。

**AC4（反例 · 两处各做一次，均转红）**

- 从 `buildWorkerPrompt` 逐字删掉 `${bashWriteTargetGuardNote(root, "the absolute path of the worktree you created in step 1")}` 插值 ⇒ `pass 110 / fail 1`，`AssertionError: buildWorkerPrompt: guard sentence names Bash (in-guard, by position)`，`actual` 为**去掉 Bash 子句后**的 CRITICAL 段（原文粘贴见上，止于 `not your worktree. `）。
- 从 `buildContinueWorkerPrompt` 逐字删掉同款插值 ⇒ `pass 110 / fail 1`，`AssertionError: buildContinueWorkerPrompt: guard sentence names Bash (in-guard, by position)`。
- 两次变更均用 `cp` 备份、改后 `diff` 逐字节相等再恢复；恢复后回到 `pass 111 / fail 0`。⛔ 未用 `git checkout --`（会回退到 HEAD 并吞掉未提交改动）。

**AC5**：`bash scripts/test.sh --for-task gap-worker-prompt-guards-file-tools-not-bash --allow-thin` ⇒ `EXIT=0`（scoped static checks 全过；`tests 111 / pass 111 / fail 0`）。`git diff --name-only develop...HEAD`：

```
plugin/scripts/worker-driver.ts
plugin/test/worker-driver.test.mjs
```

两条都在 `## Touches` 内；第三条 `tasks/gap-worker-prompt-guards-file-tools-not-bash.md` 由 `task_write`（AC 勾选 + 本段 Evidence）落在任务文件自身，属 self-touch，不出三条之外。

**scoped-gate 缓存**：`node --experimental-strip-types plugin/scripts/worker-driver.ts --write-scoped-gate-cache --task gap-worker-prompt-guards-file-tools-not-bash --develop-sha <rev-parse develop> --root /data/home/yale/work/quay` ⇒ `{"event":"scoped-gate-cache-written","task":"gap-worker-prompt-guards-file-tools-not-bash",…}`。

**DoD 第 2 条 · 本轮不可兑现的差额，如实记，不抹平**：该条要求在**子句落地之后**的派发记录（`.quay/worker-dispatch.json` 的 `cmdlineFingerprint`）里读到 Bash 护栏句。本 worker 只把 commit 放在 `task/<id>` 分支上，develop 尚未含它 ⇒ 本轮**结构上不存在**「落地之后」的派发记录。⛔ 未用 fixture / 直接调函数渲染顶替（那只能证明「能产出」，不能证明「已产出」）。兑现时点 = fan-in ff 到 develop 之后的**第一条真实派发**；本轮只交付 DoD 1（代码 commit）与 DoD 3（反例已跑）。

**实现的实现面（两处 builder 之外的说明）**：新增单一真相源 helper `bashWriteTargetGuardNote(root, worktreeClause)`（`worker-driver.ts`，紧随 `acCheckNote()` 定义），由两个 builder 各自拼入 CRITICAL 段——符合硬规则 5b（兄弟实例同文件，⛔ 只改被报出来那一处视为未完成）。未新增 `plugin/scripts/*.ts`。