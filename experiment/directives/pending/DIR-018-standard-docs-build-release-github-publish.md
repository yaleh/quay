# DIR-018

- **status:** pending
- **created_by:** human (Yale), asserted directly in this live conversation
- **created_at:** 2026-07-16
- **title:** Follow common OSS practice — create/update user-facing project documentation, establish a stable build/release mechanism, and actually cut a GitHub release

## Finding

This conversation independently inspected the live repository state
(not carried over from any prior iteration's claim):

- **No root-level `README.md`.** `docs/proposal/` contains seven
  internal design/methodology documents (`quay-proposal.md`,
  `quay-native-design.md`, `quay-bootstrap-experiment.md`, etc.), all
  written for this experiment's own audience (BAIME/V-function/σ
  terminology), not for a newcomer trying to install or use `quay`,
  `quay-native`, or `quay-github`. There is no "what is this, how do I
  install it, how do I run it" entry point anywhere in the repo.
- **No `LICENSE` file, no `CHANGELOG`.**
- **All three packages remain `"private": true`** at `"version": "0.0.1"`
  (`packages/quay/package.json`, `packages/quay-native/package.json`,
  `packages/quay-github/package.json`); the workspace root
  (`package.json`) is `"version": "0.0.0"`. 71 iterations of production
  work have not moved any package version once.
- **No CI configuration exists** (`.github/workflows/` does not exist;
  `find . -iname "*.yml"` outside `node_modules` returns only
  `.quay/config.yml` and `.manda/config.yml`, both experiment-runtime
  config, not CI). There is no automated build/test gate on push, despite
  `git remote -v` confirming `origin` is a real, live GitHub remote
  (`https://github.com/yaleh/quay.git`) that the experiment has been
  pushing commits to continuously (local `master` was found only 1 commit
  ahead of `origin/master` at the time of this check).
- **Zero git tags, zero GitHub Releases.** `git tag` returns nothing;
  `gh release list` returns nothing. Despite 71 iterations of real,
  independently-audited, test-covered work landing on a real public(-ish)
  remote, nothing has ever been packaged as a versioned, installable
  release.

This is a genuine gap against ordinary OSS practice, and is distinct
from — not a replacement for — this experiment's own existing
`completeness`/`reusability`/`validation` V-meta factors, which measure
the *quay-native methodology's* self-hosting properties, not the
*repository's* external presentability. Nothing in `docs/proposal/
quay-bootstrap-experiment.md`'s guardrails (G1-G6) or convergence
criteria currently requires README/LICENSE/CI/release hygiene at any
point in the experiment's lifecycle — this has simply never been in
scope for any iteration so far, and the live repo state reflects that.

## Requested action

1. **Create a root-level `README.md`** written for an actual external
   reader (not this experiment's internal audience): what `quay` is, the
   three-package structure (`quay` Core, `quay-native` Provider,
   `quay-github` Provider), install/run instructions verified against the
   actual current CLI entry points (`packages/*/bin/*.js`), and a pointer
   into `docs/` for anyone who wants the deeper design/methodology
   material. Do not fabricate usage examples — derive them from the
   actual, current CLI help output / existing test invocations, live-run
   and pasted in, not remembered or invented.
2. **Add a `LICENSE` file** (ask the human directly, in-conversation, which
   license to use if not already decided elsewhere in `docs/` — do not
   default to a specific license unilaterally without checking first).
3. **Establish a stable build/release mechanism**: at minimum, a CI
   workflow (`.github/workflows/`) that runs the existing test suite
   (`node --test packages/*/test/*.test.mjs`, the same command this
   experiment's own iterations already use to self-verify) on push/PR —
   live-verify it actually runs green on GitHub Actions, not just that
   the YAML parses locally. Bump package versions off `0.0.0`/`0.0.1`
   using ordinary semver discipline (a real decision — e.g. `0.1.0` for
   first tagged release — recorded with its own rationale, not asserted
   without one).
4. **Actually cut a real GitHub release**: create a git tag, push it, and
   use `gh release create` (or the GitHub UI) to publish a real release
   against `https://github.com/yaleh/quay`, with release notes that
   accurately describe what this snapshot of the repo actually is (an
   in-progress BAIME methodology-bootstrapping experiment, self-hosting
   at σ=0.8986, not a finished product) — do not overstate maturity in
   the release notes to make the release look more complete than the
   experiment's own provenance record shows it to be.
5. Record, in whichever iteration(s) apply this directive, whether any
   V_instance/V_meta factor plausibly moves as a result (this is
   genuinely ambiguous and should be checked directly against the exact
   defining language in `docs/proposal/quay-bootstrap-experiment.md`
   §5.1/§5.2, the same discipline every other iteration applies to itself
   — do not assume either "obviously yes" or "obviously no" without that
   check, and do not force a credit claim if the exact language doesn't
   support one).

## Resolution

<!-- Filled in by whichever iteration applies this directive. -->

## Progress note (added 2026-07-16, iteration 72)

Read in full this iteration. **Deferred, not applied** — iteration 72's
assigned scope was narrowly "apply DIR-016"; DIR-018 is a substantially
larger, multi-part undertaking (root README, a LICENSE choice that
explicitly requires asking the human directly per its own action 2, a live
CI workflow verified green on GitHub Actions, a semver bump with recorded
rationale, and an actual `gh release create` against the live
`yaleh/quay` remote) that should not be rushed into the same iteration as
DIR-016 without risking an incomplete or non-live-verified partial
CI/release state — action 3/4 of this directive explicitly require live
verification, not assertion. Still `status: pending`. Whoever picks this
up next should read it in full and likely split it across more than one
iteration rather than force it into a single pass. No V-factor movement is
implied by this deferral.
