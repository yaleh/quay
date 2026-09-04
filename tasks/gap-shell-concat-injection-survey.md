---
id: gap-shell-concat-injection-survey
title: "枚举所有『模型写的/文件读的文本拼进 shell 命令串』的拼接点——一次能关机的洞值得普查（halt 险情）"
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-16 23:2xZ（险情报告 + 裁定）。**⛔ 不立「提交信息禁反引号」pre-commit 检查**——方向性验证是反的（见下），别造。

**险情**：manager 的 `git commit -m "..."`（双引号）信息里含反引号引用（`` `halt` `` 字段名）⇒ bash 双引号内反引号 = **命令替换** ⇒ 实际执行了 `halt`。polkit 交互认证拒绝才没关机（`uptime` 确认 up 5 days）。**这是运气，不是防护。**

**⛔ 不立 hook 检查的原因（方向性验证，两个真提交）**：
```
a4b0e8c2  信息残留反引号=0 ⇒ hook 放行  ← 这条真执行了 halt（替换吃掉反引号，信息干净）
1a2bbde2  信息残留反引号=7 ⇒ hook 拒绝  ← 这条安全（反引号是字面量）
⇒ 命令替换发生在 shell 展开时，git 拿到的是替换【之后】的串 ⇒ hook 永远看不到危险时刻
⇒ 结构上不可能对危险取真 + 输出「通过」与合格同形 = 硬规则④+3b 合体。⛔ 比没有检查更贵。
```

**为什么普查（manager 裁定）**：发生率只有 1，但后果是**任意命令执行**（一次能关机的洞值得普查）。**⛔ 不得成为任何东西的阻塞前置**——普通任务，查完给清单，不挡派发、不挡发布。

**防护在调用点不在 hook**：
- 单引号 `-m '...'`：有边界（信息里含 `'` 即破——中文提交信息里不常见但存在）
- **`-F <file>`：唯一无转义边界的做法**（manager 已改用）
- 不用反引号

**结构性判据（⛔ 非当前值）**：`fan-in-execute.js:219` 拼 `${task}`（任务 id）现在安全，是因为拼的量恰好受控——**⛔ 不是因为该写法安全**。哪天任务 id 允许特殊字符、或改成拼任务标题，它就变高危。⇒ **该行进本清单。**

## Acceptance Criteria

- [x] AC1: 枚举所有「模型写的/文件里读的文本（提交信息、任务体、命令输出）拼进 shell 命令串」的拼接点——产出**清单**（文件:行 + 拼接的量 + 当前是否受控 + 若受控会否变）。
- [x] AC2: 每个拼接点标注风险级：①拼受控标识符（当前低危但写法非结构性安全）②拼自由文本（高危，需改调用点）③拼任务体（可写输入，最危险）。
- [x] AC3: 高危/最危险拼接点（②③）给出改法建议（⛔ 不强制改，清单优先——普查不是阻塞前置）。⛔ 不造反引号检查。

## Definition of Done

- [x] 清单产出（文件:行 + 风险级 + 改法建议），供后续按需处置；普查本身不阻塞任何派发/发布。

## Evidence

**普查方法**：只读 grep/读码，覆盖 `plugin/workflows/`、`plugin/scripts/`、`scripts/`、`packages/`、`.claude/workflows/`、`orchestration/`、`experiments/quay-perpetual-stream/scripts/`、`.github/workflows/`、`plugin/skills/`、`.claude/skills/`。判据 = 「模型写的/文件里读的文本（提交信息、任务体、命令输出）被拼进 shell 命令串」。⛔ 未造反引号检查（任务边界）。已排除：`execFileSync("git", [...])` / `spawn("bash", [script, ...args])` / `spawnSync("tmux", args)` 等 **argv 数组形式**（无 shell 解释 → 结构性安全）与纯 console/error 模板串。

**清单（拼接点，按风险级分组；行号为本普查读到的当前值）**：

### ① 拼受控标识符（当前低危，但写法非结构性安全——换一个「恰好受控」的前提即变高危）

1. **`plugin/workflows/fan-in-execute.js:227`**（同构副本 `.claude/workflows/fan-in-execute.js:227`）——**⭐ 已知点**。拼接形态：`git add tasks/${task}.md && git commit -m "tasks: 翻 ${task} done（AC78 fan-in-execute workflow）"`。拼接的量：任务 id 进**双引号提交信息**（`-m "…"`）。当前受控：任务 id 有严格形（`[a-z0-9-]+`，文件名即 id）。**会否变**：任务 id 一旦允许特殊字符，或该写法被复制去拼任务标题，反引号/`$()` 即命令替换（halt 险情同类）。改法建议：`git commit -F -` + `<<'EOF'` 引号 heredoc；或调用点对 id 断言 `^[a-z0-9-]+$`。⚠️ 任务体写 `:219`，实测现为 `:227`（文件已演化，行号漂移）。
   - **同脚本内其余 `${task}`/`${worktree}`/`${root}`/`${mergeTarget}`/`${runId}` 拼接**（:71 `git merge ${mergeTarget}`、:78/:105 `--task ${task} --worktree ${worktree}`、:89-90 `merge-base`、:110 `--for-task ${task}`、:117-130 `"/tmp/fan-in-suite-${task}.env"`、:163/:173/:181/:191/:204、:209/:211/:217-218/:221-223 `tasks/${task}.md` 路径、:237 `grep -l '${task}'`、:251/:265-266 `--task ${task}`、:276 `git worktree remove ${worktree}`）——均为**受控 id/路径进 argv/路径位**（无 shell 重解析），① 类。:227 那条 `-m "…"` 因双引号内的反引号会被命令替换，是脚本里**最接近 halt 险情**的一处。
