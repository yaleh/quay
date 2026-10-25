# How an external consumer locates the quay CLI

> **Single source of truth for this contract.** `README.md`, `plugin/skills/init/SKILL.md` and the
> header of `plugin/bin/quay` **link here**; none of them restates a resolution rule. If a rule in
> this file and a rule somewhere else disagree, this file wins and the other copy is the bug.
>
> Reference implementation of everything in §5–§6: `plugin/scripts/resolve-quay-cli.ts`
> (shipped as `scripts/dist/resolve-quay-cli.js`; the artifact deletes raw `.ts`).
>
> Every factual claim below carries either a **measured** date + the Claude Code version it was
> measured on, or an explicit **未验证 / unverified** marker. Nothing is stated as fact because the
> official documentation says so.

**Audience.** A process that is *not* inside a Claude Code session — a cron job, a systemd user
unit, a web server, a CI step, another agent runtime — and needs to run `quay`. It has no
`${CLAUDE_PLUGIN_ROOT}`, no plugin `bin/` on its `PATH`, and (crucially) no way to tell which
installed version this project is pinned to.

---

## 1. The four mechanisms, and why only one of them is a version pin

| mechanism | what it gives you | who can see it | is it a *pin*? |
|---|---|---|---|
| `quay` on `PATH` | *some* quay | whoever's `PATH` it is | ⛔ **no** — see the measurement below |
| `<plugin-root>/bin` on `PATH` | the plugin's own shim | only Claude Code's **Bash tool**, only for that session | ⛔ no — it is a session artifact, not a project pin |
| `${CLAUDE_PLUGIN_ROOT}` | the plugin root of the **running** context | only contexts Claude Code itself spawns (skills, hooks, agents, MCP servers) | ⛔ no — it does not exist for you |
| `<project>/.quay/plugin` | a symlink that used to point at a plugin root | anyone | ⛔ **retired** — `quay init` no longer creates it (§7) |
| **`installed_plugins.json` + the plugin-scope tier rule** | **the version directory this project's sessions load** | any process that can read `$HOME` | ✅ **yes — this is the contract** |

### 1.1 `quay` on `PATH` is not the pin (measured 2026-10-26, Claude Code 2.1.310)

On the machine this document was written on, one project pins plugin **0.22.0** in its install
record, while `quay` on `PATH` is a **different build**:

```
$ command -v quay
/data/home/yale/work/quay/plugin/bin/quay
$ quay --version
0.23.0-dev
$ node …/resolve-quay-cli.ts --project /data/home/yale/work/quay --field version
0.22.0
```

Two builds with two different verb sets and two different `.quay/` behaviours. Resolving by name
would have silently picked the wrong one. **This is the failure the whole contract exists to
prevent**, and it is why §6's negative controls refuse instead of falling back.

### 1.2 `<plugin-root>/bin` on `PATH` is a Claude Code session artifact

* Claude Code puts every enabled plugin's `bin/` directory on **its Bash tool's** `PATH`
  (measured 2026-09-02 for `gap-ac261-plugin-bin-shim-missing-so-cli-needs-npm-global`, recorded as
  T4 in `orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` §3a/§9). On this host
  (2026-10-26, 2.1.310) the entry is the **last** element of the Bash tool's `PATH`, not the first —
  the position is not part of any contract, so ⛔ do not depend on being first.
* That `PATH` is **not inherited** by anything the session launches, and it does not exist at all
  for a process started outside a session (cron, systemd, a server). ⛔ Do not design around it.

### 1.3 `${CLAUDE_PLUGIN_ROOT}` only exists inside contexts Claude Code spawns

* Measured (2026-10-25 and again 2026-10-26, 2.1.310): the variable is **unset** in the Bash
  tool's environment; the 2026-10-25 cross-project lesson records the same reading.
