---
id: gap-adr-016-carve-out-permits-the-whole-screen-hash-it-was-meant-to-forbid
title: ADR-016 says NEVER parse the TUI but its "coarse capture-pane check"
  carve-out has no boundary, so both live implementations read it as whole-screen
  md5 — the exact judgment it was meant to forbid
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

外层裁定 A（`orchestration/outer-rulings-2026-08-04-A-F.md`）。

ADR-016 clause 1 的标题是 `NEVER parse the TUI`，但同一条留了一句无边界的 carve-out：

> `capture-pane` is only a coarse "idle / ready-for-input" check + a settle.

「coarse」既不说**允许判哪些状态**，也不说**允许取屏幕的哪一部分**。仓库里两处实现各自把它
读成「整屏等值/哈希比较」，而**两处都没有违反 ADR-016 的字面**：

```
$ grep -n 'capture-pane' plugin/scripts/session-liveness.sh
612:      raw=$(tmux capture-pane -p -t "$target" 2>/dev/null)
# → mask_pane → md5sum，判据是「mask 之后的整屏哈希是否相等」
```

`plugin/scripts/send-keys-verified.sh` 同形（整屏 md5 前后比对，
见 `gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted`，已 superseded）。

**因此 `send-keys-verified.sh` 的哈希判据是「违反 ADR-016 的精神但符合它的字面」**——
该修的是 ADR 的边界，不是只修实现；不修 ADR，下一个实现会以同样的方式再读一次。

### 选定机制

**就地修订 ADR-016**（`status: accepted` 保持不变，追加一节 `## Amendment 2026-08-04`），
不新开 ADR——决定没变，只是把 clause 1 的边界写死。修订必须写明三条边界，
并把 `enforcement:` 从 `N/A — an operational discipline` 改为指向第 3 条的机械检查。

## Acceptance Criteria

- [ ] AC1: ADR-016 追加 `## Amendment 2026-08-04` 一节，明写三条边界：
      (a) 允许用屏幕判定的状态是**枚举**的（waiting-input / permission-prompt / busy / error-banner
      / unknown），不是开放集；(b) 允许取屏幕的**底部区域**（输入框 + 状态行），不是整屏；
      (c) **禁止整屏等值/哈希比较**（`md5(capture-pane)` 一族），无论是否先做 mask
- [ ] AC2: `enforcement:` frontmatter 字段改为指向 AC3 的检查器路径（不再是 `N/A`）
- [ ] AC3: 机械检查器 `plugin/scripts/adr016-screen-use-check.ts` 存在并被 `scripts/test.sh` 的
      `run_static_checks` 调用；判据按**代码位置**（同一条命令里 `capture-pane` 与
      `md5sum`/`sha1sum`/`cksum` 同时出现），**不按关键词**——ADR 修订文本本身必然写着
      `md5(capture-pane)` 这几个字，关键词匹配会命中修订说明而不是缺陷（本仓已记 6 次同形）
- [ ] AC4: `adr016_violations` 落在 `band` 内（当前树上剩余违规数；`send-keys-verified.sh` 已随
      裁定 F superseded，`session-liveness.sh` 由 `gap-pane-state-is-hashed-not-classified-...` 承载）
- [ ] AC5: **负控制**——在一个临时文件里写 `tmux capture-pane -p -t x | md5sum` ⇒ 检查器必须报出；
      删掉该行 ⇒ 必须不报（两次实跑输出贴进任务体）
- [ ] AC6: `CLAUDE.md` 的 tmux remote-drive 条目同步（现文「never parse the TUI」下面补一句
      指向 ADR-016 Amendment 的边界），否则 CLAUDE.md 与 ADR 漂移
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC7 全部勾上，AC5 两个方向的实跑输出逐字贴进本任务体
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）
- [ ] `node --experimental-strip-types plugin/scripts/adr016-screen-use-check.ts` 在干净树上退出 0

## Touches

- adr/ADR-016-cross-workspace-autonomous-operation-via-tmux-remote-drive.md
- plugin/scripts/adr016-screen-use-check.ts (new)
- plugin/test/adr016-screen-use-check.test.mjs (new)
- CLAUDE.md
- scripts/test.sh

## Contract

measure   adr016_violations = `node --experimental-strip-types plugin/scripts/adr016-screen-use-check.ts` stdout 的 violations 字段
band      adr016_violations = 0..1（session-liveness.sh 一处，由姊妹任务承载；新增任何一处即超出）
invariant enumerated_states = 5（waiting-input / permission-prompt / busy / error-banner / unknown）
invoke    `node --experimental-strip-types plugin/scripts/adr016-screen-use-check.ts`
control   在临时文件写 `tmux capture-pane -p -t x | md5sum` ⇒ violations 必须 +1；删掉 ⇒ 必须回落
resume    ADR 修订与检查器分两次提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-04T14:20:00Z
changed: 外层裁定 A 立案。**AC3 的「按代码位置不按关键词」是外层加的**——
本仓已 6 次踩「描述缺陷的词必然出现在缺陷自己的文档里」，而本任务要改的 ADR 文本里
必然逐字写着 `md5(capture-pane)`，关键词式检查器会 100% 命中自己的 ADR 修订说明。
**AC4 的 band 上界写 1 不是 0**：`session-liveness.sh` 那一处由姊妹任务在另一个分支上消除，
本任务若把它一并改掉就与那个任务撞车——band 显式承认这一处存量，新增才算超出。
