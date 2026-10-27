/** Build the saved-ID response expected by the batched status transport. */
export function serviceStatusBatch(url: string, value: Record<string, unknown> | ((id: string) => unknown)) {
  const ids = new URL(url).searchParams.get("ids")?.split(",") ?? [];
  return { statuses: Object.fromEntries(ids.map(id => [id, typeof value === "function" ? value(id) : value])) };
}