* It *does* get expanded where Claude Code itself launches a process: `claude plugin list --json`
  returns the quay MCP server's argv as the literal
  `["${CLAUDE_PLUGIN_ROOT}/vendor/quay/dist/quay.js", "mcp"]` (measured 2026-10-26) — i.e. the
  harness expands it at spawn time, in the spawned process. An external consumer is not such a
  process, so it gets nothing.

---

## 2. The install record — `~/.claude/plugins/installed_plugins.json`

Measured 2026-10-26 on Claude Code 2.1.310. Shape (abridged to the fields this contract uses):

```json
{
  "version": 2,
  "plugins": {
    "quay@quay": [
      { "scope": "user",
        "installPath": "/home/<user>/.claude/plugins/cache/quay/quay/0.22.0",
        "version": "0.22.0",
        "installedAt": "2026-10-04T02:22:34.098Z",
        "lastUpdated": "2026-10-21T14:32:43.311Z",
        "gitCommitSha": "586f5511…" },
      { "scope": "project",
        "projectPath": "/home/<user>/work/quay-fleet",
        "installPath": "/home/<user>/.claude/plugins/cache/quay/quay/0.19.0",
        "version": "0.19.0",
        "installedAt": "2026-10-10T02:22:16.205Z",
        "lastUpdated": "2026-10-11T17:12:35.788Z" }
    ]
  }
}
```

| field | meaning | missing ⇒ |
|---|---|---|
| key `"<plugin>@<marketplace>"` | the plugin id; quay has **two channels** — `quay@quay` (published) and `quay@quay-dev` (dev, a `directory` marketplace pointing at a checkout's `plugin/`) | that channel has no records |
| `scope` | `user` \| `project` \| `local` — **where the install record lives**, which decides the tier (§2.1) | entry cannot win the tier |
| `projectPath` | present for `project`/`local` only: the directory the record is bound to | entry cannot match a project |
| `installPath` | **the version directory** — this is the answer (§3) | nothing to resolve ⇒ refuse |
| `version` | the version string the record claims | entry cannot win a deterministic tie-break |
| `installedAt` / `lastUpdated` | ISO-8601 timestamps | not needed to resolve |
| `gitCommitSha` | present for marketplace-sourced installs | not needed to resolve |

**`enabledPlugins` is not part of this.** The settings files (`~/.claude/settings.json`,
`<project>/.claude/settings.json`, `<project>/.claude/settings.local.json`) carry
`enabledPlugins: { "<id>": true|false }`, which decides whether an *already installed* plugin is
**enabled**. It never says which directory or version; ⛔ do not try to resolve a path from it.
Measured 2026-10-26: user settings say `"quay@quay": true` while the project's
`.claude/settings.local.json` says `"quay@quay": false`, and `claude plugin list --json` reports
`enabled: false` for every `quay@quay` entry — the effective value is a **merge across layers and
across cwd**, which is exactly why it is useless as a locating input.

**Why read the record itself rather than `claude plugin list --json`?** Both come from the same
data. `plugin list --json` is a *derived* view: it adds `mcpServers`, merges `enabled` /
`projectEnabled` per cwd, costs a process spawn (measured 0.42 s on 2026-10-26, 2.1.310), and — as
§8 records — it does **not** list a plugin that is enabled from a `directory` marketplace but was
never installed. A consumer that needs a path should read the primary record.

### 2.1 The tier rule (the session layer's, not invented here)

Among the records for **one plugin id**:

1. a `project` **or** `local` record whose `projectPath` resolves (realpath) to this project **wins**;
2. otherwise, the `user` record;
3. otherwise there is no answer — ⛔ **not** "look harder on `PATH`".

When several records tie at the same tier, take the **highest `version`** (deterministic; never
"the first one in the file").

Source of the rule: `packages/quay/src/init.ts`'s plugin-link header records it as measured
2026-10-06 — *"the registry tier rule (`projectPath`-matching local/project entry wins, else the
`user` entry)"*. `packages/quay/src/loaded-version.ts` (`projectScopedVersionReading`) implements
the same rule for the product side. ⚠️ **Two consumers of one rule is already one too many**: if
the rule ever changes, `loaded-version.ts`, `resolve-quay-cli.ts` and this section must change
together.

