// lang.ts — the CLOSED language set (LANGS / Lang / DEFAULT_LANG) shared by the per-page label
// modules in ./i18n/ and re-exported by serve-lang.ts (the ONE language resolver).
//
// WHY THIS FILE EXISTS (gap-routine-architecture-analysis-god-package-serve-view-7368b251):
// the extracted label modules type their `lang` parameter as `Lang` and default it to
// `DEFAULT_LANG`. Importing those from `../serve-lang.ts` would close a directory-level cycle
// (serve/view → serve/view/i18n via the barrel, and serve/view/i18n → serve/view via the parent
// import). The three declarations therefore live HERE — a child module with no parent import — and
// serve-lang.ts re-exports them so its public surface (and every importer) stays byte-identical.
//
// Single source of truth: these three names are the ONLY definitions of the closed set. Do not
// re-declare `LANGS` / `Lang` / `DEFAULT_LANG` anywhere else — import from this module (or from
// serve-lang.ts, which re-exports them) instead.

export const LANGS = ["en", "zh"] as const;

export type Lang = (typeof LANGS)[number];

export const DEFAULT_LANG: Lang = "en";