2. **`plugin/scripts/build-evidence-collector.ts:76`、`build-evidence-gate.ts:78`、`stage-receipt.ts:245`、`run-identity.ts:98`**（同构 helper）——拼接形态：`execSync(\`git ${args.join(" ")}\`)`（**execSync 字符串形 = 走 shell**）。拼接的量：`args` 数组 join 成 shell 串；调用点现传 merge-base/diff 的 SHA/ref。当前受控：SHA/ref。**会否变**：任何调用点传「含空格或 shell 元字符的 ref/文件名」即注入。改法建议：改 `execFileSync("git", args)`（argv 形，无 shell）。
3. **`plugin/scripts/fan-in-ff-merge.sh:149,222,247,254,261,273,289,302,307`**——拼接形态：`"refs/heads/task/${task_id}"`、`git merge --ff-only "task/${task_id}"`、JSON 载荷 `"taskId":"${task_id}"`。拼接的量：任务 id（`--task` argv）。当前受控：id 形。**会否变**：双引号仍允许反引号/`$()` 替换（引号只挡分词/glob）；id 若带反引号即执行。改法建议：入口断言 id 匹配 `^[a-z0-9-]+$`（强守卫）。
4. **`plugin/scripts/periodic-push-backup.sh:97-101`**——拼接形态：`printf '%s\n' "*/12 * * * * cd ${repo_root} && git push … ${remote} ${branch} >> ${log_path}"`（cron 行 = 一条 shell 串）。拼接的量：operator 传入的 root/remote/branch/log_path。当前受控：operator 参数。**会否变**：路径/远端名含空格或元字符即坏。改法建议：`printf '%q'` 逐值；或注明 operator 信任边界。
5. **`plugin/workflows/execute-suite-fix.js:84,217,219`**（同构副本 `.claude/workflows/execute-suite-fix.js`）——拼接形态：生成的 subagent prompt 内嵌 `cd ${root} && … --root ${worktree} --state-dir ${stateDir} --log-file ${resolvedLogFile}`、`git -C ${root} worktree remove ${worktree}`。拼接的量：worktree/root/stateDir/logFile 路径（来自 workflow args）。当前受控：框架路径。**会否变**：路径若含模型文本即注入。改法建议：路径走 argv/参数位，不拼进 shell 串。
6. **`plugin/workflows/drain-directives.js:97`**（同构副本 `.claude/workflows/drain-directives.js`）——拼接形态：`node packages/quay/bin/quay.ts task edit ${directive.id}`。拼接的量：directive id。当前受控：id 形。**会否变**：同 ①。改法建议：同 ①（id 断言）。

### ② 拼自由文本（高危，需改调用点）

7. **`plugin/scripts/git-lens-l-s-behavior-variance.ts:89`**——拼接形态：`execSync(cmd, …)`（字符串形，走 shell）。拼接的量：`cmd` = `testCmd`（CLI 传入的测试命令，自由文本）。当前受控：operator/调用方传入。**会否变**：已是自由文本；若 cmd 来自文件/模型即 RCE。改法建议：调用点保证 cmd 为受信值；可改 argv 形则改。
8. **`plugin/scripts/fan-in-ts-typecheck-gate.ts:122`**——拼接形态：`spawnSync("bash", ["-c", cmd])`。拼接的量：`cmd` = `resolveTypecheckCommand()` → 读 **`.quay` gates 配置 `testPass[].command`**（可写配置文件）或回退 CANONICAL 常量。当前受控：配置 operator 掌控。**会否变**：配置文件可被写入者即 shell RCE（与 ③ 同源，但配置面比任务体窄）。改法建议：标注 config→shell 信任边界；不改机制。
9. **`plugin/scripts/full-suite-runner.ts:2186,2629`**——拼接形态：`spawn("bash", ["-c", command])`。拼接的量：`command` = `explicitCommand ?? "bash scripts/test.sh"`（operator CLI 参数）+ 数值并发 splice。当前受控：operator 参数。**会否变**：explicitCommand 若来自文件/模型即 RCE。改法建议：标注信任边界；默认值 `bash scripts/test.sh` 本身安全。
10. **`orchestration/manager-tick-closing.md:125,154`**——拼接形态：**模型照 playbook 手写 `git commit -m "…"`**（提交信息自由文本）。当前受控：模型自写。**会否变**：已发生 halt 险情（manager 2026-08-16 双引号 `-m` 内反引号真实执行 `halt`）。改法建议：信息含反引号/`$` ⇒ 必须 `git commit -F -` + `<<'EOF'` 引号 heredoc；禁 `-m "…"`（manager-tick-core.md:74 C10b 已载此纪律）。
11. **`plugin/skills/quay-directive/SKILL.md:120`**——拼接形态：`git commit -m "DIR-NNN: <one-line summary>"`（模型写 summary 进双引号）。当前受控：模型自写。**会否变**：同 halt 类。改法建议：改 `-F -` + heredoc，或明确禁反引号/`$`。
12. **`plugin/skills/quay-task-to-plan/SKILL.md:48`**——拼接形态：`git commit -m "... "`（模型写消息）。②。改法建议：同上。
13. **`orchestration/manager-tick-closing.md:133-142` 等 `python3 -c "…"`**——拼接形态：模型手写 python 内联脚本，内含并进的 git/断言命令串。②（模型写命令文本）。改法建议：与 ⑩ 同纪律——python 字符串内嵌命令同样受反引号/`$` 命令替换影响。

