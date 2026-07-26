import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerSecret } from "@/auth/serverSecret";
import {
  isWidgetConfigReference,
  isWidgetSecretReference,
  WIDGET_CONFIG_REFERENCE_PREFIX,
  WIDGET_SECRET_REFERENCE_PREFIX,
} from "./secretReference";

const PURPOSE = "kokpit/widget-secret-reference/v2";
const MAX_REFERENCE_LENGTH = 2_048;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface WidgetSecretReference {
  v: 2;
  kind: "field";
  serviceLocator: string;
  widgetLocator: string;
  fieldLocator: string;
}

export interface WidgetConfigReference {
  v: 2;
  kind: "config";
  serviceLocator: string;
  widgetLocator: string;
}

function signingKey(): Buffer {
  return createHmac("sha256", getServerSecret()).update(PURPOSE).digest();
}

function signature(payload: string): Buffer {
  return createHmac("sha256", signingKey()).update(payload).digest();
}

function encodePayload(prefix: string, payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  return `${prefix}${encoded}.${signature(encoded).toString("base64url")}`;
}

/**
 * Fixed-length, server-keyed identifier for a locator component. The only
 * variable-length strings that used to be embedded in references were service
 * names, widget ids, and field names; hashing all three makes every issued
 * token safely smaller than the verifier's input limit.
 */
function locator(kind: string, value: string): string {
  const canonicalValue = kind === "service" ? value.trim().toLowerCase() : value;
  return createHmac("sha256", signingKey())
    .update(`${kind}\u0000${canonicalValue}`)
    .digest("base64url");
}

function locatorMatches(locatorValue: string, kind: string, value: string): boolean {
  const expected = Buffer.from(locator(kind, value), "utf8");
  const received = Buffer.from(locatorValue, "utf8");
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

export function createWidgetSecretReference(
  serviceName: string,
  widgetType: string,
  fieldKey: string
): string {
  return encodePayload(WIDGET_SECRET_REFERENCE_PREFIX, {
    v: 2,
    kind: "field",
    serviceLocator: locator("service", serviceName),
    widgetLocator: locator("widget", widgetType),
    fieldLocator: locator("field", fieldKey),
  });
}

export function createWidgetConfigReference(
  serviceName: string,
  widgetType: string
): string {
  return encodePayload(WIDGET_CONFIG_REFERENCE_PREFIX, {
    v: 2,
    kind: "config",
    serviceLocator: locator("service", serviceName),
    widgetLocator: locator("widget", widgetType),
  });
}

export function widgetSecretReferenceMatches(
  reference: WidgetSecretReference,
  serviceName: string,
  widgetType: string,
  fieldKey: string
): boolean {
  return (
    locatorMatches(reference.serviceLocator, "service", serviceName) &&
    locatorMatches(reference.widgetLocator, "widget", widgetType) &&
    locatorMatches(reference.fieldLocator, "field", fieldKey)
  );
}

export function widgetConfigReferenceMatches(
  reference: WidgetConfigReference,
  serviceName: string,
  widgetType: string
): boolean {
  return (
    locatorMatches(reference.serviceLocator, "service", serviceName) &&
    locatorMatches(reference.widgetLocator, "widget", widgetType)
  );
}

function isExactFieldPayload(value: unknown): value is WidgetSecretReference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload).sort();
  return (
    keys.length === 5 &&
    keys[0] === "fieldLocator" &&
    keys[1] === "kind" &&
    keys[2] === "serviceLocator" &&
    keys[3] === "v" &&
    keys[4] === "widgetLocator" &&
    payload.v === 2 &&
    payload.kind === "field" &&
    typeof payload.serviceLocator === "string" &&
    typeof payload.widgetLocator === "string" &&
    typeof payload.fieldLocator === "string" &&
    BASE64URL.test(payload.serviceLocator) &&
    BASE64URL.test(payload.widgetLocator) &&
    BASE64URL.test(payload.fieldLocator)
  );
}

function isExactConfigPayload(value: unknown): value is WidgetConfigReference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload).sort();
  return (
    keys.length === 4 &&
    keys[0] === "kind" &&
    keys[1] === "serviceLocator" &&
    keys[2] === "v" &&
    keys[3] === "widgetLocator" &&
    payload.v === 2 &&
    payload.kind === "config" &&
    typeof payload.serviceLocator === "string" &&
    typeof payload.widgetLocator === "string" &&
    BASE64URL.test(payload.serviceLocator) &&
    BASE64URL.test(payload.widgetLocator)
  );
}

function verifyReference<T>(
  value: unknown,
  prefix: string,
  isExactPayload: (payload: unknown) => payload is T
): T | null {
  if (
    typeof value !== "string" ||
    !value.startsWith(prefix) ||
    value.length > MAX_REFERENCE_LENGTH
  ) {
    return null;
  }

  const token = value.slice(prefix.length);
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

export function verifyWidgetSecretReference(
  value: unknown
): WidgetSecretReference | null {
  if (!isWidgetSecretReference(value)) return null;
  return verifyReference(value, WIDGET_SECRET_REFERENCE_PREFIX, isExactFieldPayload);
}

export function verifyWidgetConfigReference(
  value: unknown
): WidgetConfigReference | null {
  if (!isWidgetConfigReference(value)) return null;
  return verifyReference(value, WIDGET_CONFIG_REFERENCE_PREFIX, isExactConfigPayload);
}
