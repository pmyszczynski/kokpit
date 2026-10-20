/** Absolute browser destinations: HTTP(S), no embedded credentials. */
export function parseHttpUrl(value: string, { allowFragment = true }: { allowFragment?: boolean } = {}): URL | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && (allowFragment || !value.includes("#")) ? url : null;
  } catch { return null; }
}
