---
id: gap-develop-red-set-writer
title: quay driver 写 .quay/develop-red-set.json（当前 develop 红签名集）
status: todo
labels:
  - cockpit
parent: null
children: []
extra:
  schema: execution
---
## Proposal

cockpit 救援类第一个自动候选需要机械信号「develop 上对应红签名已消失」——E1b 证明 LLM 判「阻塞已修」AUC 0.557、无零误挂阈值（见 claudecodeui `experiments/cockpit-decision-judge/REPORT.md`），所以判定必须机械。现状 `.quay/baseline-red-rounds.jsonl` 是 append-only、按 task 记「见到红」，**没有「红消失」事件**，读不出「当前 develop 红签名集」。新增 `.quay/develop-red-set.json`：quay driver 在 fan-in 的 baseline-red 判定后维护；fleet 只读它做「可重派」判定（fleet 侧 companion 任务 `fleet-cockpit-rescue-actions`）。

## Plan

1. 形状 `{develop: "<sha>", evaluatedAt: "<iso>", reds: [{key:"<test file>::<test name>", files:[...], firstSeenAt, lastSeenAt, blockedTasks:[...], lastSignature:"<raw, reference only>"}]}`。
2. 键 = test file + test name（⛔ 不用 assertion 正文——数字一动如 ratchet `1642→1688`→`1642→1690` 还在红却像消失 → 假重派；正文只进 lastSignature 参考）。
3. 写入时机：fan-in 的 baseline-red 判定后 upsert——红 → upsert 该 key（更新 lastSeenAt/blockedTasks/lastSignature）；绿（develop 上 suite 通过该 key，且 `develop` ≥ 该 key 记录的 `develop`）→ 移除该 key。移除 = 红签名消失的机械信号。
4. 写者只有 quay driver（⛔ fleet 永不写；fleet 只读 + 对缺文件/坏行容错）。⛔ 不在 `.quay/` 之外另造载体。

## AC

- [ ] AC1: 文件形状符合契约（develop/evaluatedAt/reds[] 各字段齐）。
- [ ] AC2: 键用 test file::test name，assertion 正文只进 lastSignature。
- [ ] AC3: baseline-red 红 → upsert 该 key；绿（通过）→ 移除该 key；移除后文件不再残留已消失 key。
- [ ] AC4: 写者只有 driver 进程（fleet 侧只读不变式；本任务测试断言写路径无 fleet 写）。
- [ ] AC5: 同一 key 的 lastSignature 变化（如数字变）不改变 key 身份——仍按同一 key upsert，不产生新 key。

## DoD

在 landed 提交上，driver 在 fan-in 后维护 develop-red-set.json，fleet 能读到「当前 develop 红签名集」及「某 key 已消失」。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/scripts/worker-fan-in.ts
- plugin/test/develop-red-set.test.mjs（新）
- tasks/gap-develop-red-set-writer.md
