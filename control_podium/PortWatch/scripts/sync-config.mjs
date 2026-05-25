#!/usr/bin/env node
// sync-config.mjs — bake .config.portwatch.yaml into the app bundle.
// ====================================================================
//
// PortWatch holds every behavior knob (paging timeouts, retry budgets,
// BLE MTU, lease renew cadence, log retention…) in
// `.config.portwatch.yaml`. The Metro bundler can't read YAML at
// runtime, so this script translates it into a typed TypeScript module
// the app imports normally:
//
//   import { CFG } from "@/config";
//   setInterval(renew, CFG.lease.renew_interval_ms);
//
// Why this exists (vs. just inlining the numbers in TS):
//   * matches the .config.{nodes,bridge,commands,firmware}.yaml
//     pattern used across the rest of the project — one config
//     review pattern, one tool (`yq`) to grep them all,
//   * the YAML is the source of truth a non-coder can grep + edit,
//   * generated TS is gitignored so PRs never argue about formatting
//     of derived data.
//
// Lifecycle:
//   * `npm run sync-config`  — manual.
//   * `prestart` / `preios` / `preprebuild` / `preeas:build:*`
//     hooks (added to package.json next to sync-secret) — automatic.
//
// CLI flags:
//   --check        Read the YAML + render the would-be output, but
//                  refuse to write it. Used by CI to catch
//                  "edited YAML but forgot to commit the generated
//                  TS" PRs once we start checking in `generated.ts`
//                  for offline-build environments.
//
// Output: `src/_generated/config.generated.ts`

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const YAML_PATH = resolve(APP_ROOT, ".config.portwatch.yaml");
const OUT_DIR = resolve(APP_ROOT, "src", "_generated");
const OUT_FILE = resolve(OUT_DIR, "config.generated.ts");

function fail(msg) {
  console.error("\n[sync-config] " + msg + "\n");
  process.exit(1);
}

if (!existsSync(YAML_PATH)) {
  fail(
    `missing ${YAML_PATH}\n` +
      "This file is the source of truth for every PortWatch timing /\n" +
      "retry / size knob. Restore it from git (it's committed) before\n" +
      "rerunning sync-config.",
  );
}

let raw;
try {
  raw = yaml.load(readFileSync(YAML_PATH, "utf-8"));
} catch (err) {
  fail(`failed to parse ${YAML_PATH}: ${err.message}`);
}

// ── Bindings: dotted YAML path → TS field ────────────────────────────
//
// Anything we want the app to consume needs to be listed here. The
// runtime types are inferred from the YAML value (number / string /
// boolean) — string-typed values must be wrapped in quotes in the
// YAML to disambiguate.
//
// The 4-tuple is (yaml_path, ts_path, expected_type, doc_summary).
// `doc_summary` is folded into the generated file so the consuming
// IDE shows the same "why was this value picked" hint inline.
const bindings = [
  // Lease (engine controlLock).
  ["lease.renew_interval_ms",      "lease.renew_interval_ms",      "number", "Periodic controlLock lease renew cadence (ms)."],
  ["lease.low_water_sec",          "lease.low_water_sec",          "number", "Renew defensively when remaining lease drops below this (sec)."],
  // Patterns paging.
  ["patterns.max_pages",           "patterns.max_pages",           "number", "Hard cap on chained page fetches for the deck pattern picker."],
  ["patterns.max_page_retries",    "patterns.max_page_retries",    "number", "Per-page retry budget; whole picker fails after this many."],
  ["patterns.page_timeout_ms",     "patterns.page_timeout_ms",     "number", "Per-page wait before counting as dropped (ms)."],
  ["patterns.retry_backoff_ms",    "patterns.retry_backoff_ms",    "number", "Linear back-off between retries (ms)."],
  // Exports paging.
  ["exports.max_pages",            "exports.max_pages",            "number", "Hard cap on chained pages for per-pattern exports list."],
  ["exports.max_page_retries",     "exports.max_page_retries",     "number", "Per-page retry budget for exports."],
  ["exports.page_timeout_ms",      "exports.page_timeout_ms",      "number", "Per-page wait for exports (ms)."],
  ["exports.retry_backoff_ms",     "exports.retry_backoff_ms",     "number", "Linear back-off between export-page retries (ms)."],
  // Logs.
  ["logs.max_entries",             "logs.max_entries",             "number", "Ring-buffer cap on UI log entries."],
  // BLE.
  ["ble.request_mtu",              "ble.request_mtu",              "number", "MTU we request on every new BLE connection."],
  ["ble.connect_timeout_ms",       "ble.connect_timeout_ms",       "number", "BLE connect-attempt timeout (ms)."],
  ["ble.rssi_poll_ms",             "ble.rssi_poll_ms",             "number", "RSSI poll cadence for the link bar (ms)."],
  ["ble.state_probe_timeout_ms",   "ble.state_probe_timeout_ms",   "number", "Wait for BLE-on state changes before falling back to OFF UI (ms)."],
  // Status polling.
  ["polling.status_interval_ms",          "polling.status_interval_ms",          "number", "qry engine/status cadence — primary sync path (ms)."],
  ["polling.status_timeout_ms",           "polling.status_timeout_ms",           "number", "Per-poll round-trip wait (ms)."],
  ["polling.local_exports_interval_ms",   "polling.local_exports_interval_ms",   "number", "Local exports polling cadence; 0 disables (ms)."],
  ["polling.local_exports_timeout_ms",    "polling.local_exports_timeout_ms",    "number", "Per-poll wait for each exports page (ms)."],
  // Layout.
  ["layout.max_content_width",     "layout.max_content_width",     "number", "Max content width (px) on iPad / landscape."],
  // Features.
  ["features.profile_switching_enabled", "features.profile_switching_enabled", "boolean", "Whether the profile switching UI picker is enabled in PortWatch."],
];

