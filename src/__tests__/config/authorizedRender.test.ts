// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), published: vi.fn(), allowed: vi.fn() }));
vi.mock("@/config/server", () => ({ getConfigSnapshot: mocks.snapshot, getPublishedConfigSnapshot: mocks.published }));
vi.mock("@/auth/apiAuth", () => ({ isRequestAuthenticated: mocks.allowed }));
import { getAuthorizedRenderSnapshot } from "@/config/authorizedRender";
const config = { auth: { enabled: false }, services: [{ name: "Public" }] };
const ready = { state: "ready", config, source: "public" };
beforeEach(() => { vi.clearAllMocks(); mocks.snapshot.mockReturnValue(ready); mocks.published.mockReturnValue(ready); mocks.allowed.mockResolvedValue(true); });
describe("exact-source server child rendering", () => {
  it("authorizes the newly read child snapshot rather than trusting an older public layout", async () => {
    const snapshot = { ...ready, config: { auth: { enabled: true }, services: [{ name: "Private" }] }, source: "private" };
    mocks.snapshot.mockReturnValue(snapshot); mocks.published.mockReturnValue(snapshot); mocks.allowed.mockResolvedValue(false);
    expect(await getAuthorizedRenderSnapshot()).toEqual({ state: "denied" });
    expect(mocks.allowed).toHaveBeenCalledExactlyOnceWith(snapshot.config);
  });
  it("returns no payload if the source changes while current authorization is checked", async () => {
    mocks.allowed.mockImplementation(async () => { mocks.published.mockReturnValue({ ...ready, source: "private" }); return true; });
    expect(await getAuthorizedRenderSnapshot()).toEqual({ state: "unavailable" });
  });
  it("returns no payload if the unchanged source becomes dirty during authorization", async () => {
    mocks.allowed.mockImplementation(async () => { mocks.published.mockReturnValue({ ...ready, state: "dirty" }); return true; });
    expect(await getAuthorizedRenderSnapshot()).toEqual({ state: "unavailable" });
  });
  it("returns only the exact stable snapshot after authorization", async () => {
    expect(await getAuthorizedRenderSnapshot()).toEqual({ state: "allowed", snapshot: ready });
  });
  it("keeps cold failures and dirty last-good config on the neutral recovery path", async () => {
    mocks.snapshot.mockReturnValue({ ...ready, state: "dirty" });
    expect(await getAuthorizedRenderSnapshot()).toEqual({ state: "unavailable" });
    expect(mocks.allowed).not.toHaveBeenCalled();
    mocks.snapshot.mockImplementation(() => { throw new Error("private parser detail"); });
    expect(await getAuthorizedRenderSnapshot()).toEqual({ state: "unavailable" });
  });
});
