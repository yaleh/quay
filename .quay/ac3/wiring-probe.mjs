// AC3 wiring probe: does the PRODUCTION config of /data/home/yale/work/quay assemble the routine?
import { readDiscoveryMethodConfig, buildDiscoveryMethodRoutine, liveDiscoveryModel } from "/home/yale/work/quay-worktrees/gap-discovery-method-routine-report-only/plugin/scripts/discovery-method-routine.ts";
const root = "/data/home/yale/work/quay";
const read = readDiscoveryMethodConfig(root);
console.log(JSON.stringify({ present: read.present, error: read.error, enabled: read.config?.enabled ?? null, intervalMinutes: read.config?.trigger?.minutes ?? null, maxExperiences: read.config?.maxExperiences ?? null, maxModelCalls: read.config?.maxModelCalls ?? null, maxWallMs: read.config?.maxWallMs ?? null }));
const spec = buildDiscoveryMethodRoutine(root, read, {});
console.log(JSON.stringify({ name: spec.name, schedule: spec.schedule }));
const live = await liveDiscoveryModel(root);
console.log(JSON.stringify({ modelSeamOk: live.ok, modelId: live.modelId ?? null, reason: live.reason ?? null }));
