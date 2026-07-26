import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerSecret } from "@/auth/serverSecret";
import {
  isWidgetSecretReference,
  WIDGET_SECRET_REFERENCE_PREFIX,
} from "./secretReference";

const PURPOSE = "kokpit/widget-secret-reference/v1";
const MAX_REFERENCE_LENGTH = 2_048;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface WidgetSecretReference {
  v: 1;
  serviceName: string;
  widgetType: string;
  fieldKey: string;
}

function signingKey(): Buffer {
  return createHmac("sha256", getServerSecret()).update(PURPOSE).digest();
}

function signature(payload: string): Buffer {
  return createHmac("sha256", signingKey()).update(payload).digest();
}

function encodePayload(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  return `${WIDGET_SECRET_REFERENCE_PREFIX}${encoded}.${signature(encoded).toString("base64url")}`;
}

export function createWidgetSecretReference(
  serviceName: string,
  widgetType: string,
  fieldKey: string
): string {
  return encodePayload({
    v: 1,
    serviceName,
    widgetType,
    fieldKey,
  });
}

function isExactPayload(value: unknown): value is WidgetSecretReference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload).sort();
  return (
    keys.length === 4 &&
    keys[0] === "fieldKey" &&
    keys[1] === "serviceName" &&
    keys[2] === "v" &&
    keys[3] === "widgetType" &&
    payload.v === 1 &&
    typeof payload.serviceName === "string" &&
    payload.serviceName.length > 0 &&
    typeof payload.widgetType === "string" &&
    payload.widgetType.length > 0 &&
    typeof payload.fieldKey === "string" &&
    payload.fieldKey.length > 0
  );
}

export function verifyWidgetSecretReference(
  value: unknown
): WidgetSecretReference | null {
  if (
    !isWidgetSecretReference(value) ||
    value.length > MAX_REFERENCE_LENGTH
  ) {
    return null;
  }

  const token = value.slice(WIDGET_SECRET_REFERENCE_PREFIX.length);
  const parts = token.split(".");
  if (
    parts.length !== 2 ||
    !BASE64URL.test(parts[0]) ||
    !BASE64URL.test(parts[1])
  ) {
    return null;
  }

  let receivedSignature: Buffer;
  try {
    receivedSignature = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  const expectedSignature = signature(parts[0]);
  if (
    receivedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8")
    );
    return isExactPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}
