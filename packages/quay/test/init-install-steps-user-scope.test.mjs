// @test-group product
// gap-init-install-steps-must-detect-existing-user-scope-install — RED->GREEN regression tests.
//
// The defect: `printInstallSteps` presented `--scope user|project|local` as three equivalent
// choices WITHOUT first asking whether `quay@quay` already has a user-scope record. init only
// prints; an agent runs the steps — so the agent added a project-scope record that PINS its
// version and never follows the user-scope upgrades (plantuml-js 2026-10-21: user 0.19.0, then
// project pinned to 0.20.0).
//
// The two inputs the AC names are exercised directly against a FIXTURE home, so the operator's
// real `~/.claude/plugins/installed_plugins.json` is never read or written:
//   ① a user-scope entry exists  ⇒ "ALREADY INSTALLED at user scope (version X)" and NO parallel
//      `--scope project` / `--scope local` recommendation (only when explicitly requested, and
//      then with the pin warning);
//   ② no user-scope entry        ⇒ the original three-way recommendation.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { printInstallSteps } from "../src/init.ts";
import { userScopedInstallReading } from "../src/loaded-version.ts";

/** Build a fixture home whose install record carries `entries` under `plugins["quay@quay"]`. */
function fixtureHome(tag, entries) {
  const home = makeTmpDir(tag);
  if (entries !== null) {
    fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "quay@quay": entries } }, null, 2),
      "utf8",
    );
  }
  return home;
}

const USER_ENTRY = {
  scope: "user",
  version: "0.19.0",
  installPath: "/home/someone/.claude/plugins/cache/quay/quay/0.19.0",
  installedAt: "2026-10-20T08:00:00Z",
};

// ── ① user-scope entry PRESENT ────────────────────────────────────────────────────────────────────

test("user-scope install present ⇒ says ALREADY INSTALLED with the version, no project/local recipe", () => {
  const home = fixtureHome("quay-init-steps-user-", [USER_ENTRY]);
  const text = printInstallSteps({ homeDir: home });

  // The state sentence names the version — this is the grep-able assertion the AC asks for.
  assert.match(text, /ALREADY INSTALLED at user scope: quay@quay 0\.19\.0/);
  // No parallel choice is recommended any more.
  assert.doesNotMatch(text, /--scope project/, "must not suggest a project-scope record");
  assert.doesNotMatch(text, /--scope local/, "must not suggest a local-scope record");
  assert.doesNotMatch(text, /--scope <user\|project\|local>/, "must not present the three scopes as equivalent");
  assert.doesNotMatch(text, /claude plugin install quay@quay/, "must not tell the caller to install again");
  // The trap is named explicitly.
  assert.match(text, /does NOT follow the user-scope upgrades/i);
});

test("user-scope present + EXPLICIT project request ⇒ project command appears WITH the pin warning", () => {
  const home = fixtureHome("quay-init-steps-user-explicit-", [USER_ENTRY]);
  const text = printInstallSteps({ homeDir: home, requestedScope: "project" });

  assert.match(text, /ALREADY INSTALLED at user scope: quay@quay 0\.19\.0/);
  assert.match(text, /claude plugin install quay@quay --scope project/);
  // The warning must ride in the SAME printout as the command, not live elsewhere.
  assert.match(text, /PINS the version/);
  assert.match(text, /will NOT follow user-scope upgrades/);
  // The unrequested scope is still absent.
  assert.doesNotMatch(text, /--scope local/);
});

test("user-scope present but the entry carries no version ⇒ still present (never the fresh-install recipe)", () => {
  const home = fixtureHome("quay-init-steps-user-unversioned-", [{ scope: "user" }]);
  const text = printInstallSteps({ homeDir: home });

  assert.equal(userScopedInstallReading(home).state, "present");
  assert.match(text, /ALREADY INSTALLED at user scope: quay@quay \(version not recorded\)/);
  assert.doesNotMatch(text, /--scope project/);
});

// ── ② NO user-scope entry ─────────────────────────────────────────────────────────────────────────

test("no user-scope entry ⇒ the original three-way recommendation is unchanged", () => {
  // A project-scope record alone is NOT a user-scope install.
  const home = fixtureHome("quay-init-steps-absent-", [
    { scope: "project", version: "0.20.0", projectPath: "/some/project" },
  ]);
  const text = printInstallSteps({ homeDir: home });

  assert.equal(userScopedInstallReading(home).state, "absent");
  assert.doesNotMatch(text, /ALREADY INSTALLED/);
  assert.match(text, /--scope user\s+one version for every project/);
  assert.match(text, /--scope project\s+a per-project switch/);
  assert.match(text, /--scope local\s+this working copy only/);
  assert.match(text, /claude plugin install quay@quay --scope <user\|project\|local>/);
});

test("install record MISSING on disk ⇒ not-evaluated arm (never the present arm)", () => {
  const home = fixtureHome("quay-init-steps-norecord-", null); // no installed_plugins.json written
  assert.equal(userScopedInstallReading(home).state, "not-evaluated");
  const text = printInstallSteps({ homeDir: home });
  // 硬规则 3b: "could not read" must not read like "there is no user install".
  assert.match(text, /the plugin install record could not be read/);
  assert.doesNotMatch(text, /ALREADY INSTALLED/);
});

test("an UNREADABLE record is its own arm — distinct from both present and absent", () => {
  const home = fixtureHome("quay-init-steps-unreadable-", null);
  fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "plugins", "installed_plugins.json"), "{not json", "utf8");

  const reading = userScopedInstallReading(home);
  assert.equal(reading.state, "not-evaluated");
  assert.ok(reading.reason && reading.reason.length > 0, "not-evaluated must carry a reason");

  const text = printInstallSteps({ homeDir: home });
  assert.match(text, /the plugin install record could not be read/);
  assert.match(text, /claude plugin list --json/);
});

// ── the reader's own three states ────────────────────────────────────────────────────────────────

test("userScopedInstallReading returns the HIGHEST user-scope version among several entries", () => {
  const home = fixtureHome("quay-init-steps-highest-", [
    { scope: "user", version: "0.17.0" },
    { scope: "project", version: "0.99.0", projectPath: "/x" },
    { scope: "user", version: "0.19.0" },
  ]);
  const r = userScopedInstallReading(home);
  assert.equal(r.state, "present");
  assert.equal(r.version, "0.19.0");
  assert.equal(r.entryCount, 2);
});
