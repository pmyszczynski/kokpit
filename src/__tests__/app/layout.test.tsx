import { describe, it, expect } from "vitest";
import { metadata } from "@/app/layout";

describe("root layout metadata", () => {
  it("retains the existing title and description", () => {
    expect(metadata.title).toBe("kokpit");
    expect(metadata.description).toBe("Your self-hosted personal dashboard");
  });

  it("references the Kokpit web app manifest", () => {
    expect(metadata.manifest).toBe("/site.webmanifest");
  });

  it("declares a favicon icon pointing at the generated icon.png", () => {
    expect(metadata.icons).toMatchObject({
      icon: [{ url: "/icon.png", sizes: "512x512", type: "image/png" }],
    });
  });

  it("declares an apple touch icon pointing at the generated apple-icon.png", () => {
    expect(metadata.icons).toMatchObject({
      apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    });
  });
});