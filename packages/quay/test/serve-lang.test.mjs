// @test-group product
// gap-ac288-webui-lang-switch-mechanism — the web face's language mechanism (AC-288 / GOAL-024).
//
// The goal criterion boots a REAL `quay serve` and reads raw HTTP:
//   default (no query, no cookie) → `<html lang="en"`
//   `?lang=zh`                    → `<html lang="zh"` AND a `Set-Cookie` carrying `lang=zh`
//   `Cookie: lang=zh` (no query)  → `<html lang="zh"`
// Before this task the mechanism did not exist at all (0 cookie parse sites, 0 `Set-Cookie`, 0
// `?lang=` parse points), so the second assertion was the one that failed
// (`CAUSE=query-param-not-honored`).
//
// This file is the judge for BOTH halves of the mechanism, and both halves are asserted in BOTH
// directions (hard rule 4: a reading that cannot take a false value is not a measurement):
//
//   AC2 — the pure decision table (`resolveLang`), imported DIRECTLY. The four outcomes must be
//         mutually distinguishable: `"invalid"` (a query value that is present but unreadable) must
//         NOT collapse into `"default"` (no preference expressed at all). A test that only asserted
//         the four happy rows would stay green if those two were merged — the negative control is
//         the `notDeepEqual` between them, and it is the reason this table is a measurement.
//   AC3 — the black-box three assertions, each INDEPENDENT (separate `test()` runs, each reading the
//         response itself — body for the tag, `res.headers` for the cookie). ③ passing is never
//         taken as evidence for ②: they hit different inputs and check different bytes.
//         Plus a fourth, self-contained control: a `?lang=zh` request immediately followed by a bare
//         request must render `en` again. `routeCfg` (serve.ts) is a SERVICE-LIFETIME object, so an
//         in-place `cfg.lang = …` would make one request's language leak into the next — that
//         control is what makes "per-request copy" a checked property rather than a comment.
//
// Run (scoped): node --test packages/quay/test/serve-lang.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import {
  resolveLang,
  parseCookieHeader,
  htmlLangTag,
  langCookie,
  isLang,
  DEFAULT_LANG,
  LANGS,
  LANG_COOKIE_NAME,
} from "../src/serve-lang.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** Raw HTTP GET returning the RESPONSE (status + headers + body) — the black-box assertions must
 *  read the wire, never an in-process variable (DoD 2: "not impersonated"). A cookie jar is
 *  deliberately absent: each call carries exactly the headers the caller spelled out, so ③ can only
 *  be green because of `Cookie: lang=zh` and not because an earlier call left a cookie behind. */