Measured 2026-10-26, 2.1.310 — the tier rule is what makes the answer differ per project on this
host: `quay@quay` has a `user` record at 0.22.0 and a `project` record at 0.19.0 for
`quay-fleet`, so `/…/quay` resolves to **0.22.0** and `/…/quay-fleet` resolves to **0.19.0**
(§5.3).

---

## 3. Version directories

* `installPath` **contains the version** (`…/cache/<marketplace>/<plugin>/<version>`). An upgrade
  writes a **new** directory and rewrites the record; it does not modify the old directory.
* ⇒ A path captured today can be **stale tomorrow**, in two different ways: (a) the record now
  points elsewhere — re-resolve and you get the new directory; (b) the record still points at a
  directory Claude Code has **deleted** — that is `absent`, not "try again later" (§4, §6).
* **Do not pin the version directory into your own config.** Store the *project*, resolve the path
  at start-up (and after any long sleep). This is the same lesson `quay init` learned when it
  stopped writing `<project>/.quay/plugin` (§7).
* The plugin root carries its own version record: `<installPath>/.claude-plugin/plugin.json`
  `.version` (measured 2026-10-26: `0.22.0` and `0.19.0`, matching the registry). ⛔ Do **not** use
  `quay --version` as a version reading of an installed artifact: the shipped bundle can embed a
  dev version (`gap-release-bundle-embeds-dev-version-after-stamp`). The resolver reports both and
  never reconciles them silently.

---

## 4. `.orphaned_at` — what is actually known, in two halves

Claude Code writes a marker file `.orphaned_at` into a version directory it has stopped using
(update / uninstall). The marker's **content is a millisecond epoch** — *not* an ISO string
(measured 2026-10-25, 2.1.310, on the markers listed below).

### 4.1 Marking side — **measured**

Measured 2026-10-25 on Claude Code 2.1.310 (`claude --version`), re-read 2026-10-26:

| directory | `.orphaned_at` | local time |
|---|---|---|
| `…/quay/quay/0.10.0` | 1792934659273 | 2026-10-25 21:24:19 |
| `…/quay/quay/0.11.0` | 1792938386978 | 2026-10-25 22:26:26 |
| `…/quay/quay/0.14.0` | 1791739026393 | 2026-10-12 01:17:06 |
| `…/quay/quay/0.20.0` | 1792594358408 | 2026-10-21 22:52:38 |
| `…/quay/quay/builtin` | 1792935788815 | 2026-10-25 21:43:08 |

`0.19.0` and `0.22.0` carry **no** marker — those are still the two versions in use.

### 4.2 Deletion side — **observed (indirectly), with the observation stated**

The task that produced this document predicted, from the 14-day figure in the official
documentation, that the directories marked on 2026-10-12 would disappear on **2026-10-26 between
01:12 and 01:17**. What was actually observed on this host (Claude Code 2.1.310 throughout):

* **2026-10-25** (when the task was written): `0.14.0`, `0.15.0`, `0.16.0`, `0.17.0` all present
  with `.orphaned_at` markers dated 2026-10-12 01:12:35–01:17:06.
