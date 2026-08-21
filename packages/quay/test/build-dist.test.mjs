// @test-group product
// build-dist.test.mjs — M120 Stage 1.1 (DIR-060, release-blocking).
//
// Pins the ESM `dist/quay.js` bundle build (scripts/build-dist.mjs +
// scripts/build-dist.sh): the transpile-on-publish mechanism that lets the
// npm-pack tarball's `bin` run on the declared Node-20 floor (native `.ts`
// only runs on Node >=23). Test-first per the M120 plan's Stage 1.1.
//
//   (a) happy path: buildDist() produces a runnable ESM bundle whose
//       `--help` / `--version` succeed as a real subprocess.
//   (b) banner regression-pin: the built bundle contains the load-bearing
//       `createRequire` banner (without it, `yaml`'s CJS-interop dynamic
//       require crashes the ESM bundle at runtime — Grounded finding 1).
//   (c) failure path via the QUAY_BUILD_DIST_ENTRY env-var testability hook:
//       a nonexistent entry makes buildDist() reject (loud, non-zero).
//   (d) shell wrapper: `bash scripts/build-dist.sh` exits 0 and writes the
//       configured outfile. The outfile is redirected to THIS test's own temp
//       dir (QUAY_BUILD_DIST_OUTFILE hook) so the real wrapper is exercised
//       without rewriting the shared packages/quay/dist/quay.js that M136's
//       sync-vendor --check reads concurrently in the full suite
//       (no bash coverage tool in this repo — RED/GREEN exit-code + existence
//       assertion, per the plan's shell strategy).
//   (e) self-contained regression (gap-dist-runtime-not-self-contained-reads-
//       external-package-json): the bundle runs `--version` with NO sibling
//       package.json — the version is inlined at build time, so the dist is a
//       single loose standalone file (pre-fix this crashed with ENOENT).
//
// The runnable-bundle assertions build into a DEPTH-MATCHED temp tree
// (<root>/l1/l2/pkg/{package.json,dist/quay.js}). After the self-contained fix,
// src/version.ts NO LONGER reads `../package.json` at runtime (version inlined
// at build time — test (e) asserts the bundle runs with zero sibling package.json);
// the depth-match survives for src/gate/registry.ts's 4-levels-up REPO_ROOT,
// which still resolves inside the temp root — never the real repo tree, and
// never a mismatched /tmp/package.json.
//
// Run: node --test --experimental-test-coverage packages/quay/test/build-dist.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import net from "node:net";

import { buildDist } from "../scripts/build-dist.mjs";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const scriptSh = path.join(pkgDir, "scripts", "build-dist.sh");
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// Build target inside a temp tree whose depth mirrors packages/quay/dist so the
// bundle's own relative reads (registry.ts's 4-levels-up REPO_ROOT) stay in
// temp. The package.json copy was historically needed for src/version.ts's
// `../package.json` read; after the self-contained fix (test (e)) version.ts no
// longer reads it, but the copy is harmless and kept for depth-matching parity.
function tempTree(tag) {
  const root = makeTmpDir(`quay-m120-builddist-${tag}-`);
  const pkg = path.join(root, "l1", "l2", "pkg");
  fs.mkdirSync(path.join(pkg, "dist"), { recursive: true });
  fs.copyFileSync(path.join(pkgDir, "package.json"), path.join(pkg, "package.json"));
  return { root, out: path.join(pkg, "dist", "quay.js") };
}

test("(a) happy path: buildDist() writes a runnable ESM bundle; --help and --version succeed", async () => {
  const { out } = tempTree("happy");
  const written = await buildDist({ outfile: out });
  assert.equal(written, out);
  assert.ok(fs.existsSync(out), `expected bundle at ${out}`);

  const help = execFileSync("node", [out, "--help"], { encoding: "utf8" });
  assert.match(help, /Usage/, "--help must print usage text");

  const version = execFileSync("node", [out, "--version"], { encoding: "utf8" }).trim();
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
  assert.equal(version, pkgVersion, `--version must print package.json version (${pkgVersion})`);
});

