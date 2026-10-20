// gate/gate-event-store.ts — FORWARDING re-export (tasks/gap-src-root-gate-cycle-break).
//
// The implementation moved DOWN to `core/gate-event-store.ts`: the goal store (`core/goal-store.ts`)
// appends goal gate events through it, and a `core/` module may not import `gate/`. `gate/**` imports
// `../core/gate-event-store.ts` directly; this path stays for historical consumers (quay-native,
// plugin/scripts, plugin tests).
export * from "../core/gate-event-store.ts";
