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
2. **让失败不放大**：清空中途失败时，结束态**不得比起始态更差**。当前形态会把一个可用的夹具
   变成永久不可重建（marker 没了、只读树还在）。要么删成功，要么原样保留。
3. **消除裸 NUL 字节**：把 :418/:429/:431 的字面 `0x00` 改为转义写法（`\0`），使该文件恢复为文本，
   `grep`/`file` 一类的读取不再静默返回零。

## Acceptance Criteria

- [x] AC1 取假判据（核心）：构造一个「只读子目录 + 无 marker」的夹具目录，跑该夹具的消费者
      （`packages/quay/test/install-config-driven-e2e.test.mjs`）：**修前必 EACCES 失败、修后必重建成功
      且 marker 回来**。须附修前与修后两次实跑读数（不是复述实现）。
- [x] AC2 负控制（不放大）：让清空在删除中途失败，断言结束态不差于起始态——即下一轮仍能重建，
      或明确回到「不存在」。⛔ 不得出现「marker 没了、只读树还在」这一态。
- [x] AC3 该文件恢复为文本：`file` 报文本类；`grep -c <已知为真的串>` 返回真实计数。
      **须附仪器自检**：先用一个已知为真的样本干跑一次该谓词（硬规则 2 的零计数半边）。
- [x] AC4 回归：上述测试文件在**干净起始态**与**已存在只读夹具起始态**两种情况下都绿。

## Definition of Done

- [x] 至少一条判据落在**生产载体**上——真实 `/var/tmp` 夹具 + 真跑该测试文件，而不是只在注入/夹具缝里成立
      （硬规则 4 推论三：判据必须读生产载体）。并遵循 inherited-core 的既有纪律（五条 clause 的取证形态），
      即「能取假 + 有负控制 + 失败与合格在记录上可区分」。
- [x] 修复后该文件为文本，且 `file`/`grep` 的读数与人工阅读一致。

## Evidence

修复落点：`_restoreWriteBits()`（`_makeReadOnly` 的逆）+ `_wipeFixture()`（改名让位 = 单次 rename 的
临界区，改名前不动任何内容；改名后再恢复写位并删那棵让位树，删除失败只孤立它、永不挡夹具路径）。
`_buildSharedFixture` / `_buildVariantFixture` 两条清空路径都改走它。

**AC1 — 修前/修后实跑（同一 worktree、同一 commit、同一夹具目录）**
夹具路径由 plugin surface 内容寻址（`_fixturePath()`），本 worktree 解析为
`/var/tmp/quay-install-fixture-78736c10c311767b`（立案时引的 `8b2f32344ce66b23` 是立案那一刻的哈希，
已于 02:32 被带外 chmod 修成健康态；两者是同一机制的两个实例）。在该路径构造
「`dr-xr-xr-x` 子目录 + 无 `.fixture-ready` + 无 `.install.json`」：

| 次序 | 命令 | 读数 |
|---|---|---|
| 修前 #1 | `node --test --test-name-pattern=A2 packages/quay/test/install-config-driven-e2e.test.mjs` | exit 1；`Error: EACCES … rm`；栈 `_buildSharedFixture (…:281:29)` ← `…:402:31`(A2) |
| 修前 #2 | 同上 | exit 1；EACCES；marker 仍缺 |
| 修前 #3 | 同上 | exit 1；EACCES；marker 仍缺 |
| 修后 | 同上 | **exit 0；✔ A2**；夹具重建，`.fixture-ready`+`.install.json` 回来 |

修前 3/3 EACCES 且**零收敛**（marker 永不出现）⇒ 永久不可重建，与 Finding 一致。

**AC4 — 两种起始态各跑整个文件**

| 起始态 | 前置核对（非断言） | 读数 |
|---|---|---|
| 干净（夹具**不存在**） | `[ -e $WS ]`=NO，已核对 | exit 0；A1/A2/A4 3/3 绿；夹具从零建成 + marker |
| 已存在只读夹具（无 marker） | marker=ABSENT、install.json=ABSENT、`.claude`=`dr-xr-xr-x` | exit 0；A1/A2/A4 3/3 绿；marker 回来 |

⚠️ 首轮我把它记成「干净起始态」是**错的**：当时那句 `rm -rf` 自己也被只读树挡住（exit 1、一个条目都
没删），留下的是**健康**夹具 ⇒ 那一轮其实走的是缓存命中路径。补做前置核对后才算数。

**AC2 — 负控制（不放大）**：新增 `plugin/test/quay-init-install-fixture-wipe.test.mjs`，7/7 绿。
- 测试内对照组：修前算法（裸 `fs.rmSync(recursive,force)`）在同一 shape 上抛 EACCES 且一个条目没删；
- **变异对照**：把 `_wipeFixture` 换回修前行为后重跑 ⇒ **3/3 AC2 用例转红**（AC3 两组仍绿，它们测另一个
  性质）⇒ 这些用例确实在测本次修复，不是恒绿；
- 注入「移动前失败」⇒ 夹具逐字节不变（内容+模式快照全等），marker 仍在——⛔ 明确断言不得出现
  「marker 没了、只读树还在」；
- 注入「删除让位树时失败」⇒ 夹具路径已清空、下一轮可重建（孤立树只落在 `.trash-` 旁路，永不占夹具路径）。

**AC3 — 仪器自检 + 读数**
- 自检（零计数半边）：谓词对**已知含 NUL** 的样本干跑 ⇒ 报出偏移 10；对转义写法样本 ⇒ 报空。
  谓词能取「有」，它报「无」才算数。
- 修前：`file` = `data`；`grep -c sharedFixture`（不带 `-a`）**零输出 + exit 1**，而 `grep -ac` = 11。
  另一处同样现象的实测：`grep -rn 'FIXTURE_PREFIX\|FIXTURE_BASE' plugin/` **命中 0**，
  同一条加 `-a` **命中 4** ⇒ 该文件对不带 `-a` 的 grep 整体隐形。
- 修后：`file` = `JavaScript source, Unicode text, UTF-8 text`（0 个 NUL，3 处 `\0` 转义，`node --check` 通过）；
  `grep -c`（不带 `-a`）= 11 = `-a` 计数 ⇒ 两个读法一致。转义是保值的（`"\0" === String.fromCharCode(0)`），
  故 variant 夹具的内容寻址哈希不变、既有缓存不失效（实测 `_fixtureHash()` 修复前后同为 `78736c10c311767b`）。

**blast radius（次要观察，单列）**：`/var/tmp` 现有 1643 个夹具目录，其中 **1641 个**处于「根级文件被抹掉、
只读子目录原封不动」态——1641 个根目录的 mtime 全部落在 2026-09-16 02:09–02:10 两秒内（此后只有我重建的
两个不同），且这 1641 个**内部文件一个都没少**。这正是修前删除路径的部分删除指纹：根目录可写 ⇒ 根级的
`.fixture-ready`/`.install.json`/`.gitignore` 被删掉，只读子目录则完全够不到；事后 `rm -rf` 也删不掉
（实测 exit 1、一个条目都没删）。1641 是**一次批量清理**的产物、不是 1641 次独立构建失败，但两者同属
本缺陷类——`_wipeFixture` 现在能清掉它们。

## Touches

- `plugin/test/helpers/quay-init-install-fixture.mjs`
- `plugin/test/quay-init-install-fixture-wipe.test.mjs`
- `packages/quay/test/install-config-driven-e2e.test.mjs`
- `tasks/gap-shared-install-fixture-wipe-cannot-remove-readonly-tree.md`
