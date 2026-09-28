# `readManifest` is a deliberate per-package copy — disposition of finding `p197`

**Disposes of:** `tasks/gap-routine-semantic-dedup-scan-p197.md`
**Finding:** `.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · runId
`semantic-dedup-scan-1790592211995` · ts `2026-09-28T10:43:31.995Z` · findingId `p197` ·
kind `byte-identical-body` · verdict `real-duplication` · suggestedAction `extract`.
**Disposition:** ⛔ **do not extract — the per-package copy IS the correct shape.** The
finding's *observation* is correct and reproducible; its *requested action* is not
performable without an architectural regression, and the same scan's sibling candidate
`p141` reached the same conclusion with the same reason.

## 1. The observation reproduces

`packages/quay-backlog/src/manifest.ts` and `packages/quay-github/src/manifest.ts` have
byte-identical bodies — comment-stripped, the two files hash the same, and they are the
**only** such pair anywhere under `packages/*/src` (1 of 122 files):

```
# comment-stripped body hash — identical for the pair, different for quay-native
for f in packages/quay-native/src/manifest.ts packages/quay-github/src/manifest.ts \
         packages/quay-backlog/src/manifest.ts; do
  printf '%-46s ' "$f"
  grep -v '^\s*//' "$f" | grep -v '^\s*$' | sha256sum | cut -c1-16
done
```

So `p197` is a real measurement. Nothing below disputes it.

## 2. Why `extract` is rejected — four mechanical readings

### ① The dependency boundary is real, declared, and asymmetric

```
grep -n '"quay"' packages/quay-native/package.json packages/quay-github/package.json \
                     packages/quay-backlog/package.json
grep -rn "from ['\"].*quay/" packages/quay-github/src packages/quay-backlog/src
```

- `quay-native` declares `"quay": "*"`.
- `quay-github` and `quay-backlog` declare **no `quay` dependency at all** — their only
  Core touchpoints are `import type { … } from "../../quay/src/abi.ts"`, which is erased
  at runtime.

A shared `readManifest` would have to be imported from `packages/quay/src`, which converts
those two `import type` touchpoints into a **runtime** dependency on Core. The packages'
stated reason to exist is that they *prove the ABI transfers* (`package.json` descriptions;
CLAUDE.md, "three packages, one ABI") — a provider that must load Core to read its own
`provider.yml` no longer demonstrates that. This is exactly the argument the *same scan*
recorded for `p141`: `leave (per-package ABI independence is deliberate)`.

### ② The shareable residue is one line, and the variable part cannot be shared

The only genuinely common line is `YAML.parse(raw) as Manifest`. The path derivation is
per-module **by construction**, and the sibling proves it: `quay-native` already took the
generalised, parameterised form —

```ts
export function readManifest(manifestPath: string = DEFAULT_MANIFEST_PATH): Manifest
```

— and **still carries its own `DEFAULT_MANIFEST_PATH` constant**. Parameterising did not
remove the per-package constant; it moved the same `path.join(__dirname, "..", "provider.yml")`
into the caller. Extraction therefore buys one line per provider while paying reading ①.

### ③ The module is the packaging *seam*, not an incidental helper

```
packages/quay-native/scripts/manifest.sea-shim.js      # esbuild --alias replacement
packages/quay-native/scripts/build-dist.mjs:14-18      # why __dirname-relative works in the ESM bundle
grep -n 'alias' packages/quay-native/scripts/build-sea.sh
```

Under Node SEA `import.meta.url` is empty, so the `__dirname`-relative read breaks — which
is why `quay-native` carries a build-time alias replacing this module with a shim that
inlines `provider.yml` via esbuild's `text` loader. This module is therefore **the point
where each provider's packaging strategy bites**, and every provider needs to control it
itself (`quay-native`: SEA alias; `github`/`backlog`: plain file read). Hoisting it into
Core moves a packaging-sensitive seam to a place where per-provider packaging control is
impossible. (The 2026-09-21 round noted the same thing: "the `__dirname`-relative
`provider.yml` read is already proven packaging-hostile since only quay-native added a SEA
shim.")

### ④ The hazard the finding names — silent drift — has never occurred

Hard rule 12: no new mechanism without an occurrence reading. The reading here is **0**:

```
git log --oneline --follow -- packages/quay-github/src/manifest.ts
git log --oneline --follow -- packages/quay-backlog/src/manifest.ts
```

The output is creation-and-port commits only — github: `def5c9262` (created as
`manifest.js`) → `78ec9631b` (its own JS→TS port); backlog: `def5c9262` → `c005bbd22` (its
provider's creation) → `8c4bc9eae` (its own JS→TS port). **No commit in the pair's history
is a drift or a re-sync**, and the two are byte-identical today. So the failure mode `p197`'s rationale cites ("a path/schema fix in
one silently misses the other") is a hypothesis with zero instances, not a measured cost.

**Conclusion.** `extract` is a net-negative trade: it buys one line and a claim of DRY, and
pays with a runtime Core dependency for two deliberately standalone providers plus the loss
of a per-provider packaging seam — for a hazard with a zero occurrence rate.

## 3. The mechanism that should have disposed of this, and where it fails

This pair has been flagged by **seven** `semantic-dedup-scan` rounds (2026-09-13 … 09-28)
and produced **one** task. The governing mechanism is
`plugin/scripts/routine-file-gate.ts` (the `quality` / `action` / `dedup` / `rate` gate)
driven by the ordered filing loop in `plugin/scripts/probe-routine.ts`. **It fails at the
step "compare candidates that share a dedup subject but contradict each other"** — a step
that does not exist.

The evidence is the 09-28 filing round itself: 226 candidates, 3 filed, 223 rejected, and
**three candidates on the identical symbol set `{readManifest}` carrying three mutually
contradictory dispositions**:

| findingId | suggestedAction | gate outcome (verbatim from the carrier) |
|---|---|---|
| `p141` | `leave (per-package ABI independence is deliberate)` | **rejected** — `action: finding declares no requested action (suggestedAction="leave (per-package ABI independence is deliberate)") ⇒ a measurement, not work` |
| `p197` | `extract` | **ACCEPTED → filed** |
| `p198` | `merge` | **rejected** — `dedup: the board holds 'symbols:readmanifest' but its owner's status was NOT EVALUATED (the key was recorded by THIS round's own acceptance, not read from a board file) ⇒ fail-closed …` |

```
python3 - <<'P'
import json
for line in open('.quay/routine-findings.jsonl'):
    r = json.loads(line) if line.strip() else None
    if not r or r.get('runId') != 'semantic-dedup-scan-1790592211995' or r.get('kind') != 'filing-round':
        continue
    print('candidates', r['candidates'], 'filed', r['filed'])
    for x in r['rejected']:
        if x.get('findingId') in ('p141', 'p197', 'p198'):
            print(' ', x['findingId'], '|', x['gate'], '|', x['reason'])
