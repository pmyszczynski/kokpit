import { describe, expect, it } from "vitest";
import { metadata } from "@/app/layout";

describe("root layout metadata", () => {
  it("references the canonical Kokpit brand icons", () => {
    expect(metadata.icons).toEqual({
      icon: [
        {
          url: "/brand/kokpit/png/kokpit-icon-512.png",
          sizes: "512x512",
          type: "image/png",
        },
      ],
      apple: [
        {
          url: "/brand/kokpit/png/kokpit-apple-touch-icon-180.png",
          sizes: "180x180",
          type: "image/png",
        },
      ],
    });
  });
});
