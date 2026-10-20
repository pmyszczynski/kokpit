// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("persisted server key lifecycle", () => {
  let directory: string;

  beforeEach(() => {
    vi.resetModules();
    directory = mkdtempSync(join(tmpdir(), "kokpit-server-key-"));
    vi.stubEnv("KOKPIT_DB_PATH", join(directory, "first", "users.db"));
    vi.stubEnv("KOKPIT_SESSION_SECRET", undefined);
  });

  afterEach(async () => {
    const { closeDb } = await import("@/auth/db");
    closeDb();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it("creates a private key, reuses it after restart, and independently initializes another data directory", async () => {
    const { getServerSecret } = await import("@/auth/serverSecret");
    const first = getServerSecret();
    const secretPath = join(directory, "first", ".session_secret");
    expect(readFileSync(secretPath, "utf8")).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") {
      expect(statSync(secretPath).mode & 0o777).toBe(0o600);
    }

    vi.resetModules();
    const restarted = await import("@/auth/serverSecret");
    expect(restarted.getServerSecret()).toEqual(first);
    expect(readFileSync(secretPath, "utf8")).toBe(new TextDecoder().decode(first));

    vi.stubEnv("KOKPIT_DB_PATH", join(directory, "second", "users.db"));
    vi.resetModules();
    const independent = await import("@/auth/serverSecret");
    expect(independent.getServerSecret()).not.toEqual(first);
    expect(existsSync(join(directory, "second", ".session_secret"))).toBe(true);
  });

  it("uses a managed override without creating a persisted key", async () => {
    vi.stubEnv("KOKPIT_SESSION_SECRET", " managed-key-with-preserved-whitespace ");
    const { getServerSecret } = await import("@/auth/serverSecret");

    expect(new TextDecoder().decode(getServerSecret())).toBe(" managed-key-with-preserved-whitespace ");
    expect(existsSync(join(directory, "first", ".session_secret"))).toBe(false);
  });

  it("invalidates challenges, references and revisions on deliberate rotation while preserving opaque sessions", async () => {
    const { createUser } = await import("@/auth/users");
    const { createSession } = await import("@/auth/sessionStore");
    const { signTotpChallenge } = await import("@/auth/jwt");
    const { createWidgetSecretReference, createWidgetConfigReference } = await import("@/widgets/secretReference.server");
    const { configRevision } = await import("@/config/revision");
    const user = await createUser("rotation-user", "unused-password-hash");
    const session = createSession(user.id);
    const challenge = await signTotpChallenge(user.id, user.sessionVersion);
    const secretReference = createWidgetSecretReference("Plex", "plex", "token");
    const configReference = createWidgetConfigReference("Plex", "plex");
    const source = "services: []\n";
    const revision = configRevision(source);
    const persistedKey = readFileSync(join(directory, "first", ".session_secret"), "utf8");

    const { closeDb } = await import("@/auth/db");
    closeDb();
    vi.stubEnv("KOKPIT_SESSION_SECRET", "deliberately-replaced-managed-server-key");
    vi.resetModules();
    const { verifyTotpChallenge } = await import("@/auth/jwt");
    const { verifyWidgetSecretReference, verifyWidgetConfigReference } = await import("@/widgets/secretReference.server");
    const { configRevision: revised } = await import("@/config/revision");
    const { getAuthSession } = await import("@/auth/sessionStore");

    expect(await verifyTotpChallenge(challenge)).toBeNull();
    expect(verifyWidgetSecretReference(secretReference)).toBeNull();
    expect(verifyWidgetConfigReference(configReference)).toBeNull();
    expect(revised(source)).not.toBe(revision);
    expect(await getAuthSession(session.token)).toMatchObject({ user: { id: user.id }, session: { id: session.session.id } });
    expect(readFileSync(join(directory, "first", ".session_secret"), "utf8")).toBe(persistedKey);
  });
});