function request(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method: "GET", headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ── AC2: the pure decision table, both directions ──────────────────────────────────────────────

test("AC2① — the four resolutions are correct AND mutually distinguishable", () => {
  const byQuery = resolveLang({ queryLang: "zh" });
  const byCookie = resolveLang({ cookieLang: "zh" });
  const byDefault = resolveLang({});
  const byInvalid = resolveLang({ queryLang: "fr" });

  // The four rows, each on its own terms.
  assert.deepEqual(byQuery, { lang: "zh", source: "query", setCookie: langCookie("zh") });
  assert.deepEqual(byCookie, { lang: "zh", source: "cookie", setCookie: null });
  assert.deepEqual(byDefault, { lang: "en", source: "default", setCookie: null });

  // ① legal query ⇒ a persistence cookie; ② cookie alone ⇒ NO cookie write (nothing new to record);
  // ③ no input ⇒ default `en` and no cookie.
  assert.ok(byQuery.setCookie !== null, "a legal ?lang= must set the persistence cookie");
  assert.equal(byCookie.setCookie, null, "a cookie that merely echoes the request must not be re-set");
  assert.equal(byDefault.setCookie, null);

  // NEGATIVE CONTROL (the falsifier): `"invalid"` and `"default"` are DIFFERENT outcomes. If the
  // resolver ever folds an unreadable value into the default row, these two become deep-equal and
  // this assertion goes red — which is the whole point of giving "unreadable" its own value
  // (hard rule 3b: a judge with no "could not evaluate" state cannot tell it from "fine").
  assert.equal(byInvalid.source, "invalid");
  assert.notDeepEqual(byInvalid, byDefault, "an illegal query value must not be indistinguishable from no value");
  assert.equal(byInvalid.lang, "en", "an illegal query value falls back to cookie/default for the LANGUAGE");
  assert.equal(byInvalid.setCookie, null, "an unreadable value is never persisted as the user's choice");

  // `?lang=` (present but empty) is "present and unreadable", NOT "absent" — the `source` field
  // exists precisely so these two are not the same reading.
  assert.equal(resolveLang({ queryLang: "" }).source, "invalid");
  assert.equal(resolveLang({}).source, "default");
});

test("AC2② — `en` and `zh` take the SAME code path (no privileged language)", () => {
  // If someone special-cased `zh` (or made `en` a fall-through that skips the cookie), the two rows
  // stop being symmetric. Asserting symmetry is what makes "one mechanism, not a zh hack" checked.
  const en = resolveLang({ queryLang: "en" });
  const zh = resolveLang({ queryLang: "zh" });
  assert.equal(en.source, zh.source);
  assert.equal(en.setCookie, langCookie("en"));
  assert.ok(en.setCookie.startsWith(`${LANG_COOKIE_NAME}=en;`));
  assert.ok(zh.setCookie.startsWith(`${LANG_COOKIE_NAME}=zh;`));
  assert.match(en.setCookie, /Path=\/; Max-Age=\d+; SameSite=Lax/);
});

test("AC2③ — query beats cookie; an illegal query defers to a LEGAL cookie", () => {
  assert.equal(resolveLang({ queryLang: "zh", cookieLang: "en" }).lang, "zh");
  assert.equal(resolveLang({ queryLang: "zh", cookieLang: "en" }).source, "query");
  // Illegal query ⇒ unreadable, but the cookie it defers to is still a stated preference.
  const r = resolveLang({ queryLang: "fr", cookieLang: "zh" });
  assert.deepEqual(r, { lang: "zh", source: "invalid", setCookie: null });
  // An illegal COOKIE is simply absent — there is no `source:"invalid"` for it, because a cookie is
  // never a user action performed on this request.
  assert.deepEqual(resolveLang({ cookieLang: "fr" }), { lang: "en", source: "default", setCookie: null });
});

test("AC2④ — parseCookieHeader / isLang / htmlLangTag are pure and closed-set", () => {
  assert.deepEqual(parseCookieHeader(null), {});
  assert.deepEqual(parseCookieHeader(undefined), {});
  assert.deepEqual(parseCookieHeader("lang=zh"), { lang: "zh" });
  assert.deepEqual(parseCookieHeader("a=1; lang=zh; b=2"), { a: "1", lang: "zh", b: "2" });
  // Split at the FIRST `=` — a value may legally contain `=`.
  assert.deepEqual(parseCookieHeader("token=YWJj=="), { token: "YWJj==" });
  assert.deepEqual(parseCookieHeader("garbage; lang=zh"), { lang: "zh" });
  assert.deepEqual(parseCookieHeader("=oops; lang=zh"), { lang: "zh" }, "an empty name is not a cookie");

  assert.equal(isLang("zh"), true);
  assert.equal(isLang("en"), true);
  assert.equal(isLang("fr"), false);
  assert.equal(isLang("ZH"), false, "the value set is case-sensitive — `ZH` is not a legal language");
  assert.equal(isLang(undefined), false);
  assert.equal(isLang(null), false);
  assert.equal(isLang(123), false);
  assert.deepEqual([...LANGS], ["en", "zh"]);
  assert.equal(DEFAULT_LANG, "en");

  assert.equal(htmlLangTag("zh"), '<html lang="zh">');
  assert.equal(htmlLangTag("en"), '<html lang="en">');
  // Absent ⇒ the default tag, so a page rendered by a caller that predates this field stays `en`
  // rather than emitting `lang="undefined"`.
  assert.equal(htmlLangTag(undefined), '<html lang="en">');
});

// ── AC3: the black box — a real server, real HTTP, three independent assertions ─────────────────

let server, port, originalCwd;

before(async () => {
  const tasksDir = makeTmpDir("ac288-tasks-");
  const adrDir = makeTmpDir("ac288-adr-");
  const workspaceRoot = makeTmpDir("ac288-ws-");
  fs.writeFileSync(
    path.join(tasksDir, "AC288-001.md"),
    "---\nid: AC288-001\ntitle: serve-lang fixture\ntodo: false\nstatus: todo\nlabels: []\n---\n\n## Proposal\na\n## Plan\nb\n## Acceptance Criteria\n- [ ] c\n## Definition of Done\n- [x] d\n",
  );
  const goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "docs-managed"), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`,
  );
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "ac288 serve-lang fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: workspaceRoot });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture init"], {
    cwd: workspaceRoot,
  });
  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  // `port: 0` — let the KERNEL pick. Probing for a free port ourselves races other workers, and a
  // bind collision here leaks the provider child and hangs the whole suite (serve-bind-failure-no-leak).
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
});

test("AC3① — no query, no cookie ⇒ `<html lang=\"en\"`", async () => {
  const res = await request(port, "/dashboard");
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('<html lang="en"'), 'the bare page must render <html lang="en"');
  assert.ok(!res.body.includes('<html lang="zh"'), "the default must not be zh");
});

