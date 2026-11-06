# `packages/quay/src/primitives/` — the four shared session primitives

**quay is the canonical home of these four modules.** `pty-frame.mjs`, `delivery-audit.mjs`,
`session-liveness.mjs` and `session-schema.mjs` were originally copied byte-for-byte from the
`quay-fleet` repo; that upstream is retired (2026-10-12) and this directory is now the source of
truth. The copy's history is kept below as a **read-only record**, but it is no longer a rule and no
longer a pointer: nothing in this repo reads an external repository.

What the mechanical check still defends is the one failure mode left — a primitive edited in place
while its recorded baseline says otherwise. SPEC §3.3's rule is unchanged: **the only unacceptable
outcome is a second hand-written implementation**, and a silent in-place fork is how that starts.

## Files — the local baseline

| File | Lines | sha256 (baseline, recorded in `primitives-drift-manifest.json`) |
|---|---|---|
| `pty-frame.mjs` | 61 | `0e0934cfc16d3d47f852a4e4eff8c17309b445e74787c15d847e6b9bd85f963a` |
| `delivery-audit.mjs` | 235 | `5da101bc15d135a9ecd2bc8ac97382424794673feeef31f2ef59e5b7e7f4d239` |
| `session-liveness.mjs` | 146 | `f2a462a963efe17225a9c32bc58b7fdc6f8a930830417b0c8df1f56cf6a8dab4` |
| `session-schema.mjs` | 82 | `36350484ebf0d366b49834f0ca7d59cfa1756af39fe06de7aefc9158263cb9b5` |

Re-check all four, drift-detector included:

```sh
sha256sum packages/quay/src/primitives/*.mjs
node --experimental-strip-types plugin/scripts/primitives-drift-check.ts
```

The checker reads **only** `plugin/scripts/primitives-drift-manifest.json` and these four files. It
needs no external repo, no pinned commit, and no `git` subprocess, so the invariant is evaluable on
any checkout of this repo — including a machine that has never seen `quay-fleet`.

## Rules for this directory

- **These files are canonical here.** A change that genuinely belongs in a primitive is made *in
  this repo* — there is no upstream to fix first any more.
- **An in-place edit is a re-baseline, and the baseline moves in the SAME commit.** Change the
  `.mjs` **and** its sha256 in `plugin/scripts/primitives-drift-manifest.json` together, state the
  reason here and in the commit message. A lone `.mjs` edit is exactly what the checker reddens;
  a lone manifest edit is the "silence the check" move the rule forbids.
- The **manifest is the executable half of this document**:
  `plugin/scripts/primitives-drift-manifest.json` carries the four sha256 values, and
  `plugin/scripts/primitives-drift-check.ts` compares the files against them. The prose here
  explains *why*; the manifest is what the checker reads. When they disagree, the manifest is what
  the gate acts on — update both together.
- `delivery-audit.mjs` imports `./pty-frame.mjs` — the relative import is satisfied by the sibling
  copy in this same directory, which is why the four move as a set.
- **The checker's exit 3 is NOT-EVALUATED, not a pass.** If the manifest is missing, unparsable,
  empty, or carries a non-sha256 value, the checker has no baseline and says so; it never reports
  "consistent" for a comparison it could not perform (硬规则 3b).

## The `.d.mts` files are NOT part of the baseline

Four declaration files sit beside the modules (`pty-frame.d.mts`, `delivery-audit.d.mts`,
`session-liveness.d.mts`, `session-schema.d.mts`). They are **local, hand-written, and not
hash-compared** — the drift checker covers the four `.mjs` files only, and the manifest lists
exactly those four.

They exist because the root tsconfig sets `allowJs` + `checkJs`: a `.mjs` reached by an import is
type-checked as part of the program, and the copies carry no annotations. A sibling `.d.mts` tells
TypeScript "the types are declared here" so the body is not inferred — the alternative would be
adding `// @ts-nocheck` inside the copies, which would change bytes for a reason that has nothing to
do with the primitive. If a primitive is ever edited, check the declarations against the new body.

## Source history — READ-ONLY RECORD, not a rule and not a live pointer

> ⛔ **This section is history only.** It records where the four files came from and why the earlier
> two-repo arrangement ended. Nothing here is an instruction, a location to fetch from, or a
> dependency of any script: `quay-fleet` is retired, the pinned upstream commit is no longer read by
> any checker, and the paths below are preserved only so the provenance of these bytes is traceable.

| | |
|---|---|
| Original repo | `/home/yale/work/quay-fleet` (re-initialized 2026-10-12 as an unrelated project) |
| Archive of record | `/data/home/yale/work/quay-fleet-org.tar.gz` (read-only) |
| Frozen bare mirror | `/data/home/yale/work/quay-fleet-org.git` |
| Package | `@quay-fleet/agent-core` |
| Source dir | `packages/agent-core/src/` |
| **Pinned commit** | `446ba9aa860833206945068c92ceac8d0064082b` |
| Commit date | 2026-09-13 14:47:32 +0000 |
| Commit subject | `fleet-agent: global sessionKey uses pidDomain+full sessionId (phase 2 cross-machine prep)` |
| Fleet git blob hashes at that commit | `pty-frame.mjs` `0de07a1ca5d3f0e1f03912a3a802494eb4bd389b`; `delivery-audit.mjs` `6a41654c4b1fab944ff30b45e247a68312abe312`; `session-liveness.mjs` `7a3ca3b43dcabb557a95b67af42b6a00dacb3655`; `session-schema.mjs` `710eb806899191065a02592f44cea6f1e4ef6b82` |

The commit was **pinned, not tracked** — the `quay-fleet` working tree kept moving (the same file
set changed on the day the copy was taken), so copying the working tree would have forked the next
day with no signal. Pinning a SHA kept the two sides byte-comparable for as long as anybody read the
other side; the four sha256 values above are those same values, unchanged, now serving as this
repo's local baseline.

**How the arrangement ended.** On 2026-10-12 `/home/yale/work/quay-fleet` was re-initialized as a
different project — `quay-fleet` was repositioned as a cross-project AI Engineering Manager, and its
own README states that the old repo's snapshot is *"仅作只读参考，不恢复、不迁移代码"*. The pinned
commit stopped resolving there and `primitives-drift-check.ts` returned **exit 3 / NOT-EVALUATED on
every run**: an honest "I could not look at the other side" (硬规则 3b), but a reading nobody could
consume — the two-copy discipline had no working mechanical defense at all. A frozen bare mirror was
built from the read-only archive to keep the check evaluable for a while; that was a stopgap, since
it could only ever confirm "this repo's copy has not been edited in place". On 2026-11-06
(`tasks/gap-primitives-decouple-from-quay-fleet`) the direction was reversed: **quay became
canonical**, the external repo pointer left the manifest and the checker, and the identical
"not edited in place" reading is now produced from a local baseline that works on any machine.
