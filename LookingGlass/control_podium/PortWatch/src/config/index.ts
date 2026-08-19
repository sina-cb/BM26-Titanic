// Single import surface for every PortWatch behavior tunable.
//
// All numbers come from `.config.portwatch.yaml` (the source of truth)
// via `scripts/sync-config.mjs`, which writes the typed `as const`
// module at `src/_generated/config.generated.ts`. The re-export here
// gives consumers a stable shorter import path:
//
//   import { CFG } from "@/config";
//   setInterval(renew, CFG.lease.renew_interval_ms);
//
// or via the per-section aliases for ergonomics in hot loops:
//
//   import { lease, patterns } from "@/config";
//
// Why a re-export and not "import directly from _generated"?
//   * `_generated/` is gitignored, so its existence is build-time only.
//     If we ever want to swap the codegen for a remote fetch, the
//     consumer import path doesn't have to change.
//   * It also keeps the eslint "no deep import" rule happy without
//     anyone needing to memorise the generated path.

export {
  CFG,
  lease,
  patterns,
  exports as exportsCfg,
  logs,
  ble,
  polling,
  layout,
  features,
} from "../_generated/config.generated";
