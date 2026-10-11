// @test-group engine
// ci-runner-container-recycle.test.mjs — the CI runner CONTAINER must be recycled after every job
// (tasks/gap-ci-runner-container-not-recycled-state-leaks-across-jobs).
//
// Why this file exists: `.github/runner/Dockerfile` moved the container's PID 1 to systemd so the
// release gate's `serve-own-scope` assertion could create a user scope (see that file's header).
// That silently destroyed the property the entire ephemeral-runner design rests on. The runner is
// EPHEMERAL: it registers, takes ONE job, exits. As PID 1, that exit ended the container (`--rm` +
// the host unit's `Restart=always` rebuilt it from this image). As a systemd SERVICE, the same exit
// is just one unit stopping — systemd stays up forever, `Restart=always` restarts the runner IN
// PLACE, and the container becomes immortal. Measured 2026-10-11: container `Up 19 hours`,
// `NRestarts=378`. Every job then inherits the previous job's `/root`, so `ci.yml`'s
// `npm install -g <tgz>` postinstall had already written `extraKnownMarketplaces.quay` into
// `/root/.claude/settings.json`, which turned the v0.19.0 release job's `marketplace add <artifact>`
// into a silent no-op and shipped the npm-published `version-dev` instead of the built artifact.
//
// What is asserted: the `gh-runner.service` unit the Dockerfile WRITES carries systemd's
// "the unit stopped ⇒ take this action" configuration, covering BOTH ways the runner stops — the
// normal end of an ephemeral job (exit 0 ⇒ `SuccessAction=exit`) and a crash / failed exec
// (⇒ `FailureAction=exit`); an `ExecStopPost=` that terminates PID 1 counts as an equivalent.
//
// ⛔ The assertion is POSITION-based (hard rule 2), on three levels, because a plain substring
// search would accept configurations that do nothing:
//   1. the config must live in the unit the Dockerfile WRITES to /etc/systemd/system/gh-runner.service
//      — not in the prose comment that documents it (the same line is written in both);
//   2. it must live in that unit's `[Unit]` SECTION. These are unit-level settings
//      (systemd.unit(5)); written under `[Service]`, systemd drops `SuccessAction` to `none`
//      SILENTLY. Measured 2026-10-11 on systemd 255 in this image: `systemctl cat` shows the line,
//      `systemctl show … -p SuccessAction` shows `none`, `NRestarts` climbs, container stays up. A
//      predicate that only grepped the string would call that broken config green;
//   3. the write must be the Dockerfile's own, not a base-image or drop-in file's.
//
// Falsifiability (hard rule 3b + 4c): the last test re-runs the SAME predicate against a mutated
// copy — (a) with the exit config deleted, (b) with it relocated to `[Service]` — and requires it to
// go false both times. Without that arm, a predicate that matched anything (or nothing) would pass.
//
// ⛔ Scope: this pins the IMAGE-side config only. Whether tokyo-alpha's live runner actually ran on
// a fresh container per job is a HOST reading (the image must be rebuilt and the host unit
// restarted), which is why that half is AC1–AC5 on the task, not this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCKERFILE = join(repoRoot, ".github", "runner", "Dockerfile");
const UNIT = "gh-runner.service";
/** The one `printf` form the writer uses. Kept explicit so a rewrite to an unparseable shape fails
 *  LOUDLY here instead of silently extracting zero lines (hard rule 3b). */
const PRINTF = String.raw`printf '%s\n'`;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The unit lines the Dockerfile WRITES to `/etc/systemd/system/<unit>`, in order — position-based:
 *  the shell-quoted arguments of the `printf` whose REDIRECTION targets that exact file. A
 *  whole-file grep cannot do this job: the same directive text appears in the prose comment above
 *  the RUN, so a grep would be satisfied by a comment while the unit itself says nothing. */
function writtenUnitLines(dockerfile, unit) {
  const redirRe = new RegExp(String.raw`>\s*/etc/systemd/system/${escapeRe(unit)}(?![\w.])`, "g");
  const hits = [...dockerfile.matchAll(redirRe)];
  assert.equal(
    hits.length, 1,
    `expected exactly ONE redirection writing ${unit} in the Dockerfile, found ${hits.length} — ` +
    "either the unit stopped being written here, or a second writer appeared and this predicate " +
    "can no longer say WHICH unit it is reading",
  );
  const printfAt = dockerfile.lastIndexOf(PRINTF, hits[0].index);
  assert.ok(
    printfAt >= 0 && printfAt < hits[0].index,
    `no \`${PRINTF}\` precedes the /etc/systemd/system/${unit} redirection — the writer changed ` +
    "shape and this predicate would read the wrong span",
  );
  const span = dockerfile.slice(printfAt + PRINTF.length, hits[0].index);
  const lines = [...span.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.ok(
    lines.length >= 5,
    `extracted only ${lines.length} quoted unit lines for ${unit} — the writer's shape changed`,
  );
  return lines;
}

/** The body lines of a `[Section]`, or `null` when the section is ABSENT — an enumerated third
 *  state, never folded into "empty" (hard rule 3/3b: "no [Unit] section" must not read as "[Unit]
 *  section with nothing in it"). */
function sectionLines(unitLines, section) {
  const at = unitLines.indexOf(section);
  if (at < 0) return null;
  const out = [];
  for (let i = at + 1; i < unitLines.length; i++) {
    const line = unitLines[i].trim();
    if (/^\[[^\]]+\]$/.test(line)) break;
    out.push(line);
  }
  return out;
}

