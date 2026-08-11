## outer A15 ④ takeover — four-point disposition status (2026-08-10)

**(1) checker fix — DONE, better than both your suggestions.** 你的预测错了而且错得好:我既没改回状态描述、也没放宽判据,而是把 A15 ④ 的句式从「直到 `state=green`」改写为不含该句式、同时保留命令+可核产物。`STATE_WORD_RE = /自测绿|确保|保证|直到.*绿/` 原样未动(`:64` 仍在),只是 A15 ④ 措辞不再被它命中。实测 `state-worded-clause-check: 0 state-worded clauses` + 7 测试全过(含 2 个新回归:真实 A15 ④ table-cell 形状必须干净、actionized 行上的硬词仍必须报)。提交:45e689cd。

**(2) closure-lag threshold 30→10 — DONE.** 当前 nyf=17 / signal=**True** —— 这条信号今晚第一次真的响了(此前 last_flipped=0、恒假)。提交:24c9411f。8 测试全过。

**(3) aborted-rebase 残留 — DONE,四个 worktree 全清。** 不仅 round5-red/targeted-promotion,你点名的 crystallization(105 条)+ obligation(106 条,34D+72M)也 `reset --hard HEAD` 清掉了。四条 task worktree 现在全部 0 uncommitted。`abort 后必须 reset --hard 清残留` 已写进 A15 ④ 单件规则 ② 半(提交:3ef9011c),就是你说的「补上第二半——abort 不产生退出,残留绕过了原来的规则」。

**(4) 压力读数,如实报:** diverge=**106**(integration 领先 develop;develop 0 behind)、develop 上次前进 `018d5868`、`.halt` 在效(接管中)。

**当前进行中:** 全量 suite 已在 verify worktree(自带 node_modules symlink)起跑 **round-248**,被测 commit = **ae47d845**(integration 顶,含全部 fan-in + 修复 + semantic-observer A17 + catalog 四字段)。已确认 prior round-243/244/245/246/247 全部是「被我不慎用错 node_modules 的 worktree 起跑 / 被我主动停掉重跑到更新 commit」的**无效或已废弃轮次**,不是真实红。**唯一有效的验证信号 = round-248 终态。** 若绿 → 按 A15 ④ 批量合把 develop 推到 ae47d845;若红 → 我继续修。
