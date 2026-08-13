---
id: gap-precommit-guard-wire-into-quay-init-and-cold-start
title: pre-commit 守卫接进 quay-init --loop 铺设集 + cold-start 步骤（新目标自动带上 + 冷启动自动装，建成≠生效）
status: ready
labels:
  - gap
  - mechanism
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（manager 2026-08-12，建成≠生效缺口）**：守卫实现合入前，主检出 `.git/hooks/pre-commit` 不存在、
仓库里自动调 `--install-hook` 处 = 0、接进 quay-init/cold-start 处 = 0——**合入后守卫从不运行**（除非有人手工装）。
「建成≠生效」——今天已数过多例（message-bus 零流量 / accounting-emit 零调用 / AC36 轴零行使），守卫不能成为下一个。
代码合入 + 测试全绿 + fan-in 成功从记录上看完全是「已交付」，但钩子没装 = 一次也不运行。

## Plan

1. **接进 `quay-init --loop` 的铺设集**：新目标项目自动带上守卫脚本 + 自动 `--install-hook`（铺设即生效）。
2. **接进 cold-start skill 的步骤**：冷启动自动装钩子（恢复会话后钩子仍在，不需重装——`.git/hooks` 是克隆本地）。
3. **DoD 补「真实运行产物」**：在主检出【真 running 轮】期间尝试提交断言面文件 ⇒ 被拒 ⇒ 留拒绝记录
   （subagent worktree 的实 commit 验证只证「能工作」，不证「在此仓库正在工作」——两者差别正是所有建成零触发的差别）。

## AC

- [x] AC1: quay-init --loop 铺设守卫脚本 + 自动 `--install-hook`（新目标项目自带）
- [x] AC2: cold-start skill 步骤装钩子
- [x] AC3: 主检出钩子已装（`ls -l .git/hooks/pre-commit` 可核）
- [x] AC4: 真实运行记录——主检出真 running 轮期间提交断言面文件被拒（见 Evidence）
- [x] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 真实拒绝记录贴出（见 Evidence）
- [ ] 全量套件绿

## Touches

- plugin/scripts/quay-init.sh（铺设集）
- plugin/skills/cold-start/SKILL.md（冷启动步骤）
- plugin/scripts/precommit-guard.ts（--install-hook 若需补）
- tasks/gap-precommit-guard-wire-into-quay-init-and-cold-start.md（自身）

## Evidence

**AC1 — quay-init --loop 铺设守卫脚本 + 自动 `--install-hook`（2026-08-13 实测）**

- `precommit-guard.ts` 已加入 `derive_loop_scripts` 显式铺设集（cross-cutting 机件，覆盖全部写入者，
  文档路径推导会漏——cold-start SKILL.md 也按路径引用，双保险）。`--check-dependency-closure` 派生集含
  `precommit-guard.ts`。
- 真实 `quay-init --loop` 装进临时 git 仓（`/var/tmp/quay-init-test-git-*`）：
  守卫脚本落盘 + 末尾自动 `--install-hook`。**顺序：铺 → auto-commit → 装钩子**——新目标无
  `.quay/full-suite-state.json`，守卫 fail-loud 会挡掉 quay-init 自己的交付 commit，故装钩在 auto-commit 之后。
  实测 auto-commit 成功（103 文件 chore(quay-init)），随后 `precommit-guard: installed pre-commit hook at .git/hooks/pre-commit`。
- 装钩后在该目标仓验证钩子真实生效：写 `state=running` + stage 一个 `tasks/` 断言面文件 ⇒ commit 被拒
  （拒绝消息 + 预检清单），且拒绝记录落 `.quay/precommit-guard-rejections.jsonl`；改 `state=green`+finishedAt ⇒
  同文件 commit 放行。

**AC2 — cold-start skill 步骤装钩子**

- `plugin/skills/cold-start/SKILL.md` 新增 `### 1c. Install the pre-commit guard hook (provisioned = active)`：
  `node <root>/plugin/scripts/precommit-guard.ts --install-hook --root <root>` + `ls -l <root>/.git/hooks/pre-commit` 核验。
  说明钩子是克隆本地（`.git/hooks/pre-commit`），恢复会话后仍在、不需重装；非 git 工作区跳过；
  既存无关钩子 exit 2 不静默覆盖。该路径引用使守卫脚本进入 `laydown-set-check.sh` 的派生成员集
  （`scripts_derived: 65` / `laydown_set_green: green`，守卫的测试随派生集门执行——铺什么验什么）。

**AC3 — 主检出钩子已装**

- `/home/yale/work/quay/.git/hooks/pre-commit` 已存在且为本守卫 shim（`ls -l` 可核；内容含
  `precommit-guard.ts` 指纹 + `exec node ... plugin/scripts/precommit-guard.ts`）。

**AC4 — 真实运行记录（主检出真 running 轮，2026-08-13 01:53:10Z）**

- 主检出当时有一轮真跑（runId `afb4e7bd-c71f-44b1-93a8-a421b5ee46a4`，state=running，startedAt 01:46:23Z）。
- 期间 stage `tasks/gap-precommit-guard-ac4-real-run-proof.md`（断言面，tasks/** 属 narrowed fallback）并
  `git commit` ⇒ 钩子拒绝（exit 1），commit 未落地（HEAD 仍 `46561bde`），拒绝记录已留：
  `{"at":"2026-08-13T01:53:10.066Z","runId":"afb4e7bd-c71f-44b1-93a8-a421b5ee46a4","startedAt":"2026-08-13T01:46:23.124Z","files":["tasks/gap-precommit-guard-ac4-real-run-proof.md"],"verdict":"reject"}`（.quay/precommit-guard-rejections.jsonl）。
- 试提交文件已 unstage + 删除，工作树恢复原状，未扰动 running 轮。

**AC5 — scoped 门绿**

- `scripts/test.sh --for-task gap-precommit-guard-wire-into-quay-init-and-cold-start`（worktree 根）：
  25 通过 / 0 失败 / 0 cancelled / 0 skipped（precommit-guard.test.mjs 21 + quay-init.test.mjs 5）。
  派生集门 `laydown_set_green: green`。