/** Every way the runner service can stop, and the directive that must cover it. The pair is not
 *  redundancy: an ephemeral runner's NORMAL end is a status-0 exit, which is the `success` state —
 *  a unit carrying only the failure action recycles on a crash and STILL leaks state on every
 *  ordinary job. */
const EXIT_ACTIONS = [
  {
    key: "success",
    line: "SuccessAction=exit",
    what: "the runner's normal end — an ephemeral runner exits 0 after its one job",
  },
  {
    key: "failure",
    line: "FailureAction=exit",
    what: "a crashed listener, or an ExecStart that cannot exec (measured: container exits 203)",
  },
];

/** Does this unit make the CONTAINER exit when the runner service stops? `[Unit]`-scoped on
 *  purpose: a `[Service]` placement is not a weaker version of the fix, it is a NO-OP (see the
 *  header). An `ExecStopPost=` that asks the manager to quit / kills PID 1 is accepted as the
 *  equivalent spelled out by the task's AC. */
function containerExitCoverage(unitLines) {
  const unitSection = sectionLines(unitLines, "[Unit]");
  const serviceSection = sectionLines(unitLines, "[Service]");
  const stopPost = (serviceSection ?? []).find(
    (l) => /^ExecStopPost=/.test(l) && (/\bsystemctl\b.*\bexit\b/.test(l) || /\bkill\b.*\b1\b/.test(l)),
  );
  const actions = {};
  for (const a of EXIT_ACTIONS) {
    actions[a.key] = Boolean(unitSection?.includes(a.line)) || Boolean(stopPost);
  }
  return {
    unitSectionFound: unitSection !== null,
    serviceSectionFound: serviceSection !== null,
    unitSection,
    serviceSection,
    stopPost: stopPost ?? null,
    actions,
  };
}

test("AC0: the CI runner unit exits the container when the runner service stops", () => {
  const lines = writtenUnitLines(readFileSync(DOCKERFILE, "utf8"), UNIT);
  const cov = containerExitCoverage(lines);
  assert.ok(cov.unitSectionFound, `${UNIT} must still have a [Unit] section`);

  const missing = EXIT_ACTIONS.filter((a) => !cov.actions[a.key]);
  assert.deepEqual(
    missing.map((a) => a.line), [],
    "the ephemeral runner's container is never recycled: without the missing directive(s) below, " +
    "systemd (now PID 1) stays alive after the runner stops and `Restart=always` restarts the " +
    "runner IN PLACE, so every job inherits the previous job's /root state — the v0.19.0 release " +
    "gate read a stale `extraKnownMarketplaces.quay` because of exactly this.\n" +
    missing.map((a) => `  ${a.line} — covers ${a.what}`).join("\n"),
  );

  // A `[Service]` placement is accepted by `systemctl cat` and ignored by systemd (measured), so
  // name it explicitly rather than letting the message above read as "the line is missing".
  const misplaced = EXIT_ACTIONS
    .filter((a) => (cov.serviceSection ?? []).includes(a.line))
    .map((a) => a.line);
  assert.deepEqual(
    misplaced, [],
    `these are in [Service] and systemd SILENTLY IGNORES them there (it drops SuccessAction to ` +
    `\`none\`; measured 2026-10-11, systemd 255). They are unit-level settings — move them into ` +
    `[Unit] so the container actually exits: ${misplaced.join(", ")}`,
  );
});

test("AC0 (能取假): the predicate goes FALSE when the exit config is deleted or misplaced", () => {
  const lines = writtenUnitLines(readFileSync(DOCKERFILE, "utf8"), UNIT);
  assert.ok(
    EXIT_ACTIONS.some((a) => containerExitCoverage(lines).actions[a.key]),
    "the unmutated unit already reads as uncovered — this arm cannot exercise anything",
  );

  const isAction = (l) => EXIT_ACTIONS.some((a) => l.trim() === a.line);

  // (a) delete the exit config outright.
  const stripped = lines.filter((l) => !isAction(l));
  assert.ok(stripped.length < lines.length, "the deletion mutation removed nothing");

  // (b) keep the very same lines, but under [Service] — the measured silent-drop trap. A predicate
  // that cannot tell these two apart is precisely the predicate that shipped the original defect.
  const rest = lines.filter((l) => !isAction(l));
  const at = rest.indexOf("[Service]");
  assert.ok(at >= 0, "the unit must still have a [Service] section");
  const moved = [...rest.slice(0, at + 1), ...lines.filter(isAction), ...rest.slice(at + 1)];

  for (const [label, mutated] of [["deleted", stripped], ["moved to [Service]", moved]]) {
    const cov = containerExitCoverage(mutated);
    assert.ok(
      EXIT_ACTIONS.some((a) => !cov.actions[a.key]),
      `the predicate still reports full coverage with the exit config ${label} — it is not reading ` +
      "the config's position, so it cannot fail and proves nothing",
    );
  }
});