test("(b) banner regression-pin: the built bundle contains the load-bearing createRequire banner", async () => {
  const { out } = tempTree("banner");
  await buildDist({ outfile: out });
  const src = fs.readFileSync(out, "utf8");
  assert.match(
    src,
    /createRequire/,
    "the esbuild `banner` (import createRequire) must be present — without it yaml's dynamic require crashes the ESM bundle"
  );
});

test("(c) failure path: a nonexistent QUAY_BUILD_DIST_ENTRY makes buildDist() reject loudly", async () => {
  const { out } = tempTree("fail");
  const prev = process.env.QUAY_BUILD_DIST_ENTRY;
  process.env.QUAY_BUILD_DIST_ENTRY = path.join(os.tmpdir(), "quay-m120-does-not-exist.ts");
  try {
    await assert.rejects(
      () => buildDist({ outfile: out }),
      /./,
      "buildDist() must reject when the entrypoint cannot be resolved"
    );
  } finally {
    if (prev === undefined) delete process.env.QUAY_BUILD_DIST_ENTRY;
    else process.env.QUAY_BUILD_DIST_ENTRY = prev;
  }
});

test("(d) shell wrapper: `bash scripts/build-dist.sh` exits 0 and writes the configured outfile", () => {
  // RED before build-dist.sh exists / GREEN after. No bash coverage tool in
  // this repo (confirmed: no kcov/bashcov) — exit-code + existence is the check.
  // The outfile is redirected to THIS TEST's own temp dir via the
  // QUAY_BUILD_DIST_OUTFILE testability hook (sibling of QUAY_BUILD_DIST_ENTRY),
  // so the wrapper is exercised for real but NEVER rewrites the shared
  // packages/quay/dist/quay.js that M136's sync-vendor --check reads concurrently
  // in the same full-suite run (gap-sync-vendor-drift-mislabelled-as-task-schema,
  // round 3: eliminate the interference source).
  const outRoot = makeTmpDir("quay-m120-builddist-sh-");
  try {
    const out = path.join(outRoot, "dist", "quay.js");
    fs.mkdirSync(path.join(outRoot, "dist"), { recursive: true });
    execFileSync("bash", [scriptSh], {
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, QUAY_BUILD_DIST_OUTFILE: out },
    });
    assert.ok(fs.existsSync(out), `build-dist.sh must write ${out}`);
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});

