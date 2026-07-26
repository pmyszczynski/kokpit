// @vitest-environment node
import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.KOKPIT_SESSION_SECRET =
    "reference-test-secret-32-chars-minimum";
});

function signRawPayload(payload: unknown): string {
  const rawKey = process.env.KOKPIT_SESSION_SECRET!;
  const purposeKey = createHmac("sha256", rawKey)
    .update("kokpit/widget-secret-reference/v1")
    .digest();
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", purposeKey)
    .update(encoded)
    .digest("base64url");
  return `__KOKPIT_WIDGET_SECRET_REF__:${encoded}.${mac}`;
}

describe("signed widget secret references", () => {
  it("round-trips an authenticated locator without secret material", async () => {
    const { createWidgetSecretReference, verifyWidgetSecretReference } =
      await import("@/widgets/secretReference.server");
    const token = createWidgetSecretReference(
      "Tautulli",
      "tautulli-activity",
      "api_key"
    );

    expect(token).not.toContain("saved-super-secret");
    expect(verifyWidgetSecretReference(token)).toEqual({
      v: 1,
      serviceName: "Tautulli",
      widgetType: "tautulli-activity",
      fieldKey: "api_key",
    });
  });

  it("uses a purpose-derived key rather than the raw JWT key", async () => {
    const { WIDGET_SECRET_REFERENCE_PREFIX } = await import(
      "@/widgets/secretReference"
    );
    const { createWidgetSecretReference } = await import(
      "@/widgets/secretReference.server"
    );
    const token = createWidgetSecretReference("A", "plex", "token");
    const [payload, signature] = token
      .slice(WIDGET_SECRET_REFERENCE_PREFIX.length)
      .split(".");
    const rawKeySignature = createHmac(
      "sha256",
      process.env.KOKPIT_SESSION_SECRET!
    )
      .update(payload)
      .digest("base64url");

    expect(signature).not.toBe(rawKeySignature);
  });

  it.each([
    "",
    "__KOKPIT_WIDGET_SECRET_REF__:",
    "__KOKPIT_WIDGET_SECRET_REF__:not-a-token",
    `__KOKPIT_WIDGET_SECRET_REF__:${"a".repeat(5000)}`,
  ])("fails closed for malformed or oversized value %#", async (value) => {
    const { verifyWidgetSecretReference } = await import(
      "@/widgets/secretReference.server"
    );
    expect(verifyWidgetSecretReference(value)).toBeNull();
  });

  it("rejects payload and signature tampering", async () => {
    const { WIDGET_SECRET_REFERENCE_PREFIX } = await import(
      "@/widgets/secretReference"
    );
    const { createWidgetSecretReference, verifyWidgetSecretReference } =
      await import("@/widgets/secretReference.server");
    const token = createWidgetSecretReference("A", "plex", "token");
    const encoded = token.slice(WIDGET_SECRET_REFERENCE_PREFIX.length);
    const [payload, signature] = encoded.split(".");
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );
    const changedPayload = Buffer.from(
      JSON.stringify({ ...decoded, serviceName: "B" })
    ).toString("base64url");
    const changedSignature =
      signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");

    expect(
      verifyWidgetSecretReference(
        `${WIDGET_SECRET_REFERENCE_PREFIX}${changedPayload}.${signature}`
      )
    ).toBeNull();
    expect(
      verifyWidgetSecretReference(
        `${WIDGET_SECRET_REFERENCE_PREFIX}${payload}.${changedSignature}`
      )
    ).toBeNull();
  });

  it("rejects signed payloads with wrong version or extra shape", async () => {
    const { verifyWidgetSecretReference } = await import(
      "@/widgets/secretReference.server"
    );

    expect(
      verifyWidgetSecretReference(
        signRawPayload({
          v: 2,
          serviceName: "A",
          widgetType: "plex",
          fieldKey: "token",
        })
      )
    ).toBeNull();
    expect(
      verifyWidgetSecretReference(
        signRawPayload({
          v: 1,
          serviceName: "A",
          widgetType: "plex",
          fieldKey: "token",
          extra: true,
        })
      )
    ).toBeNull();
  });
});
