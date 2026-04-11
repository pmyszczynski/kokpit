import { z } from "zod";

export interface UnraidConfig {
  url: string;
  api_key: string;
}

export const UnraidConfigSchema = z.object({
  url: z.string().url(),
  api_key: z.string().min(1),
});

export interface UnraidStats {
  arrayState: string;
  totalBytes: number;
  usedBytes: number;
  diskCount: number;
  diskErrors: number;
  parityStatus: string | null;
  parityErrors: number | null;
  parityDate: string | null;
}

const UnraidResponseSchema = z.object({
  data: z.object({
    array: z.object({
      state: z.string(),
      capacity: z.object({
        kilobytes: z.object({
          total: z.number(),
          used: z.number(),
        }),
      }),
      disks: z.array(
        z.object({
          type: z.string(),
          status: z.string(),
        })
      ),
    }),
    vars: z.object({
      mdNumDisks: z.number().optional().nullable(),
      mdNumInvalid: z.number().optional().nullable(),
      parity1status: z.string().optional().nullable(),
      parity1errors: z.number().optional().nullable(),
      parity1date: z.string().optional().nullable(),
    }),
  }),
});

const GRAPHQL_QUERY = `
query KokpitStats {
  array {
    state
    capacity {
      kilobytes { total used }
    }
    disks {
      type
      status
    }
  }
  vars {
    mdNumDisks
    mdNumInvalid
    parity1status
    parity1errors
    parity1date
  }
}
`.trim();

export async function fetchStats(
  config: UnraidConfig,
  signal?: AbortSignal
): Promise<UnraidStats> {
  const base = config.url.endsWith("/") ? config.url : `${config.url}/`;
  const url = new URL("graphql", base).toString();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.api_key}`,
    },
    body: JSON.stringify({ query: GRAPHQL_QUERY }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Unraid responded with ${response.status}`);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new Error("Unraid returned invalid JSON from the GraphQL endpoint.");
  }

  if (
    raw !== null &&
    typeof raw === "object" &&
    "errors" in raw &&
    Array.isArray((raw as { errors: unknown }).errors)
  ) {
    const messages = (raw as { errors: Array<{ message?: string }> }).errors
      .map((e) => e.message ?? "unknown error")
      .join("; ");
    throw new Error(`Unraid returned GraphQL errors: ${messages}`);
  }

  const parsed = UnraidResponseSchema.parse(raw);
  const { array, vars } = parsed.data;

  const dataDisks = array.disks.filter((d) => d.type === "Data");
  const diskErrors = array.disks.filter(
    (d) => d.status !== "DISK_OK" && d.status !== "DISK_NP"
  ).length;

  return {
    arrayState: array.state,
    totalBytes: array.capacity.kilobytes.total * 1024,
    usedBytes: array.capacity.kilobytes.used * 1024,
    diskCount: vars.mdNumDisks ?? dataDisks.length,
    diskErrors: vars.mdNumInvalid ?? diskErrors,
    parityStatus: vars.parity1status ?? null,
    parityErrors: vars.parity1errors ?? null,
    parityDate: vars.parity1date ?? null,
  };
}
