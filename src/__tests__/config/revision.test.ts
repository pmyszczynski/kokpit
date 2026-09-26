import { createHash, createHmac } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { configRevision } from "@/config/revision";
import { canonicalJSONString } from "@/config/canonicalJson";

const { serverSecret } = vi.hoisted(() => ({
  serverSecret: {
    bytes: new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x41]),
  },
}));

vi.mock("@/auth/serverSecret", () => ({
  getServerSecret: () => serverSecret.bytes,
}));

describe("canonicalJSONString", () => {
  it("is independent of object key insertion order", () => {
    expect(canonicalJSONString({ a: 1, b: 2 })).toBe(
      canonicalJSONString({ b: 2, a: 1 })
    );
  });

  it("preserves array order (order is semantic for services/groups)", () => {
    expect(canonicalJSONString([1, 2, 3])).not.toBe(
      canonicalJSONString([3, 2, 1])
    );
  });

  it("treats an undefined value the same as an absent key", () => {
    expect(canonicalJSONString({ a: 1, b: undefined })).toBe(
      canonicalJSONString({ a: 1 })
    );
  });
});

describe("configRevision", () => {
  const source = "schema_version: 2\nauth: { enabled: true, session_ttl_hours: 24 }\nservices: []\n";

  it("is a stable 64-char hex HMAC for the same key and exact source", () => {
    const rev = configRevision(source);
    expect(rev).toMatch(/^[0-9a-f]{64}$/);
    expect(configRevision(source)).toBe(configRevision(source));
  });

  it("changes when persisted YAML bytes change", () => {
    const before = configRevision(source);
    const after = configRevision(source.replace("services: []", "services:\n  - name: Plex"));
    expect(after).not.toBe(before);
  });

  it("changes for a comment-only edit", () => {
    const before = configRevision(source);
    const after = configRevision(`${source}# owned by the operator\n`);
    expect(after).not.toBe(before);
  });

  it("changes when the server secret changes", () => {
    const before = configRevision(source);
    serverSecret.bytes = new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x42]);

    expect(configRevision(source)).not.toBe(before);
  });

  it("is purpose-separated from an unkeyed config digest and preserves key bytes", () => {
    const unkeyed = createHash("sha256").update(source).digest("hex");
    const purposeKey = createHmac("sha256", serverSecret.bytes)
      .update("kokpit/config-source-revision/v2")
      .digest();
    const expected = createHmac("sha256", purposeKey)
      .update(source)
      .digest("hex");

    expect(configRevision(source)).toBe(expected);
    expect(configRevision(source)).not.toBe(unkeyed);
  });

  it("does not expose a low-entropy saved secret through an unkeyed hash oracle", () => {
    const sourceForPin = (pin: string) => `${source}api_key: ${pin}\n`;
    const observed = configRevision(sourceForPin("1"));
    const candidateDigests = ["1", "2"].map((pin) =>
      createHash("sha256")
        .update(sourceForPin(pin))
        .digest("hex")
    );

    expect(candidateDigests).not.toContain(observed);
  });
});
