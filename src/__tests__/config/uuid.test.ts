import { describe, it, expect } from "vitest";
import { z } from "zod";
import { generateUuid } from "@/config/uuid";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UuidSchema = z.uuid();

describe("generateUuid", () => {
  it("uses native randomUUID when available", () => {
    const id = generateUuid();
    expect(id).toMatch(UUID_V4);
  });

  it("falls back to secure random byte generation if randomUUID is missing", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    if (!descriptor?.configurable) {
      return;
    }

    let callCount = 0;
    const fallbackCrypto = {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_, index) => { bytes[index] = (index + callCount++) & 0xff; });
        return bytes;
      },
    };
    try {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: fallbackCrypto,
      });
      const first = generateUuid();
      const second = generateUuid();
      expect(first).toMatch(UUID_V4);
      expect(second).toMatch(UUID_V4);
      expect(UuidSchema.safeParse(first).success).toBe(true);
      expect(UuidSchema.safeParse(second).success).toBe(true);
      expect(first).not.toBe(second);
    } finally {
      Object.defineProperty(globalThis, "crypto", descriptor!);
    }
  });

  it("fails rather than generating a weak identifier when Web Crypto is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    if (!descriptor?.configurable) {
      return;
    }

    try {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: {},
      });
      expect(() => generateUuid()).toThrow("Web Crypto unavailable");
    } finally {
      Object.defineProperty(globalThis, "crypto", descriptor!);
    }
  });
});
