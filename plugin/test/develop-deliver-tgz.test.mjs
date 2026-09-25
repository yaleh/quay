// @test-group lowconc
// develop-deliver-tgz.test.mjs — gap-develop-deliver-asserts-http-200-but-root-now-302-redirects:
// the develop→deliver verification criterion (`verify_http_surface` inside develop-deliver-tgz.sh)
// had hard-asserted `curl http_code == 200` on `/`, but `/` 302s to `/dashboard` since 01437b3e6 —
// so every post-merge cross-host deliver verification silently exit-1'd on the still-healthy service.
// The criterion now FOLLOWS the redirect and asserts the FINAL code is 200 AND `/dashboard` serves
// a non-empty body carrying the stable `<title>Dashboard</title>` marker.
//
// Coverage map (task ACs):
//   AC3  — the criterion can take FALSE: `--selfcheck` runs hermetic negative controls (root-404,
//          redirect-to-404, empty-body, no-marker) and asserts each fails (exit non-0), so a 404 /
//          redirect-to-404 is NOT accepted as a pass (硬规则 4: 一个结构上不可能取假的量不是测量).
//   AC3+positive — the criterion can take TRUE: 302→dashboard→200 + direct-200 both pass.
//   AC4  — the per-host state record keeps every host's http + usage_verify signals PRESENT and the
//          failure values DISTINCT (verify-fail vs not-evaluated vs 200) — a single-host failure must
//          not drop a key (硬规则 3b).
//   AC5  — a verify failure carries the actual http code in the reason (`code=404`), not a silent
//          exit 1 (the reason line is the one the local loop prints to stdout on a failed host).
//
// Coverage map — --driving-profiles (task gap-e2e-verify-pushes-dev-host-profile-model-to-target-host):
//   AC1  — the two scp sites' source comes from ONE overridable place (`driving_profiles_src`).
//   AC2a — unset ⇒ BOTH e2e legs push `<root>/.quay/profiles.yml` (default behaviour unchanged).
//   AC2b — set ⇒ BOTH legs push THAT file, and the CONTENT pushed is the override's, not the driving
//          repo's.
//   AC2c — set to a path that is not a file ⇒ NOT-EVALUATED + non-zero BEFORE any transport leg: the
//          driving repo's profile is NOT a fallback (硬规则 3b). The fake transport's argv log is EMPTY.
//   AC2-mutation — unwiring the override from the transport (the flag still parses) reddens AC2b, so
//          that assertion is takeable-false — ⛔ not an arm the current code satisfies by construction.
//
// This file uses node:test and declares // @test-group lowconc (hermetic-but-load-sensitive: the
// selfcheck spawns short-lived node stub HTTP servers + curl on private sockets).
//
// Run:
//   scripts/test.sh plugin/test/develop-deliver-tgz.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "develop-deliver-tgz.sh");

// run(): spawn the script with args, return { status, stdout, stderr }.
function run(args) {
  return spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
}

test("AC3+positive — --selfcheck exits 0 and reports PASS (302→dashboard→200 and direct-200 pass)", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /selfcheck: PASS/, "selfcheck must report PASS");
  // positive controls: the redirect criterion accepts the current product shape
  assert.match(r.stdout, /redirect-ok → OK final_code=200 dashboard=ok/,
    "positive control: 302→/dashboard→200 with the marker must pass (the current product shape)");
  assert.match(r.stdout, /direct-ok → OK final_code=200 dashboard=ok/,
    "positive control: a direct 200 with the marker must pass");
});

test("AC3 — the criterion can take FALSE (root-404 / redirect-to-404 / empty-body / no-marker each fail)", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  // negative controls: the criterion is not恒绿 — a 404 and a redirect-to-404 both fail.
  assert.match(r.stdout, /root-404 → FAIL reason=root-final-code-not-200 code=404/,
    "negative control: a 404 on / must fail (criterion can take false)");
  assert.match(r.stdout, /redirect-to-404 → FAIL reason=root-final-code-not-200 code=404/,
    "negative control: a 302→/dashboard→404 chain must fail (a redirect to 404 is NOT accepted)");
  assert.match(r.stdout, /empty-body → FAIL reason=dashboard-body-empty code=200/,
    "negative control: a 200 with an empty dashboard body must fail (content, not just status)");
  assert.match(r.stdout, /no-marker → FAIL reason=dashboard-marker-missing code=200/,
    "negative control: a 200 without the <title>Dashboard</title> marker must fail");
});

