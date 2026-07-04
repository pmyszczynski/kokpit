import { describe, it, expect } from "vitest";
import { calcProgress } from "@/integrations/shared/queue";

describe("calcProgress", () => {
  it("returns 0 when size is 0, regardless of sizeleft", () => {
    expect(calcProgress(0, 0)).toBe(0);
    expect(calcProgress(0, 100)).toBe(0);
    expect(calcProgress(0, -50)).toBe(0);
  });

  it("returns 100 when sizeleft is 0 (fully downloaded)", () => {
    expect(calcProgress(100, 0)).toBe(100);
    expect(calcProgress(1, 0)).toBe(100);
  });

  it("returns 0 when sizeleft equals size (nothing downloaded)", () => {
    expect(calcProgress(50, 50)).toBe(0);
  });

  it("rounds fractional progress correctly", () => {
    expect(calcProgress(100, 33)).toBe(67);
    expect(calcProgress(3, 1)).toBe(67); // (1 - 1/3) * 100 = 66.66... -> 67
    expect(calcProgress(7, 2)).toBe(71); // (1 - 2/7) * 100 = 71.428... -> 71
  });

  it("clamps to 0 when sizeleft > size (would otherwise be negative)", () => {
    expect(calcProgress(100, 150)).toBe(0);
  });

  it("clamps to 100 when sizeleft is negative (would otherwise exceed 100)", () => {
    expect(calcProgress(100, -50)).toBe(100);
  });
});
