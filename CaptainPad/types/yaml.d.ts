declare module '*.yaml' {
  const content: any;
  export default content;
}

// `js-yaml` ships no bundled types and @types/js-yaml isn't vendored (offline
// rule: no runtime installs). Tests use it to parse the shipped .yaml profiles
// the same way the metro yaml-transformer feeds the bundle. A minimal ambient
// declaration keeps tsc happy without adding a dependency.
declare module 'js-yaml' {
  export function load(input: string, options?: unknown): unknown;
  export function loadAll(input: string, iterator?: unknown, options?: unknown): unknown[];
  export function dump(obj: unknown, options?: unknown): string;
  const _default: { load: typeof load; loadAll: typeof loadAll; dump: typeof dump };
  export default _default;
}