### ③ 拼任务体（可写输入，最危险）

14. **`packages/quay/src/gate/acceptance-runner.ts:114-122`**——拼接形态：`spawnSync(shellCmd, { shell: true })`，`shellCmd` = 任务 frontmatter `extra.acceptance`（**任务体 = 可写输入**）+ 可选 envFile（dot-source，单引号转义）。当前受控：**这是设计使然**（acceptance 命令本就该当 shell 跑——QENG「runnable meter」）。**会否变**：任何能在 `tasks/*.md` 里写 `extra.acceptance` 的人 = 工作区内任意命令执行（`quay gate`/`complete`/`promote` 触发）。改法建议：机制不动（设计如此），但**标注信任边界**——凡可写任务体者即工作区 RCE；与 ③ 类「任务体→shell」的唯一真实点。envFile 的 dot-source 已有 `shQuote` 单引号转义（安全）。

### 结构性安全的正向对照（本仓库已有正确做法，供抄）

15. **`plugin/scripts/manager-tick-readings.ts:126`**——ssh `tmux list-panes -a -F ${fmt}`：`fmt` 逐字段**单引号转义** + `$'\t'` ANSI-C 引用 → 结构性安全。
16. **`plugin/scripts/supervisor-deliver.sh:143,161`、`send-keys-reliable.sh:99,117`**——`printf '%q '` 对每个参数 shell 转义后再拼 → 结构性安全。
17. **argv 数组形**（全仓主流，无 shell 解释 → 安全）：`execFileSync("git", [...])`（full-suite-runner.ts:1600/1711/1740 等、prod-data-audit.ts:265、landing-target-check.ts:104）、`execFileSync("gh", ["api", ...args])`（github-client.ts:66）、`spawn("bash", [script, ...args])`（cli/manager.ts:70）、`spawnCapture(process.execPath, argv)`（mcp-server.ts:119）。

### 纪律记录（非拼接点，但为 halt 险情与 heredoc 教训的正本）

18. **`orchestration/manager-tick-core.md:74`（C10b）**——提交信息含反引号/`$` ⇒ `-F -` + `<<'EOF'`，禁 `-m "…"`；并载 2026-08-11 `git worktree remove` 反引号双执行先例。
19. **`orchestration/manager-obligation-ledger.jsonl:238`（OB-UNQUOTED-HEREDOC）**——`cat >> file <<XEOF`（不带引号）开启命令替换，三个标识符被当命令执行。修法：heredoc 一律 `<<'XEOF'`。
20. **`orchestration/SPEC-instruments-behind-one-entry.md:238`**——记录 manager 双引号 `-m "…"` 内反引号真实执行 `halt` 险情。

**统计**：编号拼接点 **14 个**（① 6 个编号点，其中 fan-in-execute.js 内嵌脚本含 ~30 处同族拼接；② 7 个；③ 1 个）+ 正向对照 3 类 + 纪律记录 3 条。**高风险点（②③）= 8 个**（⑦⑧⑨⑩⑪⑫⑬ 为 ②，⑭ 为 ③ 最危险）。

**普查结论**：代码面真正的「任务体→shell」点只有 ⑭（acceptance，设计使然）；其余 ② 类集中在**模型手写命令**（⑩⑪⑫⑬）与 operator/配置文件入参（⑦⑧⑨）。**「一次能关机的洞」的根是模型手写 `git commit -m "…"`（⑩⑪⑫），不是代码拼接**——改法在调用点（`-F -` + heredoc），⛔ 不在 hook（结构性判据见本任务 Proposal：命令替换发生在 shell 展开时，hook 看不到危险时刻）。本普查不阻塞任何派发/发布。

## Touches

- 全仓（枚举 shell 拼接点，只读普查）
- plugin/workflows/fan-in-execute.js（:219 是已知点，标注「拼受控 id，写法非结构性安全」；实测现为 :227）
- tasks/gap-shell-concat-injection-survey.md（自身）