* **2026-10-26 03:46** (this document's read-back): `0.15.0`, `0.16.0`, `0.17.0` are **gone**;
  `0.14.0` is **still there**.
* The parent directory `…/cache/quay/quay` has mtime **2026-10-26 01:17:33** — i.e. entries were
  removed from it in the predicted window. In the *same* 01:10–01:25 window, two other cache
  directories changed as well: `…/.claude/plugins/cache` and
  `…/cache/claude-plugins-official/frontend-design` ⇒ the sweep is **machine-wide**, not per plugin.
* Independent corroboration that `0.17.0` existed until then: 18 live processes still carry
  `…/cache/quay/quay/0.17.0` in their argv (their directory is gone; the processes keep running).

⚠️ **What is inference, not observation:** we did not observe the delete syscall. "Deleted by the
Claude Code janitor at ~01:17:33" is the only explanation consistent with (a) presence on 2026-10-25,
(b) absence on 2026-10-26, (c) the parent mtime, (d) the simultaneous churn in an unrelated
marketplace. Treat the **event** as observed and the **agent** as inferred.

⚠️ **The "14 days" figure is not verified as a policy.** Our readings are *consistent* with a
14-day threshold (a directory marked 2026-10-14 — 12 days old — was still present on 2026-10-26;
three marked 2026-10-12 — 14 days — were removed), but it remains the official documentation's claim,
and a claim is not a reading.

### 4.3 `.in_use/` — why an expired directory can survive (inferred, strongly correlated)

Every version directory carries `.in_use/<pid>` marker files whose content is
`{"pid": <pid>, "procStart": "<starttime>"}` (measured 2026-10-26). Reading every cache directory
on this host in the same pass:

* Every orphaned directory **older than 14 days that survived** has markers whose PIDs are **live**
  (`0.14.0`: 2 live; `archguard/0.1.35`, 2026-10-03: 3 live; `archguard/0.1.36`: 2 live;
  `archguard/0.1.40`: 1 live).
* `0.14.0` survived **past** its 14-day deadline (marked 2026-10-12 01:17:06; read at 2026-10-26
  03:46 — 14 days 2.5 hours later) and its `.in_use` mtime is 2026-10-26 01:17:33, the sweep time.

⇒ **Working hypothesis**: the sweep skips a directory with live `.in_use` markers, i.e. "14 days
or once nothing is using it, whichever is later". ⚠️ This is a correlation across four
directories, not a documented rule — ⛔ do not build a scheduler on it. What **is** safe: never
assume a version directory is permanent, and never rely on the deletion being on time (it can be
deferred indefinitely, and processes that were using a deleted directory keep running from a path
that no longer exists).

---

## 5. The resolution algorithm

### 5.1 Contract

Inputs: `HOME` (→ `$HOME/.claude/plugins/installed_plugins.json`) and the **project directory**.

1. Read the record. **Missing / unreadable / not JSON / no `plugins` object** ⇒ `not-evaluated`
   *with a reason*. ⛔ Not `absent`: the file's absence is not evidence about your project.
2. Collect the entries for `quay@quay` **and** `quay@quay-dev`.
3. Apply the tier rule (§2.1). No winning entry ⇒ `absent`.
4. `installPath` missing, or the directory does not exist ⇒ `absent` (**stale record**).
   ⛔ **Never** fall back to `quay` on `PATH` — that swaps the project's pin for an arbitrary build
   (§1.1). The caller must fail loudly.
5. The directory exists but has neither `bin/quay` nor `vendor/quay/dist/quay.js` ⇒ `absent`
   (*"that is not a quay plugin tree"*).
6. Otherwise `resolved`: return `installPath`, the executable to run, and the version.

**Terminal states, each its own value:**

| state | meaning | what a caller should do |
|---|---|---|
| `resolved` | a pinned, present version directory was found | run `<installPath>/bin/quay` (or `<installPath>/vendor/quay/dist/quay.js` with your own Node ≥ 20) |
| `absent` | the record was read; it gives you no usable CLI | fail; surface the reason. Installation or re-installation is a human action |
| `not-evaluated` | the record could not be read at all | fail; check `HOME` / permissions / the Claude Code version. ⛔ Do not read this as "not installed" |

### 5.2 Runnable reference implementation

```sh
# source checkout (Node >= 22.6 for --experimental-strip-types):
node --experimental-strip-types <repo>/plugin/scripts/resolve-quay-cli.ts \
     --project <dir> [--json | --field <name>]

# installed plugin (the artifact ships the bundle, not the .ts):
node <installPath>/scripts/dist/resolve-quay-cli.js --project <dir> --field cli
```

Exit codes mirror the state 1:1 — **0** `resolved`, **2** `absent`, **3** `not-evaluated`,
**64** usage error — so a shell caller never parses prose:

```sh
QUAY_CLI=$(node …/resolve-quay-cli.js --project "$PWD" --field cli)
case $? in
  0) ;;                                        # QUAY_CLI is set
  2) echo "quay is not installed for this project" >&2; exit 1 ;;
  *) echo "cannot read the Claude Code plugin install record" >&2; exit 1 ;;
esac
```

`--field <name>` prints nothing (and still exits 2/3) when the field is null — check the exit code,
not the empty string.

Minimal shell-only version of the same algorithm (no Node, needs `jq`; `$1` = project dir):

```sh
proj=$(realpath "$1")
rec=$HOME/.claude/plugins/installed_plugins.json
pick=$(jq -r --arg p "$proj" '
  [.plugins["quay@quay"][]?] as $e
  | ($e | map(select((.scope=="project" or .scope=="local") and .projectPath == $p))
        | sort_by(.version) | last) as $proj
  | ($e | map(select(.scope=="user")) | sort_by(.version) | last) as $user
  | ($proj // $user) | .installPath // empty' "$rec") || exit 3
[ -n "$pick" ] && [ -d "$pick" ] || exit 2
printf '%s\n' "$pick"
```

⚠️ The `jq` version is **illustrative**: it compares `projectPath` literally (no realpath
normalisation) and does not consult `quay@quay-dev`. Prefer the reference implementation.

### 5.3 Two real runs (measured 2026-10-26, Claude Code 2.1.310)

**A — user-scope layout** (project has no `project`/`local` record ⇒ falls back to the `user`
record):

```
$ node --experimental-strip-types plugin/scripts/resolve-quay-cli.ts --project /data/home/yale/work/quay
state:    resolved
project:  /data/home/yale/work/quay
record:   /data/home/yale/.claude/plugins/installed_plugins.json
tier:     user (scope user)
plugin:   quay@quay 0.22.0
root:     /data/home/yale/.claude/plugins/cache/quay/quay/0.22.0
cli:      /data/home/yale/.claude/plugins/cache/quay/quay/0.22.0/bin/quay
bundle:   /data/home/yale/.claude/plugins/cache/quay/quay/0.22.0/vendor/quay/dist/quay.js
exit=0
```

**B — project-scope layout** (`quay-fleet` pins 0.19.0 while the user record is 0.22.0 ⇒ the tier
rule must prefer the project record):

```
$ node --experimental-strip-types plugin/scripts/resolve-quay-cli.ts --project /data/home/yale/work/quay-fleet
state:    resolved
project:  /data/home/yale/work/quay-fleet
record:   /data/home/yale/.claude/plugins/installed_plugins.json
tier:     project (scope project)
plugin:   quay@quay 0.19.0
root:     /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0
cli:      /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/bin/quay
bundle:   /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/vendor/quay/dist/quay.js
exit=0
```

Both resolved paths were then **executed** — resolution alone is not proof that the path works:

```
$ /data/home/yale/.claude/plugins/cache/quay/quay/0.22.0/bin/quay --version   → 0.22.0
$ /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/bin/quay --version   → 0.19.0
```

Each matches `.claude-plugin/plugin.json`'s `version` and the record's `version` (no
disagreement was observed on this host).

---

## 6. Negative controls — the three ways this must refuse

Measured 2026-10-26, Claude Code 2.1.310, with a **fake `quay` first on `PATH`**
(`PATH=<tmp>/fakebin:$PATH`, where that `quay` prints `FAKE-QUAY-FROM-PATH`) so a PATH fallback
would be visible. All three runs used `--home <tmp>` and the fake `quay` was **never** executed.

**① record missing** — `not-evaluated`, exit 3:

```
state:    not-evaluated
record:   <tmp>/home-missing/.claude/plugins/installed_plugins.json
reason:   no Claude Code plugin install record at <tmp>/home-missing/.claude/plugins/installed_plugins.json — nothing to read
```

**② record corrupt** (truncated JSON) — `not-evaluated`, exit 3:

```
state:    not-evaluated
reason:   the plugin install record at <tmp>/home-corrupt/.claude/plugins/installed_plugins.json is not valid JSON
          (Expected double-quoted property name in JSON at position 46 (line 1 column 47))
```

**③ `installPath` does not exist** (record names version 9.9.9 whose directory is gone) — `absent`,
exit 2:

```
state:    absent
reason:   the winning quay@quay entry (scope user, version 9.9.9) names <tmp>/cache/quay/quay/9.9.9,
          but that directory does not exist — the record is stale (Claude Code deletes old version
          directories; see the doc's .orphaned_at section). ⛔ Not falling back to `quay` on PATH.
```

Three distinct reasons, two distinct states. ⛔ A resolver that returns "not found" for all three is
**not** following this contract: ① and ② mean *you cannot know*, ③ means *the record is stale*.
Note that ③ is the outcome you get after §4's deletion has happened to the version you were using.

---

## 7. `<project>/.quay/plugin` is retired (Q1)

**Since v0.23.0, `quay init` no longer creates `<project>/.quay/plugin`.**
(task `gap-quay-init-retire-project-plugin-link`; release note: the "Unreleased — ⚠️ BREAKING"
section at the top of [`CHANGELOG.md`](../CHANGELOG.md) — *at the time of writing v0.23.0 is still
unreleased, so that section is the note; when it ships, read the same heading without
"Unreleased"*.)

* A **symlink** left by an older init is **deleted** by the next init (`pluginLink.state: retired`).
* A **regular file or directory** at that name is the user's own content: it is **refused** and
  left byte-identical (`refused`).
* Nothing at the path ⇒ `absent`.
* ⇒ A consumer script that still resolves `"$PROJECT/.quay/plugin/…"` **stops resolving**. Replace
  it with §5. Core never read that link (`packages/quay/src/core/plugin-root.ts` resolves from its
  own install location), so no product binding moves — only your script does.

---

## 8. Known limits, and what is *not* verified

* **unverified —** the 14-day deletion policy as a *rule* (§4.2). We observed one sweep and its
  side effects; we did not observe a documented, guaranteed threshold.
* **unverified —** the `.in_use`-defers-deletion hypothesis (§4.3). Correlation on four
  directories, no documentation.
* **measured gap (2026-10-26, 2.1.310) —** a plugin enabled from a **`directory` marketplace**
  without being installed has **no install record**: on this host `quay@quay-dev` is enabled in
  `<project>/.claude/settings.json`, its marketplace source is the directory
  `/data/home/yale/work/quay/plugin`, that directory's `bin/` is on the Bash tool's `PATH`, and yet
  neither `installed_plugins.json` nor `claude plugin list --json` lists it. ⇒ For that form this
  contract answers `absent`. It is a **developer** setup: resolve it from the source checkout you
  configured, and ⛔ do not expect the record to describe it.
* **measured (2026-10-26) —** `claude plugin list --json` and `installed_plugins.json` can disagree
  about *which ids exist* (above), and `enabled` / `projectEnabled` are merged, cwd-dependent flags.
  Read the record for paths; use `plugin list --json` only for humans.
* **unverified —** whether any of this survives a future Claude Code version. Everything here is a
  reading of **2.1.310**.

---

## 9. Evidence log

| date | Claude Code | reading |
|---|---|---|
| 2026-09-02 | — | `<plugin-root>/bin` is on the Bash tool's PATH (SPEC §3a/§9, T4) |
| 2026-10-06 | — | registry tier rule (`projectPath`-matching project/local wins) — `init.ts` header |
| 2026-10-25 | 2.1.310 | `.orphaned_at` markers recorded for 0.14/0.15/0.16/0.17/0.20; `CLAUDE_PLUGIN_ROOT` unset in the Bash tool env |
| 2026-10-26 03:46 | 2.1.310 | 0.15/0.16/0.17 gone, 0.14 present; cache parent mtimes 01:17:33; `.in_use` marker census; both real-layout resolutions + executions; three negative controls |
