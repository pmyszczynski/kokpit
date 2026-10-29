import { Worker } from "node:worker_threads";
import path from "node:path";
import { ssrfSafeFetch } from "@/lib/ssrfGuard";
import { WidgetFetchError } from "@/widgets/publicFetchError";
import { RssConfigSchema, type RssConfig, type RssData } from "./api";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PARSERS = 4;
const PARSE_TIMEOUT_MS = 2_000;
let activeParsers = 0;

function invalid(stage: string): WidgetFetchError {
  return new WidgetFetchError("widget_invalid_response", { integration: "rss", stage, retryable: false });
}

/** Untrusted XML/HTML parsing runs outside the request event loop. */
export function parseFeedIsolated(xml: string, feedUrl: string, maxItems: number, signal?: AbortSignal): Promise<RssData> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  if (Buffer.byteLength(xml, "utf8") > MAX_BYTES) return Promise.reject(invalid("size"));
  if (activeParsers >= MAX_PARSERS) return Promise.reject(new WidgetFetchError(
    "widget_upstream_unreachable", { integration: "rss", stage: "busy", retryable: true }
  ));
  return new Promise((resolve, reject) => {
    // Keep this literal aligned with next.config.ts output tracing. The worker
    // loads jsdom itself; no upstream document is parsed on the server thread.
    const worker = new Worker(path.join(process.cwd(), "src/integrations/rss/parser.cjs"), {
      workerData: { xml, feedUrl, maxItems },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
      stdout: true, stderr: true,
    });
    worker.stdout?.resume(); worker.stderr?.resume();
    activeParsers++;
    let settled = false;
    const finish = (error?: unknown, data?: RssData) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      // An aborted/timed-out parser still consumes its slot until its thread
      // has exited, so repeated requests cannot exceed the concurrency bound.
      void worker.terminate().then(() => {
        activeParsers--;
        if (error !== undefined) reject(error); else resolve(data!);
      }, () => { activeParsers--; reject(error ?? invalid("xml")); });
    };
    const abort = () => finish(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => finish(invalid("parse-budget")), PARSE_TIMEOUT_MS);
    worker.once("message", (message: { data?: RssData; error?: boolean; stage?: unknown }) => {
      const stage = message?.stage === "size" || message?.stage === "feed" ? message.stage : "xml";
      finish(message?.error || !message?.data ? invalid(stage) : undefined, message?.data);
    });
    worker.once("error", () => finish(invalid("xml")));
    worker.once("exit", () => { if (!settled) finish(invalid("xml")); });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function boundedText(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel().catch(() => {}); throw invalid("size");
  }
  if (!response.body) throw invalid("xml");
  const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0; let xml = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw invalid("size");
      xml += decoder.decode(value, { stream: true });
    }
    return xml + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => {}); throw error;
  } finally { reader.releaseLock(); }
}

export async function fetchFeed(input: RssConfig, signal?: AbortSignal): Promise<RssData> {
  const config = RssConfigSchema.parse(input);
  let response: Response;
  try {
    response = await ssrfSafeFetch(config.feed_url, { signal, allowPrivateNetworks: false,
      headers: { Accept: "application/rss+xml, application/atom+xml, application/rdf+xml, application/xml, text/xml;q=0.9" } });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new WidgetFetchError("widget_upstream_unreachable", { integration: "rss", stage: "fetch", retryable: true });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new WidgetFetchError("widget_upstream_error", { integration: "rss", stage: "http", upstreamStatus: response.status, retryable: response.status === 429 || response.status >= 500 });
  }
  try { return await parseFeedIsolated(await boundedText(response), response.url || config.feed_url, config.max_items, signal); }
  catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError") || error instanceof WidgetFetchError) throw error;
    throw invalid("body");
  }
}