test("AC4 — the per-host state record keeps every host's http + usage_verify signals present and distinct", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /state-aggregation both-keys=1 distinct-values=1/,
    "state aggregation: a failed host + an ok host + a not-reached host must all appear, with verify-fail / 200 / not-evaluated distinct (no missing key, 硬规则 3b)");
});

test("AC5 — a verify failure carries the actual http code in the reason line (not a silent exit 1)", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  // The FAIL verdict lines carry `code=<n>` — the exact token the local host loop prints to stdout
  // when a host's verify fails (`VERIFY FAILED — FAIL reason=… code=<n>`), so the reason is surfaced.
  assert.match(r.stdout, /code=404/, "a failed verdict must carry the received http code (404)");
  assert.match(r.stdout, /reason=root-final-code-not-200/, "the failed verdict must carry the reason");
});

test("arg validation — an unknown flag exits 2 (usage error, not a silent run)", () => {
  const r = run(["--no-such-flag"]);
  assert.equal(r.status, 2, "unknown argument must exit 2");
  assert.match(r.stderr, /unknown arg/, "the usage error must name the bad argument");
});

test("build worktree is created on a transient BRANCH, never --detach", () => {
  // The coupling this pins (gap-routine-freshness-refresh-stale-goal-009-ac-203-coldstart-face):
  // the build's version stamping (`sync-vendor.sh` → `stamp-version --mode build`, which reads
  // `git symbolic-ref HEAD`) answers NOT-EVALUATED — exit 3 ⇒ package.sh fails closed ⇒ BUILD
  // FAILED — on a DETACHED HEAD with no version tag. Measured 2026-09-20 on develop c80040ad4:
  // `--detach` ⇒ package.sh rc=3 and no artifact; the SAME commit on a branch ⇒ rc=0 and
  // `quay-0.10.0-dev.tgz`. The producer therefore builds on a transient branch.
  // Asserted on the command line (not the whole file): the file's own comments MENTION `--detach`
  // to explain why it is not used, so a whole-file match would be the wrong instrument.
  // It can take FALSE: restoring `--detach` on that line reddens this test.
  const lines = fs.readFileSync(SCRIPT, "utf8").split("\n");
  const adds = lines
    .map((l) => l.trim())
    .filter((l) => l.startsWith("git ") && l.includes("worktree add"));
  assert.equal(adds.length, 1, `expected exactly ONE worktree-creating command, got ${adds.length}: ${adds.join(" | ")}`);
  assert.doesNotMatch(adds[0], /--detach/, "the build worktree must NOT be detached (version stamping fails closed on a detached HEAD)");
  assert.match(adds[0], /worktree add -B "\$\{build_ref\}"/, "it must be created on the transient build branch");
});

// ── --driving-profiles: the pushed profile has an override entry point ────────────────────────────
// THE DEFECT THESE DRIVE (tasks/gap-e2e-verify-pushes-dev-host-profile-model-to-target-host). The
// profile scp'd to a target is the SINGLE SOURCE the remote derives the target project's
// worker-default launcher/model/auth from — and the driving repo's worker-default.model is served by
// the DRIVING host's own gateway. Before `--driving-profiles` the transport hard-wired
// `${repo_root}/.quay/profiles.yml`, so that host-specific model name went to every target verbatim.
// Measured 2026-09-25 on host B: both e2e legs' workers died (`unrecognized_model` / `API Error: 400
// Invalid model name passed in model=v4.1flash-…`) and the run produced no record — the very failure
// the legs exist to detect, manufactured by the transport. The remote script already accepts
// `--target-launcher/--target-model/--target-auth` ("CLI override > driving-side derivation"); the
// driving script simply never forwarded anything.
//
// HOW THEY DRIVE IT: the REAL script, with a fake `scp`/`ssh` on PATH that APPENDS ITS ARGV to a log
// and exits 0 (no network), against a throwaway git fixture root (a stub build makes the two .tgz —
// the subject here is the TRANSPORT, not the build). The assertion reads the SOURCE the transport
// actually pushed, from that log — ⛔ not the script's source text (a text match would be satisfied
// by a comment).

