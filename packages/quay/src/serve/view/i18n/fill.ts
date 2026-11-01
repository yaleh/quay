// fill.ts — extracted from serve-i18n.ts by gap-routine-architecture-analysis-god-package-serve-view.
// Shared {name} template filler (formerly serve-i18n.ts ROW 6's exported helper).
// ⛔ This file is a VERBATIM extraction — the words here are the same source of truth they
// were in serve-i18n.ts; serve-i18n.ts is now only a barrel re-exporting this module.

/** Substitute `{name}` in `template` from `params`; THROW on a placeholder left unfilled (ROW 6).
 *  Exported (rather than inlined into `dashboardLabel`) because a renderer that took the whole
 *  roster via `dashboardLabelsFor` still needs to fill the interpolated rows it took. */
export function fillLabel(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_whole, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      throw new Error(
        `serve-i18n: label ${JSON.stringify(template)} needs {${name}} and the caller supplied it not — ` +
        `supplied: ${JSON.stringify(Object.keys(params))}`,
      );
    }
    return String(params[name]);
  });
}