test("(e) self-contained: built bundle runs --version with NO sibling package.json (version inlined at build time)", async () => {
  // gap-dist-runtime-not-self-contained-reads-external-package-json: the dist
  // runtime must not read an external package.json at startup — version.ts
  // embeds the version at build time (esbuild json loader inlines it). This
  // subtest builds the bundle into a BARE temp dir (no package.json, no depth
  // matching) and asserts --version prints the real version. Pre-fix this
  // crashed with `Error: ENOENT ... open <dir>/../package.json`.
  const root = makeTmpDir("quay-m120-builddist-nopkg-");
  try {
    const out = path.join(root, "quay.js");
    const written = await buildDist({ outfile: out });
    assert.equal(written, out);
    assert.ok(fs.existsSync(out), `expected bundle at ${out}`);

    // The bundle must physically not carry version.ts's old runtime read
    // (`../package.json` relative path); the version string is inlined instead.
    const src = fs.readFileSync(out, "utf8");
    assert.ok(
      !src.includes("../package.json"),
      "the bundle must not contain version.ts's '../package.json' runtime read"
    );

    const pkgVersion = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
    const version = execFileSync("node", [out, "--version"], { encoding: "utf8" }).trim();
    assert.equal(version, pkgVersion, `--version must print the inlined version (${pkgVersion}) with no sibling package.json`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// gap-webui-modernist-css-missing-in-tgz (AC1/AC2 regression): the bundled
// dist/quay.js must be SELF-CONTAINED for the Web UI stylesheet. serve-handlers.ts
// reads webui-modernist.css relative to its own location; from src/ the file is a
// sibling, but from dist/ it is NOT (npm pack ships the file under src/, never
// dist/), so every bundled `quay serve` logged `webui-modernist.css missing:
// ENOENT` and served an empty <style>. build-dist.mjs now INLINES the stylesheet
// into the bundle (the banner sets globalThis.__WEBUI_MODERNIST_CSS__), making the
// dist self-contained. This test pins BOTH halves: (1) the bundle physically
// carries the inlined stylesheet, byte-identical to the product copy, and (2) a
// REAL `quay serve` from the built bundle (built into a BARE temp dir with NO
// sibling .css) returns a real HTTP response whose <style> is non-empty.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

test("(f) webui CSS self-contained: the dist bundle inlines webui-modernist.css and real `serve` returns a non-empty <style>", async () => {
  // Build into a BARE temp dir — no src/, no sibling webui-modernist.css — exactly
  // the shape of the deployed bundle (npm-pack tarball, plugin/vendor, quay-init laydown).
  const root = makeTmpDir("quay-m120-builddist-webuicss-");
  let serveProc;
  try {
    const out = path.join(root, "quay.js");
    await buildDist({ outfile: out });
    const src = fs.readFileSync(out, "utf8");

    // (1) the bundle carries the inlined stylesheet, byte-identical to the product copy.
    const m = src.match(/globalThis\.__WEBUI_MODERNIST_CSS__ = ("(?:[^"\\]|\\.)*")/);
    assert.ok(m, "dist bundle must inline webui-modernist.css via the buildBanner() globalThis assignment");
    const inlined = JSON.parse(m[1]);
    const expected = fs.readFileSync(path.join(pkgDir, "src", "webui-modernist.css"), "utf8");
    assert.equal(inlined, expected, "inlined CSS must be byte-identical to the product copy (src/webui-modernist.css)");

    // (2) a REAL serve from the built bundle returns a real HTTP response with a non-empty <style>.
    const tasksDir = makeTmpDir("quay-m120-builddist-webuicss-tasks-");
    const wsRoot = makeTmpDir("quay-m120-builddist-webuicss-ws-");
    fs.mkdirSync(path.join(wsRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(wsRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  native:",
        "    enabled: true",
        `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
        `    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"`,
        `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
        "    env:",
        `      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"`,
        "",
      ].join("\n")
    );
    const port = await freePort();
    serveProc = spawn("node", [out, "serve", "--port", String(port)], {
      cwd: wsRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let outBuf = "";
    const listening = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`serve did not start within 15s; stdout:\n${outBuf}`)), 15000);
      serveProc.stdout.on("data", (d) => {
        outBuf += d.toString();
        if (outBuf.includes("listening on")) {
          clearTimeout(timer);
          resolve();
        }
      });
      serveProc.stderr.on("data", (d) => { outBuf += d.toString(); });
      serveProc.on("error", (e) => { clearTimeout(timer); reject(e); });
      serveProc.on("exit", (code) => { clearTimeout(timer); reject(new Error(`serve exited early (code ${code}); stdout:\n${outBuf}`)); });
    });
    await listening;

    const r = await httpGet(port, "/tasks");
    assert.equal(r.status, 200, `GET /tasks must be HTTP 200 (got ${r.status})`);
    const style = r.body.match(/<style>([\s\S]*?)<\/style>/);
    assert.ok(style, "serve response must contain a <style> block");
    const inner = style[1].trim();
    assert.ok(inner.length > 5000, `bundled serve <style> must be non-empty (the ~10KB modernist sheet); got ${inner.length} chars`);
    assert.match(inner, /^\/\* Modernist/, "the inlined <style> must be the Modernist token sheet");
    assert.ok(!/webui-modernist\.css missing/.test(outBuf), `serve must NOT log the pre-fix ENOENT; stdout:\n${outBuf}`);

    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(wsRoot, { recursive: true, force: true });
  } finally {
    if (serveProc && serveProc.exitCode === null) serveProc.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
