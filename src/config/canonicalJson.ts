// Deterministic JSON serialization: object keys are emitted in sorted order at
// every depth so two structurally-equal configs always produce the same string
// regardless of key insertion order. Pure and dependency-free — safe to import
// from both server and client code (no `node:` imports).
//
// Used to derive a stable content revision (see ./revision) and to compare a
// draft against its baseline in the edit-mode client.

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const v = source[key];
      // Drop `undefined` values so an explicitly-undefined key and an absent
      // key hash identically (matches JSON.stringify's own omission).
      if (v === undefined) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/** Stable JSON string with recursively sorted object keys. */
export function canonicalJSONString(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
