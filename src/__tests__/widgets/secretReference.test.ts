// @vitest-environment node
import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  WIDGET_SECRET_REFERENCE_KEY,
  WIDGET_SECRET_REFERENCE_PREFIX,
} from "@/widgets/secretReference";

beforeAll(() => {
  process.env.KOKPIT_SESSION_SECRET =
    "reference-test-secret-32-chars-minimum";
});

function signRawPayload(payload: unknown): string {
  const rawKey = process.env.KOKPIT_SESSION_SECRET!;
  const purposeKey = createHmac("sha256", rawKey)
    .update("kokpit/widget-secret-reference/v2")
    .digest();
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", purposeKey)
    .update(encoded)
    .digest("base64url");
  return `__KOKPIT_WIDGET_SECRET_REF__:${encoded}.${mac}`;
}

function fieldReference(token: string) {
  return { [WIDGET_SECRET_REFERENCE_KEY]: token };
}

describe("signed widget secret references", () => {
  it("round-trips an authenticated locator without secret material", async () => {
    const {
      createWidgetSecretReference,
      verifyWidgetSecretReference,
      widgetSecretReferenceMatches,
    } = await import("@/widgets/secretReference.server");
    const token = createWidgetSecretReference(
      "Tautulli",
      "tautulli-activity",
      "api_key"
    );

    const encodedToken = token[WIDGET_SECRET_REFERENCE_KEY];
    expect(encodedToken).not.toContain("saved-super-secret");
    expect(encodedToken).not.toContain("Tautulli");
    expect(encodedToken).not.toContain("tautulli-activity");
    expect(encodedToken).not.toContain("api_key");
    const reference = verifyWidgetSecretReference(token);
    expect(reference).toMatchObject({ v: 2, kind: "field" });
    expect(reference).not.toBeNull();
    expect(
      widgetSecretReferenceMatches(
        reference!,
        "Tautulli",
        "tautulli-activity",
        "api_key"
      )
    ).toBe(true);
  });

  it("uses a purpose-derived key rather than the raw JWT key", async () => {
    const { createWidgetSecretReference } = await import(
      "@/widgets/secretReference.server"
    );
    const token = createWidgetSecretReference("A", "plex", "token");
    const [payload, signature] = token
      [WIDGET_SECRET_REFERENCE_KEY].slice(WIDGET_SECRET_REFERENCE_PREFIX.length)
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
    fieldReference(""),
    fieldReference("__KOKPIT_WIDGET_SECRET_REF__:"),
    fieldReference("__KOKPIT_WIDGET_SECRET_REF__:not-a-token"),
    fieldReference(`__KOKPIT_WIDGET_SECRET_REF__:${"a".repeat(5000)}`),
  ])("fails closed for malformed or oversized value %#", async (value) => {
    const { verifyWidgetSecretReference } = await import(
      "@/widgets/secretReference.server"
    );
    expect(verifyWidgetSecretReference(value)).toBeNull();
  });

  it("issues a verifiable fixed-size locator for an arbitrarily long service name", async () => {
    const {
      createWidgetSecretReference,
      verifyWidgetSecretReference,
      widgetSecretReferenceMatches,
    } = await import("@/widgets/secretReference.server");
    const serviceName = "T".repeat(10_000);
    const token = createWidgetSecretReference(
      serviceName,
      "tautulli-activity",
      "api_key"
    );

    expect(token[WIDGET_SECRET_REFERENCE_KEY].length).toBeLessThan(2_048);
    const reference = verifyWidgetSecretReference(token);
    expect(reference).not.toBeNull();
    expect(
      widgetSecretReferenceMatches(
        reference!,
        serviceName,
        "tautulli-activity",
        "api_key"
      )
    ).toBe(true);
  });

  it("rejects payload and signature tampering", async () => {
    const { createWidgetSecretReference, verifyWidgetSecretReference } =
      await import("@/widgets/secretReference.server");
    const token = createWidgetSecretReference("A", "plex", "token");
    const encoded = token[WIDGET_SECRET_REFERENCE_KEY].slice(
      WIDGET_SECRET_REFERENCE_PREFIX.length
    );
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
        fieldReference(
          `${WIDGET_SECRET_REFERENCE_PREFIX}${changedPayload}.${signature}`
        )
      )
    ).toBeNull();
    expect(
      verifyWidgetSecretReference(
        fieldReference(
          `${WIDGET_SECRET_REFERENCE_PREFIX}${payload}.${changedSignature}`
        )
      )
    ).toBeNull();
  });

  it("rejects signed payloads with wrong version or extra shape", async () => {
    const { verifyWidgetSecretReference } = await import(
      "@/widgets/secretReference.server"
    );

    expect(
      verifyWidgetSecretReference(
        fieldReference(signRawPayload({
          v: 2,
          serviceName: "A",
          widgetType: "plex",
          fieldKey: "token",
        }))
      )
    ).toBeNull();
    expect(
      verifyWidgetSecretReference(
        fieldReference(signRawPayload({
          v: 1,
          serviceName: "A",
          widgetType: "plex",
          fieldKey: "token",
          extra: true,
        }))
      )
    ).toBeNull();
  });
});
