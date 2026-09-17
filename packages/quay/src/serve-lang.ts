// serve-lang.ts — the ONE language resolver for the quay web face (AC-288 / GOAL-024).
//
// ============================ CONTRACT (single source of truth) ============================
// The goal criterion `goals/AC-288-*.md`'s `origin` fixed this contract; this file is its
// implementation. Read that file before changing any of the four rows below.
//
//   query param : `?lang=en|zh`  — value set is CLOSED {en, zh}
//   cookie      : `lang=en|zh`   — same closed set, Path=/; Max-Age=31536000; SameSite=Lax
//   default     : `en`
//   illegal value (`?lang=fr`, `Cookie: lang=fr`, `?lang=`) ⇒ NOT "another language" —
//                 it resolves like "absent", but reports `source: "invalid"` (see below).
//
// Resolution order: query (when it names a legal language) → cookie (when legal) → default `en`.
//
// WHY `source` HAS FOUR VALUES AND NOT THREE (hard rule 3b / 6): a judge whose output vocabulary
// cannot distinguish "I read the input and it was fine" from "the input was unreadable" collapses
// the two into one value, and `invalid` then becomes indistinguishable from `default` — i.e. a
// typo'd `?lang=fr` would silently look like "no preference given". `"invalid"` is therefore an
// INDEPENDENT value, never folded into `"default"`, and `setCookie` is null on it (a value we
// could not read is never persisted as the user's choice).
//
// WHY `?lang=` (empty string) IS "invalid", NOT "absent": `URLSearchParams.get` returns `null`
// for a parameter that is not in the URL at all and `""` for one that is present-but-empty.
// Treating those two as the same would erase the distinction the `source` field exists to carry.
//
// PURE BY CONSTRUCTION: no I/O, no request object, no clock — so the decision table above can be
// exercised by a direct-`import` unit test in both directions (positive AND negative control),
// which is what makes it a measurement rather than an echo (hard rule 4).
// ==========================================================================================

/** The closed set of legal languages. `en` is the default; both are first-class — no language has
 *  a dedicated branch anywhere in this module (see `resolveLang`). */
export const LANGS = ["en", "zh"] as const;

export type Lang = (typeof LANGS)[number];

export const DEFAULT_LANG: Lang = "en";

/** Where the resolved language came from. `"invalid"` is NOT a synonym for `"default"` — see the
 *  header's WHY note. It means "a query value was present and unreadable"; `lang` then falls back
 *  to the cookie / default, but the caller can still tell the two cases apart. */
export type LangSource = "query" | "cookie" | "default" | "invalid";

export interface LangResolution {
  /** The language the response must be rendered in. Always legal. */
  lang: Lang;
  /** Which input decided `lang` (see `LangSource`). */
  source: LangSource;
  /** The `Set-Cookie` header value to send, or null when no cookie must be written. Non-null ONLY
   *  when the query named a legal language — that is the user *expressing* a choice. A cookie that
   *  merely echoes back what the request already carried would be a write on every request. */
  setCookie: string | null;
}

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

/** Parse a `Cookie:` request header into a name→value map. Absent/malformed input yields `{}` —
 *  a cookie header is attacker-controlled and must never throw. Split at the FIRST `=` only: a
 *  cookie value may legally contain `=` (base64 padding), and splitting on the last one would
 *  truncate it. Percent-encoding is deliberately NOT decoded: `lang`'s value set is closed and
 *  ASCII, so a `%`-escaped value is not a legal language either way and must stay unreadable
 *  rather than be silently normalised into one. */
export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header == null) return out;
  for (const part of String(header).split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === "") continue;
    out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

export const LANG_COOKIE_NAME = "lang";

/** 1 year. A language preference has no expiry semantics of its own; the maximum the spec allows
 *  is the honest expression of "until the user says otherwise".
 *  ⛔ NO `Secure`: the web face is served over plain HTTP (`quay serve --host <ip>`, typically
 *  127.0.0.1 or a LAN address), and a `Secure` cookie is dropped outright on an `http://` origin —
 *  it would silently break persistence on the very deployment this mechanism targets.
 *  ⛔ NO `HttpOnly`: deliberate — see the AC6 decision record in the task body; `lang` carries no
 *  authority, so `HttpOnly` would protect nothing while forbidding first-party client code from
 *  reading the user's own choice. `SameSite=Lax` is the flag that does work here (no cross-site
 *  send, no cross-site set). */
export const LANG_COOKIE_ATTRS = "Path=/; Max-Age=31536000; SameSite=Lax";

/** The `Set-Cookie` value for a legal language. `en` and `zh` take this SAME path — there is no
 *  special case for either (a branch that only fires for one of the two is how a "default" quietly
 *  becomes a different mechanism from the "switch"). */
export function langCookie(lang: Lang): string {
  return `${LANG_COOKIE_NAME}=${lang}; ${LANG_COOKIE_ATTRS}`;
}

/**
 * The language decision table (see the file header for the contract it implements).
 *
 * `queryLang` / `cookieLang` are the RAW values as read from the request — `null` means "not
 * present". A value that is present but not in `LANGS` is handled by the `"invalid"` arm.
 */
export function resolveLang(
  input: { queryLang?: string | null; cookieLang?: string | null } = {},
): LangResolution {
  const queryLang = input.queryLang ?? null;
  const cookieLang = input.cookieLang ?? null;
  const legalCookie = isLang(cookieLang) ? cookieLang : null;

  // Query wins whenever it is present AND legal; it is the only arm that writes a cookie (the user
  // is stating a choice, not merely restating one).
  if (queryLang != null) {
    if (isLang(queryLang)) return { lang: queryLang, source: "query", setCookie: langCookie(queryLang) };
    // Present but unreadable: distinguishable from `"default"` on purpose, and writes nothing.
    return { lang: legalCookie ?? DEFAULT_LANG, source: "invalid", setCookie: null };
  }

  if (legalCookie != null) return { lang: legalCookie, source: "cookie", setCookie: null };

  return { lang: DEFAULT_LANG, source: "default", setCookie: null };
}

/** The document's opening tag in the resolved language — `<html lang="zh">`. The single source for
 *  this markup: every page that consumes the mechanism writes `${htmlLangTag(lang)}<head>`, so the
 *  literal `lang="en"` never appears in a page again (a hard-coded one is invisible to the
 *  resolver and would leave that page permanently `en`). */
export function htmlLangTag(lang: Lang = DEFAULT_LANG): string {
  return `<html lang="${lang}">`;
}
