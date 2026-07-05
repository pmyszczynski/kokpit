import { vi } from "vitest";

/**
 * Shared next/navigation router mock. Each test file still needs its own
 * `vi.mock("next/navigation", ...)` call (Vitest's hoisting requires the call
 * to live in the file being mocked for), but importing these instances keeps
 * the mock's shape and reset logic in one place instead of four copies.
 */
export const pushMock = vi.fn();
export const refreshMock = vi.fn();

export function resetNavigationMock(): void {
  pushMock.mockReset();
  refreshMock.mockReset();
}
