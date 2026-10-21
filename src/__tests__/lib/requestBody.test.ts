// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readBoundedBody, readBoundedFormData, readJsonObject } from "@/lib/requestBody";

function streaming(chunks: Uint8Array[], headers?: HeadersInit, cancel = vi.fn()): Request {
  return new Request("http://localhost/test", {
    method: "POST", headers,
    body: new ReadableStream({
      pull(controller) {
        const next = chunks.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      }, cancel,
    }), duplex: "half",
  } as RequestInit);
}

describe("bounded request bodies", () => {
  it("accepts the exact byte cap, including multibyte UTF-8 across tiny chunks", async () => {
    const data = new TextEncoder().encode('{"value":"😀é"}');
    const request = streaming(Array.from(data, byte => Uint8Array.of(byte)));
    expect(await readJsonObject(request, data.length)).toEqual({ value: "😀é" });
  });

  it.each([undefined, { "content-length": "1" }, { "content-length": "invalid" }])(
    "bounds actual chunks independently of declared length %j", async headers => {
      const cancel = vi.fn();
      const chunks = [new Uint8Array(8), new Uint8Array(9), new Uint8Array(100)];
      const request = streaming(chunks, headers, cancel);
      await expect(readBoundedBody(request, 16)).rejects.toMatchObject({ status: 413 });
      expect(cancel).toHaveBeenCalledTimes(1);
      // Cancellation stops the stream rather than reading the remaining body.
      expect(chunks.length).toBeGreaterThan(0);
    }
  );

  it("rejects a single oversized chunk without retaining/reading further chunks", async () => {
    const cancel = vi.fn();
    const request = streaming([new Uint8Array(17)], undefined, cancel);
    await expect(readBoundedBody(request, 16)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects a declared overflow without acquiring a reader", async () => {
    const request = streaming([new Uint8Array(8)], { "content-length": "17" });
    const reader = vi.spyOn(request.body!, "getReader");
    await expect(readBoundedBody(request, 16)).rejects.toMatchObject({ status: 413 });
    expect(reader).not.toHaveBeenCalled();
  });

  it.each(["null", "[]", "true", "1", '"text"'])("rejects the JSON non-object %s", async body => {
    await expect(readJsonObject(new Request("http://localhost", { method: "POST", body }), 64))
      .rejects.toMatchObject({ status: 400, message: "Invalid request body" });
  });

  it.each(["", "{invalid"])("rejects malformed/empty JSON without returning its content", async body => {
    await expect(readJsonObject(new Request("http://localhost", { method: "POST", body }), 64))
      .rejects.toMatchObject({ status: 400, message: "Invalid JSON" });
  });

  it("sanitizes stream failures", async () => {
    const request = new Request("http://localhost", {
      method: "POST", body: new ReadableStream({ start(c) { c.error(new Error("private credential")); } }), duplex: "half",
    } as RequestInit);
    await expect(readBoundedBody(request, 64)).rejects.toMatchObject({ status: 400, message: "Invalid request body" });
  });

  it("cancels a pending read on request abort and returns a safe error", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const request = new Request("http://localhost", {
      method: "POST", signal: controller.signal, body: new ReadableStream({ cancel }), duplex: "half",
    } as RequestInit);
    const read = readBoundedBody(request, 64);
    controller.abort();
    await expect(read).rejects.toMatchObject({ status: 400, message: "Invalid request body" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds multipart envelopes before parsing and retains valid file bytes", async () => {
    const form = new FormData();
    form.set("file", new File(["example"], "example.txt"));
    const request = new Request("http://localhost", { method: "POST", body: form });
    const nativeParser = vi.spyOn(request, "formData");
    const parsed = await readBoundedFormData(request, 1024);
    expect(await (parsed.get("file") as File).text()).toBe("example");
    expect(nativeParser).not.toHaveBeenCalled();
    // Use received multipart bytes for overflow: Undici's in-process FormData
    // encoder does not model an HTTP sender and can enqueue after cancellation.
    const encoded = new Request("http://localhost", { method: "POST", body: form });
    const tooLarge = streaming([new Uint8Array(await encoded.arrayBuffer())], encoded.headers);
    await expect(readBoundedFormData(tooLarge, 4)).rejects.toMatchObject({ status: 413 });
  });
});
