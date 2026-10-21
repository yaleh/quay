---
id: gap-meta-isbodylanded
title: slot-refill 的 landed-implementation 闸把「完成框全勾」自报当落地证据 ⇒ 未删除的 ready 任务永久不可派
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
GOAL-907 唯一的推进任务 gap-ac911-src-root-forwarding-shim-deletion 处于 ready，但 slot-refill 以 reason=landed-implementation 永久排除它：landed = hasLandedImplementation(git 侧=false，命名该 id 的提交全是 task_write/merge 簿记) || isBodyLanded(任务体完成框 10/10 全勾=true)。isBodyLanded 是纯自报、无任何树侧证据，而该任务声明的 10 个 shim 一个都没删（AC-911 判据 fail，读数 12）⇒ 唯一能推进该 goal 的任务永不派发，readings 的 timeSeries 显示同一 verdict 已连续 20 轮未变（crossed，阈值 8）。

本轮读数（timeSeries.0.crossed）= `true`，采于 2026-10-21T05:09:26Z，由 meta-driver 机械采集。
⚠️ 机制词 `isBodyLanded` 命中【已完成】任务：gap-ac47-completion-predicate-consumer-fail-closed.md[done]、gap-fanin-suite-gate-no-baseline-equivalent-exception.md[done]、gap-phantom-killer-false-negative-id-not-in-commits.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [x] `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j;try{j=JSON.parse(d)}catch(e){console.error("unreadable slot-refill output");process.exit(2)}const hit=(j.deferred||[]).find(x=>x&&x.id==="gap-ac911-src-root-forwarding-shim-deletion"&&x.reason==="landed-implementation");if(hit){console.error("still deferred as landed-implementation while its 10 shims are undeleted");process.exit(1)}console.log("OK: not swallowed by the body-side landed gate")})'` ⇒ 红→绿：今天 exit 1（该任务仍被 landed-implementation 吞掉）；修好后 exit 0——「完成框全勾」不再单独构成落地证据，该任务回到候选（或已如实落地）。判据读 slot-refill 的生产输出，不看源码拼写，重排源码不影响结论。 —— 实测 exit 0 / `OK: not swallowed by the body-side landed gate`（worktree 根，2026-10-21）。⚠️ 如实说明：该 id 现已真落地（status done，develop 上 10 个 shim 已删），所以「exit 0」本身不再有区分力；区分力由下面 DoD① 的负控制提供（把实现改回旧形态时判据同级红）。

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红） —— 能取假是【实测】的：把 `plugin/scripts/slot-refill.ts` 的 `const landed = gitLanded;` 改回 `gitLanded || bodyLanded`（即修复前的自报臂）后，`node --test plugin/test/slot-refill-s16.test.mjs` 的 `SELF-REPORT IS NOT LANDING EVIDENCE` 一条 **红**：`AssertionError: self-report alone must NOT defer, got: landed-implementation`；恢复实现后 7/7 绿。
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制 —— 结论：**已有机制在管（ready-pool-check.notYetFlipped，其完成臂被树侧 taskWorkLanded 闸住，并保留 leftover-worktree 豁免），slot-refill 的 body 侧 OR-in 是它的无证据平行分支**。修法是删掉那条平行分支：`isBodyLanded` 降为观察量（仍计入 `phantom_killer_false_negative_caught`），落地一律由树侧断言；假阴性类改由带证据的 pool 判官排除（见 Evidence 的实测）。

## Evidence

**根因（为什么这不是「再补一层」，而是删掉一条平行判定）**：`isBodyLanded`（ACs 全勾 + 未勾项均为外层验证）是**自报**——结构上不可能取假（硬规则 4）。被 OR 进 `landed` 后，它压过了上一层刚刚做对的判断：ready-pool-check 的 `notYetFlipped` 对 ac911 **没有**判 not-yet-flipped，正是因为它有 `LEFTWORK WORKTREE EXEMPTION`（开放的 `task/<id>` worktree = 「fan-in 还没完成」的**直接量** ⇒ 任务必须保持可派）。slot-refill 这一层没有 worktree/landing-ref 知识，于是用自报把这条直接量重新盖掉 —— 任务被永久 bury。所以修法是把判定收回有证据的那一层，而不是在 slot-refill 里再造一个 corroboration。

**改后行为（两条 s16 用例，互为正负控制）**：
- `SELF-REPORT IS NOT LANDING EVIDENCE`：ready + 完成框自报全勾 + 树侧零落地证据 ⇒ **不再** defer `landed-implementation`，回到 `recommended`（可派）。修复前同一夹具 ⇒ deferred `landed-implementation`（上面 DoD① 的实测红）。
- `ID-LESS LANDED`：实现已在 develop、但提交消息从不含 id（phantom-killer 假阴性原案）⇒ 仍被排除，只是判官换成 pool 的 `not-yet-flipped`（`taskWorkLanded` 的 `(new)`-touch 存在性 = 树侧证据；夹具里 `plugin/scripts/impl.ts` 确实在盘上）。即原任务要修的那一类**没有回归**，只是不再由自报承担。

**读数**：
- `node --no-warnings --experimental-strip-types --test plugin/test/slot-refill-*.test.mjs` ⇒ **121/121 pass, 0 fail**（含 s14/s15/s17 等全部 slot-refill 分片）。
- `bash scripts/test.sh --for-task gap-meta-isbodylanded --allow-thin` ⇒ **exit 0**（含 `fan-in-ac-completion-gate` 3/3、静态检查全 PASS）。
- `anti-drift-touches-check --task gap-meta-isbodylanded --worktree <wt> --merge-target develop` ⇒ `ANTI-DRIFT OK … 3 actual file(s), all within declared Touches`。
- 生产 AC 判据 ⇒ exit 0（见 AC①，注意上面那条区分力说明）。

**观察项（未在本任务内修，不阻塞）**：`ready-pool-check.notYetFlipped` 末尾的 `|| allChecked` 也带一条纯自报臂（全勾即排除），它只在**没有** leftover worktree 时才起作用——即它的危险面已被 worktree 豁免挡住，与本任务的实测形态（有 worktree）不重叠。本任务 Touches 不含 `ready-pool-check.ts`，故只记录不扩范围。

## Touches
- `plugin/scripts/slot-refill.ts`
- `plugin/test/slot-refill-s16.test.mjs`
- `plugin/test/helpers/slot-refill-harness.mjs`
- `tasks/gap-meta-isbodylanded.md`