P
```

The failure is structural, not a bug in any one branch:

- The **`action:`** gate correctly filters a `leave` candidate as "a measurement, not work",
  but it is evaluated **per candidate, in order**. It therefore drops `p141` — the one
  verdict that is backed by the dependency-boundary evidence — without ever comparing it to
  its contradictory sibling.
- The **`dedup:`** branch keys on the **symbol set** (`symbols:readmanifest`). That is the
  axis on which the three candidates are *identical*, so it can only ever suppress a
  candidate that arrives **after** the key is on the board (as it did for `p198`). It can
  never suppress the candidate that *created* the key — and it is structurally incapable of
  noticing that the key's own owner disagrees with a rival verdict under the same key.
- Consequently **whichever contradictory candidate declares an action wins the filing
  slot**, and the `leave` verdict — the one the evidence supports — becomes unreachable
  simply by arriving first.

That is why a pair with a zero-incident drift history kept consuming a scarce filing slot
(`DEFAULT_RATE = 3` per window) in a gate that rejects 223 of 226 candidates.

**Recommended follow-up (not done here — it is a change to the gate, not to this pair):**
give the gate a *contradiction* step over a dedup subject — when ≥2 candidates in one round
share a `symbols:` key and their `suggestedAction`s disagree, the round must surface the
conflict rather than letting ordering decide. This is filed as an observation, not a
blocker, per hard rule 12: the *drift* reading is 0; the measured cost is the recurrence
(7 rounds → 1 task) documented above.

## 4. What was changed instead

Both `manifest.ts` headers now carry the decision, its two reasons, and a pointer to this
document — so the next round's fresh-context analyst reads the disposition *at the site the
finding names*. The comment-stripped bodies are untouched, so the detector's measurement
(`byte-identical-body`) still holds: this is a recorded decision, not a metric that was
engineered away.