const FAKE_SCP = '#!/usr/bin/env bash\nprintf \'scp\\t%s\\n\' "$*" >> "${FAKE_TRANSPORT_LOG}"\nexit 0\n';
const FAKE_SSH = '#!/usr/bin/env bash\nprintf \'ssh\\t%s\\n\' "$*" >> "${FAKE_TRANSPORT_LOG}"\nexit 0\n';

function git(root, ...args) {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed in the fixture:\n${r.stdout}\n${r.stderr}`);
  return r;
}

// mkHarness() — a throwaway git fixture root carrying a `.quay/profiles.yml`, a stub build (two
// .tgz), and a fake `scp`/`ssh` bin dir whose argv log is `log`. Every path is under one tmp dir so
// cleanup is a single rm -rf.
function mkHarness() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dd-tgz-profiles-")));
  const root = path.join(tmp, "root");
  const bin = path.join(tmp, "bin");
  const log = path.join(tmp, "transport.log");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "quay", "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "quay-native", "scripts"), { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  // The driving repo's OWN profile: its model name stands for the host-specific one that must NOT be
  // pushed to a target that cannot serve it.
  const rootProfiles = "worker-default:\n  model: driving-host-only-model\n";
  fs.writeFileSync(path.join(root, ".quay", "profiles.yml"), rootProfiles);
  fs.writeFileSync(path.join(root, "packages", "quay", "scripts", "package.sh"),
    '#!/usr/bin/env bash\nd="$(cd "$(dirname "$0")/.." && pwd -P)"; : > "${d}/quay-0.0.0-dev.tgz"\n');
  fs.writeFileSync(path.join(root, "packages", "quay-native", "scripts", "build-dist.sh"),
    "#!/usr/bin/env bash\nexit 0\n");
  fs.writeFileSync(path.join(root, "packages", "quay-native", "package.json"),
    '{"name":"quay-native","version":"0.0.0"}\n');
  fs.writeFileSync(path.join(bin, "scp"), FAKE_SCP, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "ssh"), FAKE_SSH, { mode: 0o755 });
  fs.writeFileSync(log, "");
  git(root, "-c", "init.defaultBranch=develop", "init", "-q");
  git(root, "add", "-A");
  git(root, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "-q", "-m", "fixture");
  return { tmp, root, bin, log, rootProfiles, rootProfilesPath: path.join(root, ".quay", "profiles.yml") };
}

// profilePushes(logPath) — the SOURCE argument of every scp leg whose destination is
// `~/quay-driving-profiles.yml`, read back out of the fake transport's own argv log.
function profilePushes(logPath) {
  return fs.readFileSync(logPath, "utf8").split("\n")
    .filter((l) => l.startsWith("scp\t"))
    .map((l) => l.slice(4).trim().split(/\s+/))
    .filter((a) => a.length >= 2 && a[a.length - 1].endsWith(":~/quay-driving-profiles.yml"))
    .map((a) => a[a.length - 2]);
}

// runLeg(h, leg, extra, script) — one REAL run of the e2e leg, fake scp/ssh on PATH, argv logged.
// The log is reset first so `pushes` describes THIS leg alone.
function runLeg(h, leg, extra = [], script = SCRIPT) {
  fs.writeFileSync(h.log, "");
  const args = leg === "ac207"
    ? ["--verify-coldstart", "--ac207-e2e", "--hosts", "B", "--force", "--root", h.root, ...extra]
    : ["--verify-upgrade", "--upgrade-source", "aged/third-party", "--ac239-e2e", "--hosts", "B",
       "--force", "--root", h.root, ...extra];
  const r = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${h.bin}:${process.env.PATH}`, FAKE_TRANSPORT_LOG: h.log },
  });
  return { status: r.status, out: `${r.stdout || ""}${r.stderr || ""}`, pushes: profilePushes(h.log) };
}

const BOTH_LEGS = ["ac207", "ac239"];

function withHarness(fn) {
  const h = mkHarness();
  try { fn(h); } finally { fs.rmSync(h.tmp, { recursive: true, force: true }); }
}

