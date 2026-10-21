import { request as httpRequest } from "node:http";

/** Send real chunked HTTP framing rather than contradictory Content-Length. */
export async function chunkedRequest(url: string, method: string, bytes: Buffer, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const outgoing = httpRequest(url, { method, headers }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      response.on("error", reject);
    });
    outgoing.setTimeout(30_000, () => outgoing.destroy(new Error("Chunked request timed out")));
    outgoing.on("error", reject);
    outgoing.write(bytes.subarray(0, Math.min(bytes.length, 8192)));
    outgoing.end(bytes.subarray(Math.min(bytes.length, 8192)));
  });
}
