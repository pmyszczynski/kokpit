import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KokpitConfig } from "@/config/schema";
const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), published: vi.fn(), allowed: vi.fn(), user: vi.fn(), users: vi.fn() }));
vi.mock("@/config/server", () => ({ getConfigSnapshot: mocks.snapshot, getPublishedConfigSnapshot: mocks.published }));
vi.mock("@/auth/apiAuth", () => ({ isRequestAuthenticated: mocks.allowed }));
vi.mock("@/auth", () => ({ getAuthSession: mocks.user, countUsers: mocks.users, SESSION_COOKIE_NAME: "session" }));
vi.mock("@/config/revision", () => ({ configRevision: (source: string) => `revision:${source}` }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session" }) }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/components/ConfigurationSyncProvider", () => ({ ConfigurationSyncProvider: ({ children, initialRevision }: { children: React.ReactNode; initialRevision: string | null }) =>
  <section data-testid="observer" data-revision={initialRevision ?? "unavailable"}>{children}</section> }));
vi.mock("@/components/unsaved/UnsavedChangesProvider", () => ({ UnsavedChangesProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/edit/EditModeProvider", () => ({ EditModeProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/Navbar", () => ({ default: () => <nav>Protected navigation</nav> }));
vi.mock("@/components/PasswordReplacementNotice", () => ({ default: () => <aside>Replace legacy password</aside> }));
vi.mock("@/components/SessionRenewal", () => ({ default: () => null }));
import RootLayout from "@/app/layout";
import ProtectedLayout from "@/app/(protected)/layout";
const config: KokpitConfig = { schema_version: 2, auth: { enabled: false }, appearance: { theme: "oled", custom_css: ".private {}" }, layout: {}, services: [], service_tiles: [] };
const ready = { state: "ready", config, source: "public" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.snapshot.mockReturnValue(ready); mocks.published.mockReturnValue(ready);
  mocks.allowed.mockResolvedValue(true); mocks.user.mockResolvedValue({ user: { id: 1 }, session: {} }); mocks.users.mockReturnValue(1);
});
afterEach(() => { vi.unstubAllEnvs(); });
describe("configuration-safe server layouts", () => {
  it("keeps children and a managed empty style in neutral root markup after a cold parser failure", async () => {
    mocks.snapshot.mockImplementation(() => { throw new Error("/private/settings.yaml synthetic parser secret"); });
    const markup = renderToStaticMarkup(await RootLayout({ children: <p>Recovery observer</p> }));
    expect(markup).toContain("Recovery observer"); expect(markup).toContain('data-theme="dark"');
    expect(markup).toContain('id="kokpit-custom-css"'); expect(markup).not.toMatch(/private|parser|synthetic/);
  });
  it("does not apply previously public appearance when only the ready source changes during authorization", async () => {
    mocks.allowed.mockImplementation(async () => { mocks.published.mockReturnValue({ ...ready, source: "private" }); return true; });
    const markup = renderToStaticMarkup(await RootLayout({ children: <p>Child gate</p> }));
    expect(markup).toContain('data-theme="dark"'); expect(markup).not.toContain(".private");
  });
  it("does not apply previously public appearance when the unchanged source becomes dirty during authorization", async () => {
    mocks.allowed.mockImplementation(async () => { mocks.published.mockReturnValue({ ...ready, state: "dirty" }); return true; });
    const markup = renderToStaticMarkup(await RootLayout({ children: <p>Child gate</p> }));
    expect(markup).toContain('data-theme="dark"'); expect(markup).not.toContain(".private");
  });
  it("renders authorized first-paint appearance into one managed user-custom style", async () => {
    const markup = renderToStaticMarkup(await RootLayout({ children: null }));
    expect(markup).toContain('data-theme="oled"'); expect(markup).toContain("@layer user-custom { .private {} }");
  });
  it.each(["cold", "dirty"])("mounts the neutral recovery observer without retained dashboard children for %s state", async (state) => {
    const snapshot = { ...ready, state };
    mocks.snapshot.mockReturnValue(snapshot); mocks.published.mockReturnValue(snapshot);
    const markup = renderToStaticMarkup(await ProtectedLayout({ children: <p>Formerly public dashboard</p> }));
    expect(markup).toContain('data-testid="observer"'); expect(markup).toContain('data-revision="unavailable"');
    expect(markup).not.toMatch(/Formerly public|Protected navigation/);
  });
  it("keeps cold parse failures on the recoverable protected path", async () => {
    mocks.snapshot.mockImplementation(() => { throw new Error("invalid config"); });
    mocks.published.mockReturnValue({ state: "cold", config: null, source: null });
    const markup = renderToStaticMarkup(await ProtectedLayout({ children: <p>Private child</p> }));
    expect(markup).toContain('data-testid="observer"'); expect(markup).not.toContain("Private child");
  });
  it("preserves authenticated legacy-password guidance inside the protected sync and editor wrappers", async () => {
    vi.stubEnv("KOKPIT_AUTH_DISABLED", "false");
    const snapshot = { ...ready, config: { ...config, auth: { enabled: true } }, source: "private" };
    mocks.snapshot.mockReturnValue(snapshot); mocks.published.mockReturnValue(snapshot);
    mocks.user.mockResolvedValue({ user: { id: 1 }, session: { passwordReplacementRecommended: true } });
    const markup = renderToStaticMarkup(await ProtectedLayout({ children: <p>Protected child</p> }));
    expect(markup).toContain("Replace legacy password"); expect(markup).toContain("Protected child");
    expect(markup).toContain('data-testid="observer"');
  });
  it("does not emit session-specific password guidance on the public surface", async () => {
    mocks.user.mockResolvedValue({ user: { id: 1 }, session: { passwordReplacementRecommended: true } });
    const markup = renderToStaticMarkup(await ProtectedLayout({ children: <p>Public child</p> }));
    expect(markup).not.toContain("Replace legacy password"); expect(mocks.user).not.toHaveBeenCalled();
  });
  it("rejects a ready source change during authentication before rendering protected children", async () => {
    vi.stubEnv("KOKPIT_AUTH_DISABLED", "false");
    const privateConfig = { ...config, auth: { enabled: true } };
    const snapshot = { ...ready, config: privateConfig, source: "private" };
    mocks.snapshot.mockReturnValue(snapshot); mocks.published.mockReturnValue(snapshot);
    mocks.user.mockImplementation(async () => { mocks.published.mockReturnValue({ ...snapshot, source: "replaced private source" }); return { user: { id: 1 }, session: {} }; });
    const markup = renderToStaticMarkup(await ProtectedLayout({ children: <p>Private child</p> }));
    expect(mocks.user).toHaveBeenCalledOnce();
    expect(markup).toContain('data-revision="unavailable"'); expect(markup).not.toContain("Private child");
  });
  it("rejects an unchanged source becoming dirty during authentication before rendering protected children", async () => {
    vi.stubEnv("KOKPIT_AUTH_DISABLED", "false");
    const privateConfig = { ...config, auth: { enabled: true } };
    const snapshot = { ...ready, config: privateConfig, source: "private" };
    mocks.snapshot.mockReturnValue(snapshot); mocks.published.mockReturnValue(snapshot);
    mocks.user.mockImplementation(async () => { mocks.published.mockReturnValue({ ...snapshot, state: "dirty" }); return { user: { id: 1 }, session: {} }; });
    const markup = renderToStaticMarkup(await ProtectedLayout({ children: <p>Private child</p> }));
    expect(markup).toContain('data-revision="unavailable"'); expect(markup).not.toContain("Private child");
  });
});