test("AC3② — `?lang=zh` ⇒ body zh AND a `Set-Cookie` carrying `lang=zh` (two separate assertions)", async () => {
  const res = await request(port, "/dashboard?lang=zh");
  assert.equal(res.status, 200);
  // (a) the body — the rendered language.
  assert.ok(res.body.includes('<html lang="zh"'), '`?lang=zh` must render <html lang="zh"');
  // (b) the response HEADER — the persistence half. Asserted separately from (a): the language
  //     flipping without a cookie would satisfy the criterion's second check but fail its third,
  //     so one assertion passing is never reported as the other's evidence.
  const setCookie = res.headers["set-cookie"];
  assert.ok(setCookie, "`?lang=zh` must set a persistence cookie");
  assert.ok(String(setCookie).includes("lang=zh"), `Set-Cookie must carry lang=zh (was ${setCookie})`);
  assert.match(String(setCookie), /Path=\//);
  assert.match(String(setCookie), /Max-Age=\d+/, "the cookie must outlive the session (persistence)");
  assert.match(String(setCookie), /SameSite=Lax/);
});

test("AC3③ — `Cookie: lang=zh` with NO `?lang=` in the URL ⇒ body zh", async () => {
  const res = await request(port, "/dashboard", { Cookie: "lang=zh" });
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('<html lang="zh"'), "a bare /dashboard carrying the cookie must render zh");
  // ③ must NOT be green by accident: with the cookie absent the same URL renders en (checked by ①).
  // A cookie-carrying request must also not WRITE one back — nothing new was expressed.
  assert.equal(res.headers["set-cookie"], undefined, "reading a cookie is not a reason to re-set it");
});

test("AC3④ — one request's language does not leak into the next (per-request copy, not shared cfg)", async () => {
  const zh = await request(port, "/dashboard?lang=zh");
  assert.ok(zh.body.includes('<html lang="zh"'));
  const bare = await request(port, "/dashboard");
  assert.ok(
    bare.body.includes('<html lang="en"'),
    "after a ?lang=zh request, a bare request must still be en — `routeCfg` is service-lifetime, so an in-place `cfg.lang = …` would leak one request's language into every later one",
  );
});

test("AC3⑤ — an illegal value never renders as a language and never plants a cookie", async () => {
  const res = await request(port, "/dashboard?lang=fr");
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('<html lang="en"'), "an unreadable ?lang= falls back to the default en");
  assert.equal(res.headers["set-cookie"], undefined, "an unreadable value must not be persisted");
  // The response must still declare its cookie dependency (an intermediary cache would otherwise be
  // entitled to serve this `en` body to a client whose cookie says `zh`).
  assert.equal(res.headers["vary"], "Cookie");
});
