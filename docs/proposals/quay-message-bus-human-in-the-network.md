# Quay Message Bus — Human in the Network

**Status:** implemented by `tasks/gap-message-bus-human-third-target-transport-agnostic` (2026-08-06).
**Cross-ref:** `orchestration/SPEC-integration-architecture-2026-08-05.md` §4.5 (人是第三个 target);
`orchestration/SPEC-isolation-and-resource-governance-2026-08-05.md` §5 (跨边界只留 deliver/observe).

## The problem

The bus's job is to carry **state and messages** across the layer boundary. The SPEC already
fixed the cross-boundary contract to exactly two narrow interfaces:

```
deliver(target, payload) -> delivered | failed
observe(target)          -> {busy, idle, blocked, last_at}
```

But the bus was only imagined between machines. The human is not a machine: they cannot be
injected, they only come to read. If the bus is built machine-only, the human channel becomes a
second, ad-hoc system — and this repo has repeatedly paid for "two systems that must be kept in
sync" (AC9/AC10's "同一个坑"). The constraint before the first line of code: **人是第三个 target,
同一机制不做两套** (human is the THIRD target, same mechanism, not two systems).

## Core constraint: transport-agnostic, not web-feature design

The bus is designed around a **Transport abstraction**, not around any one transport. `deliver`
and `observe` dispatch through a registered Transport; the target only says *who*, the transport
says *how*. The file-inbox transport below is today's `how` for the human target; a SaaS later is
just **a different transport registered for the same target** — a swap, never a rewrite. This is
the fork the task fixes before the first line of code: retro-fixing a web-shaped bus into a
transport-agnostic one is the extreme-cost path.

## Human = third target, same mechanism

| target | `deliver` | `observe` |
|---|---|---|
| inner | session transport (`send-keys` → transcript validation; adapter wired by supervisor step ③) | session transport (`classifyPaneState`) |
| outer | same | same |
| **human** | **file-inbox transport** — writes a timestamped record to `.quay/manager-inbox/` | **receipts** — delivered vs consumed, never absence-inference |

The one real difference for human: **delivered ≠ consciousness-received** (AC3). For a machine,
`delivered` can be verified by the receiver. For a human, the bus can only guarantee the message
was **placed** where they will read it; whether it reached their attention is a separate fact.
Both are modeled, on the same record: `delivered` (record written, timestamped) and `consumed`
(a reader took a receipt). `observe(human)` reports both independently — a "he read it?" query
returns the receipt state, never an inference from silence.

## Consumer mount point first (the ordering hard constraint)

`.quay/manager-inbox/` failed tonight as **"3 messages on disk, nobody reads"**. The first
priority of the human channel is therefore **not delivery — it is the consumer's mechanical
mount point**: a first-class reader (`plugin/scripts/inbox-reader.sh`) that turns `delivered`
into `consumed`. Delivery without a mount point is not delivery; it is the same "written but not
called at decision time" failure this repo has hit repeatedly (AC9/AC10).

The mount point makes the whole channel measurable: `delivered_vs_read =
bash <inbox-reader.sh> 2>&1 | grep -c 'read\|consumed'` — the count of messages the reader has
actually consumed. Band: `>= 1` (delivery ≠ reading; reading has a mechanical mount point).

## AC12b — every human message is measurable

Every human message is a **timestamped, seq-numbered, countable JSON record** in the inbox
(`deliveredAt`, monotonic `seq`, `consumed`/`consumedAt`). This makes "was the human told X"
mechanically answerable for the first time — a property this task's measurability criterion
(AC12b) is built on. No message is a side effect that evaporates; each is a record.

## Fail-safe defect (AC6)

The measurement protocol carries a **fail-safe defect** that must be explicit: if the human
bypasses the channel (tells someone outside the bus, reads out-of-band), the bus **overestimates
the unattended interval** — it looks like the human was absent when they were merely off-channel.
The protocol therefore constrains the measurement's validity explicitly:

> The unattended-interval estimate is valid **only when humans communicate exclusively through
> this inbox channel**. Bypassing the channel overestimates the unattended interval.

Mechanically, `observe(human).measurement.valid` is `false` while `delivered > consumed` — the
channel cannot confirm reading, so the estimate is untrustworthy. The reader's protocol line
states the constraint on every run, and is deliberately kept free of the words `read`/`consumed`
so it can never inflate the `delivered_vs_read` measure.

## Files

- `packages/quay/src/message-bus.ts` — the transport-agnostic bus (TARGETS, transports,
  registry, deliver/observe, inbox record + observation model).
- `plugin/scripts/inbox-reader.sh` — the human channel's consumer mechanical mount point.
- `packages/quay/test/message-bus.test.mjs`, `plugin/test/inbox-reader.test.mjs` — AC1–AC6.
