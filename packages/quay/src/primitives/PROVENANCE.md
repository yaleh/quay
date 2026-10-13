# `packages/quay/src/primitives/` — provenance of the four shared session primitives

These four files are **byte-identical copies** of the reference implementations in the
`quay-fleet` repo. They are not re-authored here: SPEC §3.3 is explicit that the only
unacceptable outcome is a **second hand-written implementation** — the session read/write
primitives must exist in exactly one shape, shared with `quay-fleet`.

⚠️ That reference repo was **retired on 2026-10-12**: the path `/home/yale/work/quay-fleet` was
re-initialized as an unrelated project and no longer carries this code. The pin is therefore read
against a **frozen bare mirror** of the retired repo rather than a live checkout (→
[Why the reference is a frozen mirror](#why-the-reference-is-a-frozen-mirror)). The pinned commit
and all four byte-identity values are unchanged — only the carrier moved.

## Source

| | |
|---|---|
| Repo | `/data/home/yale/work/quay-fleet-org.git` (frozen bare mirror — see below) |
| Retired live repo | `/home/yale/work/quay-fleet` (re-initialized 2026-10-12, no longer carries this code) |
| Archive of record | `/data/home/yale/work/quay-fleet-org.tar.gz` (read-only) |
| Package | `@quay-fleet/agent-core` |
| Source dir | `packages/agent-core/src/` |
| **Pinned commit** | `446ba9aa860833206945068c92ceac8d0064082b` |
| Commit date | 2026-09-13 14:47:32 +0000 |
| Commit subject | `fleet-agent: global sessionKey uses pidDomain+full sessionId (phase 2 cross-machine prep)` |

The commit is **pinned, not tracked** — the `quay-fleet` working tree keeps moving (that
same file set changed on the day this copy was taken). Copying the working tree would fork
the next day with no signal; pinning a SHA keeps the two sides byte-comparable forever, and
`plugin/scripts/primitives-drift-check.ts` mechanically re-checks it.

## Why the reference is a frozen mirror

This pin used to name the **live** fleet checkout (`/home/yale/work/quay-fleet`). On 2026-10-12
that path was re-initialized as a different project — `quay-fleet` was repositioned as a
cross-project AI Engineering Manager, and its own README states the old repo's snapshot is *"仅作
只读参考，不恢复、不迁移代码"*. The pinned commit `446ba9aa` therefore stopped resolving there and
`primitives-drift-check.ts` returned **exit 3 / NOT-EVALUATED on every run**: the honest "I could
not look at the other side" reading (硬规则 3b), but a reading nobody consumed — the two-copy
discipline had no working mechanical defense at all.

The retired repo survives in exactly one place on this host: the read-only archive
`/data/home/yale/work/quay-fleet-org.tar.gz`, taken 2026-10-12 01:06 — five minutes before the
re-init. `fleetRepo` now names a **bare mirror** built from it:

```sh
tmp=$(mktemp -d)
tar xzf /data/home/yale/work/quay-fleet-org.tar.gz -C "$tmp" quay-fleet/.git
git clone --bare --no-hardlinks "$tmp/quay-fleet" /data/home/yale/work/quay-fleet-org.git
```

**What this does not change: the pin.** `fleetSha`, `fleetSourceDir` and the four sha256 values are
the same values as before, and the mirror's blobs at that SHA hash to them — verified at re-pin
time with the two commands under [Files](#files). **What it does change (the honest reading):** the
"other side" is no longer a moving working tree but a frozen artifact, so this checker can no longer
observe upstream movement. What it still defends mechanically is that the copy *in this repo* has
not been edited in place — which is the only failure mode left once the upstream is retired, and is
exactly what the pin catches.

If the mirror is missing the checker says so — exit 3, never a pass, never a fabricated green — and
the block above re-materializes it. (`/data/home/yale/work/quay-fleet-org.git` is deliberately
outside this checkout: it is a copy of *another* repo's history, and it must outlive any re-clone of
this one.)

## Files

| File | Lines | sha256 of the copy (== sha256 of the fleet blob) | fleet git blob hash |
|---|---|---|---|
| `pty-frame.mjs` | 61 | `0e0934cfc16d3d47f852a4e4eff8c17309b445e74787c15d847e6b9bd85f963a` | `0de07a1ca5d3f0e1f03912a3a802494eb4bd389b` |
| `delivery-audit.mjs` | 235 | `5da101bc15d135a9ecd2bc8ac97382424794673feeef31f2ef59e5b7e7f4d239` | `6a41654c4b1fab944ff30b45e247a68312abe312` |
| `session-liveness.mjs` | 146 | `f2a462a963efe17225a9c32bc58b7fdc6f8a930830417b0c8df1f56cf6a8dab4` | `7a3ca3b43dcabb557a95b67af42b6a00dacb3655` |
| `session-schema.mjs` | 82 | `36350484ebf0d366b49834f0ca7d59cfa1756af39fe06de7aefc9158263cb9b5` | `710eb806899191065a02592f44cea6f1e4ef6b82` |

Reproduce any row with:

```sh
MIRROR=/data/home/yale/work/quay-fleet-org.git
git -C "$MIRROR" cat-file -t 446ba9aa860833206945068c92ceac8d0064082b   # ⇒ commit (the pin resolves)
git -C "$MIRROR" show 446ba9aa:packages/agent-core/src/<file>.mjs | git hash-object --stdin
sha256sum packages/quay/src/primitives/<file>.mjs
```

Or re-check all four at once, drift-detector included:

```sh
node --experimental-strip-types plugin/scripts/primitives-drift-check.ts
```

## The `.d.mts` files are NOT part of the copy

Four declaration files sit beside the modules (`pty-frame.d.mts`, `delivery-audit.d.mts`,
`session-liveness.d.mts`, `session-schema.d.mts`). They are **local, hand-written, and not
byte-compared** — the drift checker covers the four `.mjs` files only, and the manifest lists
exactly those four.

They exist because the root tsconfig sets `allowJs` + `checkJs`: a `.mjs` reached by an import is
type-checked as part of the program, and the frozen copies carry no annotations. A sibling
`.d.mts` tells TypeScript "the types are declared here" so the body is not inferred — the
alternative would be adding `// @ts-nocheck` inside the copies, which would break the
byte-identity the whole arrangement rests on. If a copy is ever re-pinned, check the
declarations against the new body.

## Rules for this directory

- **Do not edit these files in place.** A local edit is exactly the "second implementation"
  SPEC §3.3 forbids — it just happens to start out identical. While the upstream repo was live
  the rule continued "…fix the source in `quay-fleet`, land it there, then re-pin to the new
  SHA". **There is no live upstream any more**, so an edit here now means the copy stops being
  byte-identical to the frozen reference and the checker goes RED — which is the correct signal,
  not a nuisance. Clearing it is a deliberate **re-baseline**: change the file *and* re-pin its
  sha256 in `primitives-drift-manifest.json` in the same commit, with the reason stated here and
  in the commit message. Never touch the sha256 alone to silence the check.
- The **manifest is the executable half of this document**:
  `plugin/scripts/primitives-drift-manifest.json` carries the pinned SHA and the four
  sha256 values. The prose here explains *why*; the manifest is what the checker reads.
  When they disagree, the manifest is what the gate acts on — update both together.
- `delivery-audit.mjs` imports `./pty-frame.mjs` — the relative import is satisfied by the
  sibling copy in this same directory, which is why the four move as a set.
