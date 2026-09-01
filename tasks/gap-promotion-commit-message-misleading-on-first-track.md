---
id: gap-promotion-commit-message-misleading-on-first-track
title: promotion-driver 机械提交消息未区分"状态翻转"与"文件首次入 git"
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`commitTaskStatus`（`plugin/scripts/ready-pool-check.ts:2537-2540`）和 `driver-filters.ts:690` 的
needs-human 机械翻转提交，都无条件拼接固定文案——前者恒为
`tasks: ${id} ${from}→${to}（promotion-driver 机械晋升）`，后者恒为
`（重试上限机械翻转）`——从不检查目标 `tasks/<id>.md` 此前是否已被 git 跟踪。两者都通过共享的
`commitTaskFile()`（`driver-filters.ts:237`）落地实际的 `git add && git commit --no-verify`；
`commitTaskFile()` 本身只负责执行提交，不做"是否已跟踪"判断——这是多个调用方共用的通用 helper，
不应改它的签名去承担这个判断。

**实测影响**：当某会话（人类交互 / outer / worker）把 `tasks/<id>.md` 新写到磁盘、尚未提交，
promotion-driver 下一次 tick（~40s 周期）抢先扫到该文件并判定其满足晋升条件时，driver 的这次提交
就成了该文件在 git 历史里的**第一次出现**（`git log --all --diff-filter=A -- tasks/<id>.md` 可证：
该 Added 提交与被打上"机械晋升"标签的提交是同一个 SHA）。但 commit message 却宣称一次
"todo→ready" 状态翻转——这个翻转从未真实发生过：文件在 git 里此前根本不存在，谈不上"从 todo
翻到 ready"，实质是"该任务文件的诞生提交，恰好携带 ready 状态"。这个文案让后续任何读 git log
判断"这条任务何时真正经历过 todo→ready 翻转"的人（或机制）得出错误结论。

**48h 窗口实测发生率**：命中 5 个任务文件（非零，满足硬规则12的发生率要求）。判假实验：对 5 个
命中逐一跑 `git log --all --diff-filter=A -- tasks/<id>.md`，其 Added 提交 SHA 与被误标"机械晋升"
的提交 SHA 完全相同——证明这不是"状态翻转提交里恰好也改了别的东西"，而是"这次提交本身就是文件
的创世提交"。

**期望修法方向**（在两处调用点各加一次判断，不改 `commitTaskFile` 签名）：拼装 message 前，用
`git log --oneline -- <rel>`（或等价的 `git log -1 --format=%H -- <rel>`，空输出即未跟踪）判断
目标文件此前是否已有提交历史。已有提交历史 → 沿用现有"机械晋升/重试上限机械翻转"文案（真实翻转，
文案本来就对）。此前无提交历史 → 改用如实描述"文件首次登记"的文案（例如
`tasks: ${id} 首次登记（status=${to}，promotion-driver 机械落盘）`），不得沿用任何暗示"翻转"发生过
的措辞。两个调用点（`commitTaskStatus` 与 needs-human 翻转函数）都要改，避免只修一处、另一处仍留
同一缺陷（硬规则 5b）。

## AC

- [ ] `commitTaskStatus`（`ready-pool-check.ts`）在拼接 commit message 前，对目标 `tasks/<id>.md`
      执行一次"此前是否已有 git 提交历史"的判断（如 `git log -1 --format=%H -- <rel>` 空输出即未
      跟踪），且该判断的返回值真实驱动两种不同文案的选择——静态读代码可见分支，非事后描述。
- [ ] `driver-filters.ts:690` 附近的 needs-human 机械翻转提交同样加上同款判断，不得只修
      `commitTaskStatus` 一处遗漏这里（硬规则 5b，本任务在立案时就已在同一份 Finding 里指名两处）。
- [ ] 新增/扩展单测：构造一个"文件从未提交过、直接调用 commitTaskStatus 落 ready"的场景，断言产出
      的 commit message 不含"机械晋升"/"翻转"字样，改为"首次登记"一类如实措辞；另构造一个"文件此前
      已有提交、真实 todo→ready"的场景，断言仍沿用原有"机械晋升"文案（负控制，防止修复矫枉过正把
      真实翻转也误标）。
- [ ] `scripts/test.sh` 全量绿（含新增用例）。

## DoD

两处调用点的 commit message 选择逻辑均可从代码静态读出（非注释/非承诺），且都能被上述新增单测
直接验证是"该分支被执行到"而非"恒定输出"（硬规则 3b：判定分支不得对未跟踪/已跟踪两种输入返回
同形结果）。合入 develop 后，下一次真实 promotion-driver 对一个未跟踪任务文件的晋升提交，
其 commit message 用 `git log --diff-filter=A` 反查时不再与"机械晋升"文案共存于同一条提交里
（生产载体验证，硬规则「推论三」：不能只靠 fixture/单测通过就判完成，需在实现落地之后的至少一次
真实 promotion-driver 提交上核实措辞已改变）。

## Touches

- `plugin/scripts/ready-pool-check.ts`（`commitTaskStatus` 函数体及其调用点，约 2537-2540 行附近）
- `plugin/scripts/driver-filters.ts`（needs-human 机械翻转提交点，约 690 行附近；`commitTaskFile`
  本身不改，仅其两个调用方改）
- `plugin/test/ready-pool-check.test.mjs`（或等价测试文件——新增"未跟踪文件晋升"与"已跟踪文件真实
  翻转"两个用例；若该测试文件不存在，需新建并按现有测试文件命名/分层约定接入 `scripts/test.sh`）
- `plugin/test/driver-filters.test.mjs`（或等价测试文件——needs-human 翻转点的对应用例）
- `tasks/gap-promotion-commit-message-misleading-on-first-track.md`（本任务自身，self-touch）