test("--driving-profiles AC2a — unset ⇒ BOTH legs push the driving repo's own .quay/profiles.yml", () => {
  withHarness((h) => {
    for (const leg of BOTH_LEGS) {
      const r = runLeg(h, leg);
      assert.deepEqual(r.pushes, [h.rootProfilesPath],
        `${leg}: with no override the pushed source must be <root>/.quay/profiles.yml — got ${JSON.stringify(r.pushes)}\n${r.out}`);
      assert.equal(fs.readFileSync(r.pushes[0], "utf8"), h.rootProfiles,
        `${leg}: and the content pushed must be that file's`);
    }
  });
});

test("--driving-profiles AC2b — set ⇒ BOTH legs push THAT file, and its content is the override's", () => {
  withHarness((h) => {
    const overridePath = path.join(h.tmp, "target-host-profiles.yml");
    const overrideContent = "worker-default:\n  model: model-the-target-gateway-serves\n";
    fs.writeFileSync(overridePath, overrideContent);
    // Without this the arm could not fail: two identical profiles would satisfy "content is the
    // override's" even if the driving repo's had been pushed.
    assert.notEqual(overrideContent, h.rootProfiles, "the fixture's two profiles must differ");
    for (const leg of BOTH_LEGS) {
      const r = runLeg(h, leg, ["--driving-profiles", overridePath]);
      assert.deepEqual(r.pushes, [overridePath],
        `${leg}: the override must be what reaches the target — got ${JSON.stringify(r.pushes)}\n${r.out}`);
      const pushed = fs.readFileSync(r.pushes[0], "utf8");
      assert.equal(pushed, overrideContent, `${leg}: the CONTENT pushed must be the override's`);
      assert.notEqual(pushed, h.rootProfiles, `${leg}: ⛔ not the driving repo's profile`);
    }
  });
});

test("--driving-profiles AC2c — not a file ⇒ NOT-EVALUATED + non-zero, and NOTHING is transported", () => {
  withHarness((h) => {
    const r = runLeg(h, "ac207", ["--driving-profiles", path.join(h.tmp, "no-such-profiles.yml")]);
    assert.notEqual(r.status, 0, `a --driving-profiles that is not a file must exit non-zero\n${r.out}`);
    assert.match(r.out, /NOT-EVALUATED/, "the refusal must be REPORTED as NOT-EVALUATED (硬规则 3b)");
    assert.deepEqual(profilePushes(h.log), [],
      "⛔ the driving repo's profile must NOT be pushed as a fallback");
    // The refusal precedes EVERY transport leg, so the whole run must leave no scp/ssh call at all.
    assert.equal(fs.readFileSync(h.log, "utf8").trim(), "",
      "⛔ no scp/ssh may run at all — an unreadable override must not be discovered halfway through");
  });
});

test("--driving-profiles AC2-mutation — unwiring the override from the transport reddens AC2b", () => {
  withHarness((h) => {
    const src = fs.readFileSync(SCRIPT, "utf8");
    const unwired = src.split('"${driving_profiles_src}"').join('"${repo_root}/.quay/profiles.yml"');
    // ⛔ The mutation must be ASSERTED to have applied — an unapplied mutation makes this arm vacuous
    // (it would "pass" for the wrong reason, 硬规则 3).
    assert.notEqual(unwired, src, "the mutation must APPLY to the real script");
    const mutated = path.join(h.tmp, "mutated-develop-deliver-tgz.sh");
    fs.writeFileSync(mutated, unwired);
    const overridePath = path.join(h.tmp, "target-host-profiles.yml");
    fs.writeFileSync(overridePath, "worker-default:\n  model: model-the-target-gateway-serves\n");
    // The flag still PARSES in the mutated script — only the transport is unwired — so this isolates
    // "the override reaches the scp" from "the flag is accepted".
    const r = runLeg(h, "ac239", ["--driving-profiles", overridePath], mutated);
    assert.deepEqual(profilePushes(h.log), [h.rootProfilesPath],
      `with the override unwired the transport pushes the driving repo's profile, so AC2b's assertion is FALSE here\n${r.out}`);
  });
});
