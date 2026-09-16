---
id: gap-shared-install-fixture-wipe-cannot-remove-readonly-tree
title: shared install fixture 的清空路径删不掉只读树——一旦夹具落到「只读子目录 + 无就绪 marker」态，后续每次全量套件都
  EACCES 且永久不能自愈；同一文件另有 3 个裸 NUL 字面字节使其对 grep/file 成为非文本
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

**实测（2026-09-16，本仓库 worktree，可独立复现）**：`plugin/test/helpers/quay-init-install-fixture.mjs` 的两段代码互相矛盾——

- `_makeReadOnly(dir)`（约 :262-270）在夹具建成后把整树的写位剥掉（`chmod mode & ~0o222`），
  于是子目录为 `dr-xr-xr-x`、文件为 `-r--r--r--`。这是**设计意图**（只读模板，供各测试 `cp -a` 复制）。
- `_buildSharedFixture(ws)` 的第一行（:281）却是 `fs.rmSync(ws, { recursive: true, force: true })`
  ——**先清空再重建**。`force:true` 只抑制 ENOENT，**不抑制 EACCES**；`recursive` 要删掉子目录里的条目，
  而删除条目需要**该子目录的写位**，写位恰好已被 `_makeReadOnly` 剥掉。

**孤立对照（2026-09-16 实跑，三行 Node）**：建 `sub/`(chmod 555) + `sub/file`(444) 后调
`fs.rmSync(root, {recursive:true, force:true})` ⇒ **抛 EACCES，且一个条目都没删掉**。

**后果（在生产载体上实测）**：`/var/tmp/quay-install-fixture-8b2f32344ce66b23` 正处于该态——
父目录 `drwxrwxr-x`（可写）、`.claude`/`.quay` 为 `dr-xr-xr-x`、其中文件 `-r--r--r--`、
而 `.fixture-ready` 与 `.install.json` **两者皆缺**。于是 `ready()` 判假 ⇒ 走清空路径 ⇒ **必抛 EACCES**：
`packages/quay/test/install-config-driven-e2e.test.mjs` 的 A2 在 :402 失败，栈顶为
`_buildSharedFixture (...:281)`。该失败在本任务 worktree 内**单文件直跑即可确定性复现**（非 flake）。

**为什么它不会自愈**：异常发生在任何重建之前；每一次重试都命中同一个 EACCES。
⇒ 该目录**永久不可重建**，直到有人带外 `chmod`。而它会让**任何** plugin-surface 哈希映射到该目录的
全量套件变红——与失败任务自身的 delta 无关。本任务正是如此：本任务 delta 六个文件全在
`packages/*/scripts/`+`.github/`+`packages/quay/test/`，**不碰 `plugin/`**，却因它烧掉一整轮 fan-in。

**单变量对照（证明归因，2026-09-16）**：仅对该目录 `chmod -R u+w`（**不改代码、不改分支、同一 worktree、
同一 commit**）后重跑同一文件 ⇒ **3/3 绿**，夹具被重建且 `.fixture-ready`/`.install.json` 重新写出。
⇒ 变量只有一个：目录写位。

**次要 Finding（同一文件、同一修复落点，严重度低）**：该文件含 **3 个裸 NUL 字节**
（`h.update("^@")` 形，实际字节为 `0x00`，位于 :418/:429/:431，疑为把 `"\0"` 的转义写成了字面字节）。
`"\0"` 作为哈希分隔符意图正确，但后果是 **`file` 把它判为 `data`**，且 **`grep` 不带 `-a` 时对这个文件
静默零输出、exit 1（"no match"）——而它实际有 14 处匹配**。这是一个「读不懂 ⇒ 与『不存在』同形」的零值。
**全仓扫描（`plugin/ packages/ scripts/ experiments/ orchestration/` 下全部 .mjs/.ts/.sh/.js）**：
它是**唯一**一个非文本文件，即该陷阱已被限制在这一个文件内（硬规则 5b 的兄弟实例扫描结果为零）。
**今日无实际危害**：现无任何静态检查 grep 该文件（已扫 `plugin/scripts/`、`scripts/`，命中 0）——属**潜在**陷阱。

## Requested action

1. **让清空路径自愈**：删除既有夹具之前先恢复写权限（对整树 `chmod u+w`，或先删 marker 再删树），
   使「不存在」与「已存在且只读」两种输入走同一条路径都能正确清掉。
2. **让失败不放大**：清空过程中途失败时，结束态**不得比起始态更差**。当前形态会把一个可用的夹具
   变成永久不可重建（marker 没了、只读树还在）。要么删成功，要么原样保留。
3. **消除裸 NUL 字节**：把 :418/:429/:431 的字面 `0x00` 改为转义写法（`\0`），使该文件恢复为文本，
   `grep`/`file` 一类的读取不再静默返回零。

## Acceptance Criteria

- [ ] AC1 取假判据（核心）：构造一个「只读子目录 + 无 marker」的夹具目录，跑该夹具的消费者
      （`packages/quay/test/install-config-driven-e2e.test.mjs`）：**修前必 EACCES 失败、修后必重建成功
      且 marker 回来**。须附修前与修后两次实跑读数（不是复述实现）。
- [ ] AC2 负控制（不放大）：让清空在删除中途失败，断言结束态不差于起始态——即下一轮仍能重建，
      或明确回到「不存在」。⛔ 不得出现「marker 没了、只读树还在」这一态。
- [ ] AC3 该文件恢复为文本：`file` 报文本类；`grep -c <已知为真的串>` 返回真实计数。
      **须附仪器自检**：先用一个已知为真的样本干跑一次该谓词（硬规则 2 的零计数半边）。
- [ ] AC4 回归：上述测试文件在**干净起始态**与**已存在只读夹具起始态**两种情况下都绿。

## Definition of Done

- [ ] 至少一条判据落在**生产载体**上——真实 `/var/tmp` 夹具 + 真跑该测试文件，而不是只在注入/夹具缝里成立
      （硬规则 4 推论三：判据必须读生产载体）。并遵循 inherited-core 的既有纪律（五条 clause 的取证形态），
      即「能取假 + 有负控制 + 失败与合格在记录上可区分」。
- [ ] 修复后该文件为文本，且 `file`/`grep` 的读数与人工阅读一致。

## Touches

- `plugin/test/helpers/quay-init-install-fixture.mjs`
- `packages/quay/test/install-config-driven-e2e.test.mjs`
- `tasks/gap-shared-install-fixture-wipe-cannot-remove-readonly-tree.md`