function dig(obj, path) {
  return path.split(".").reduce((cur, k) => (cur == null ? cur : cur[k]), obj);
}

function setDeep(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] ??= {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// Materialise the resolved object + a TS-typed shape we can serialise.
const resolved = {};
const missingKeys = [];

for (const [yamlPath, tsPath, expectedType, _doc] of bindings) {
  const v = dig(raw, yamlPath);
  if (v === undefined || v === null) {
    missingKeys.push(yamlPath);
    continue;
  }
  if (typeof v !== expectedType) {
    fail(
      `${yamlPath} should be a ${expectedType} (got ${typeof v} = ${JSON.stringify(v)})`,
    );
  }
  setDeep(resolved, tsPath, v);
}

if (missingKeys.length) {
  fail(
    "the following keys are missing from .config.portwatch.yaml:\n  - " +
      missingKeys.join("\n  - ") +
      "\nAdd them to the YAML (with doc comments!) or remove them from\n" +
      "the bindings list in scripts/sync-config.mjs.",
  );
}

// ── Render the .ts module ────────────────────────────────────────────
//
// We do NOT JSON.stringify the whole object — losing the per-field
// JSDoc would lose half the value of having a YAML config in the
// first place. Walk the bindings list to emit one typed `as const`
// declaration per leaf, then aggregate them into the CFG export.

function tsLiteral(value, expectedType) {
  if (expectedType === "string") return JSON.stringify(value);
  if (expectedType === "boolean") return value ? "true" : "false";
  return String(value); // number
}

// Group bindings by top-level section so the output has neat
// `lease: { ... }, patterns: { ... }` blocks rather than one
// flat object.
const groups = new Map();
for (const [yamlPath, tsPath, expectedType, doc] of bindings) {
  const [section, ...rest] = tsPath.split(".");
  const leaf = rest.join(".");
  if (!groups.has(section)) groups.set(section, []);
  groups.get(section).push({ leaf, expectedType, doc, yamlPath });
}

let out = "";
out += "// AUTO-GENERATED by scripts/sync-config.mjs from\n";
out += "// `.config.portwatch.yaml`. DO NOT EDIT BY HAND — run\n";
out += "//   npm run sync-config\n";
out += "// to regenerate after editing the YAML.\n";
out += "//\n";
out += "// Every leaf below is annotated with the comment block from the\n";
out += "// YAML source so the consuming IDE can show the rationale\n";
out += "// inline (hover any CFG.* field). If the rationale changes,\n";
out += "// edit the YAML — never edit this file.\n";
out += "\n";

for (const [section, leaves] of groups) {
  out += `export const ${section} = {\n`;
  for (const { leaf, expectedType, doc, yamlPath } of leaves) {
    out += `  /** ${doc} (yaml: \`${yamlPath}\`) */\n`;
    out += `  ${leaf}: ${tsLiteral(dig(resolved, `${section}.${leaf}`), expectedType)},\n`;
  }
  out += "} as const;\n\n";
}

// Convenience aggregator that mirrors the YAML's section shape.
out += "export const CFG = {\n";
for (const section of groups.keys()) {
  out += `  ${section},\n`;
}
out += "} as const;\n";

// ── Write or --check ─────────────────────────────────────────────────

const isCheck = process.argv.includes("--check");
if (isCheck) {
  // No-op write; just verify the YAML parses & all bindings resolve.
  process.stdout.write(`[sync-config] ${OUT_FILE} would be ${out.length} bytes\n`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, out, "utf-8");
process.stdout.write(
  `[sync-config] wrote ${OUT_FILE} (${out.length} bytes, ${bindings.length} bindings)\n`,
);
