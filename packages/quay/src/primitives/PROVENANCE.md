# `packages/quay/src/primitives/` — provenance of the four shared session primitives

These four files are **byte-identical copies** of the reference implementations in the
`quay-fleet` repo. They are not re-authored here: SPEC §3.3 is explicit that the only
unacceptable outcome is a **second hand-written implementation** — the session read/write
primitives must exist in exactly one shape, shared with `quay-fleet`.

## Source

| | |
|---|---|
| Repo | `/home/yale/work/quay-fleet` |
| Package | `@quay-fleet/agent-core` |
| Source dir | `packages/agent-core/src/` |
| **Pinned commit** | `446ba9aa860833206945068c92ceac8d0064082b` |
| Commit date | 2026-09-13 14:47:32 +0000 |
| Commit subject | `fleet-agent: global sessionKey uses pidDomain+full sessionId (phase 2 cross-machine prep)` |

The commit is **pinned, not tracked** — the `quay-fleet` working tree keeps moving (that
same file set changed on the day this copy was taken). Copying the working tree would fork
the next day with no signal; pinning a SHA keeps the two sides byte-comparable forever, and
`plugin/scripts/primitives-drift-check.ts` mechanically re-checks it.

## Files

| File | Lines | sha256 of the copy (== sha256 of the fleet blob) | fleet git blob hash |
|---|---|---|---|
| `pty-frame.mjs` | 61 | `0e0934cfc16d3d47f852a4e4eff8c17309b445e74787c15d847e6b9bd85f963a` | `0de07a1ca5d3f0e1f03912a3a802494eb4bd389b` |
| `delivery-audit.mjs` | 235 | `5da101bc15d135a9ecd2bc8ac97382424794673feeef31f2ef59e5b7e7f4d239` | `6a41654c4b1fab944ff30b45e247a68312abe312` |
| `session-liveness.mjs` | 146 | `f2a462a963efe17225a9c32bc58b7fdc6f8a930830417b0c8df1f56cf6a8dab4` | `7a3ca3b43dcabb557a95b67af42b6a00dacb3655` |
| `session-schema.mjs` | 82 | `36350484ebf0d366b49834f0ca7d59cfa1756af39fe06de7aefc9158263cb9b5` | `710eb806899191065a02592f44cea6f1e4ef6b82` |

Reproduce any row with:

```sh
git -C /home/yale/work/quay-fleet show 446ba9aa:packages/agent-core/src/<file>.mjs | git hash-object --stdin
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
  SPEC §3.3 forbids — it just happens to start out identical. Fix the source in
  `quay-fleet`, land it there, then re-pin `primitives-drift-manifest.json` + this file to
  the new SHA in one commit.
- The **manifest is the executable half of this document**:
  `plugin/scripts/primitives-drift-manifest.json` carries the pinned SHA and the four
  sha256 values. The prose here explains *why*; the manifest is what the checker reads.
  When they disagree, the manifest is what the gate acts on — update both together.
- `delivery-audit.mjs` imports `./pty-frame.mjs` — the relative import is satisfied by the
  sibling copy in this same directory, which is why the four move as a set.
