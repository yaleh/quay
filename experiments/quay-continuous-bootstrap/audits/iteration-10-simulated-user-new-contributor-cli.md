# Simulated-User Audit — Persona A: CLI New-Contributor
# Iteration 10 (quay-continuous-bootstrap, Experiment 4)

**Date:** 2026-07-17
**Persona:** CLI new-contributor (first-time user, skeptical, tests edge cases)
**Verdict:** PASS

---

## Scenario walkthrough

### Install experience

The README now has a clear two-option install section (QX-036):
- **Option A**: `npm install -g quay-*.tgz` — practical for users who just want the binary; the glob pattern avoids the v-prefix bug from iteration 9 synthesis
- **Option B**: from source with `git clone` + `npm install` — expected for contributors

The "Requires Node.js >= 20" requirement is stated upfront. The new `engines` field in `package.json` (`"node": ">=20.0.0"`) means npm will warn at install time if the user's Node.js is too old — a concrete improvement over silent runtime errors.

Assessment: Install experience is clear and actionable for a new contributor. PASS.

---

### `--label` guard behavior

**What I found in the code (bin/quay.js, lines 182–187):**
```js
const rawLabel = flags.label;
if (rawLabel !== undefined && typeof rawLabel !== "string" && !Array.isArray(rawLabel)) {
  console.error("Error: --label requires a value (e.g., --label experiment-4)");
  process.exitCode = 1;
  return;
}
```

As a new contributor, I would try `quay task list --label` expecting either a usage error or a prompt. Before this fix, I would have gotten all tasks back with no indication that my flag was ignored — confusing. Now I get:
```
Error: --label requires a value (e.g., --label experiment-4)
```
...and exit code 1.

The error message is actionable — it shows a concrete example. The behavior is consistent with `--prefix` (which also exits 1 with an identical-pattern error message). This is good consistency for a new user who may try multiple flags.

Assessment: PASS. The UX is clear and consistent.

---

### Empty result message behavior

**What I found in the code (bin/quay.js, lines 262–264):**
```js
if (sorted.length === 0 && searchQuery === null) {
  console.log("No tasks found.");
}
```

As a new contributor testing the tool: `quay task list --status done` on a workspace with no done tasks now prints "No tasks found." instead of silently exiting. This is the right behavior — without it, I would not know if the filter worked correctly or if the tool malfunctioned.

The message is simple and unambiguous. It writes to stdout (consistent with other informational output in non-JSON mode).

Assessment: PASS. The message is appropriate.

---

### `--json` mode edge cases

The "No tasks found." message is inside the `else` block (non-JSON branch). When `--json` is active, `printJson(sorted)` produces `[]` — valid JSON that a consumer can parse. The plaintext message does NOT appear in `--json` mode.

This is correct behavior: JSON consumers expect only valid JSON on stdout. A tool that mixes plaintext warnings into JSON output would break parsers.

Assessment: PASS. The `--json` mode is clean.

---

### Consistency with `--prefix`

| Behavior | `--prefix` (pre-existing) | `--label` (QX-037) |
|----------|--------------------------|---------------------|
| No value passed | `process.exitCode = 1; return` | `process.exitCode = 1; return` |
| Error message | `"Error: --prefix requires a value (e.g., --prefix QX)"` | `"Error: --label requires a value (e.g., --label experiment-4)"` |
| Output stream | stderr (`console.error`) | stderr (`console.error`) |

The guard pattern is identical. Consistency is maintained.

Assessment: PASS.

---

### `--help` coverage of `--label`

The `printHelp()` function in bin/quay.js includes:
```
--label <label>     Filter by label (repeatable: --label A --label B for AND-filter)
```
This is present in the "Options for task list" section. A new contributor reading `--help` will find both the basic usage and the multi-label AND-filter hint.

Assessment: PASS. The help text is adequate.

---

## Gaps found (new, if any)

No new gaps found.

The "No tasks found." message when `--search` AND filter combination yields zero results: when `--search foo --label bar` returns nothing, the search hint fires ("Hint: use --label to filter by label..."), not "No tasks found." This is technically correct (search is active so `searchQuery !== null`), but the hint is slightly misleading — the user IS already using `--label`. Minor behavioral quirk, but not worth a new gap at this point given the existing search-hint text is still informative.

---

## Verdict rationale

All three iteration 10 CLI changes (install docs, `--label` guard, empty result message) work correctly and clearly for a new contributor. The behavior is consistent with pre-existing patterns (`--prefix` guard), the messages are actionable, and the `--json` mode edge case is handled correctly by code structure. No blocking issues or confusing behaviors found.

**Verdict: PASS**
