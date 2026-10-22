import type Database from "better-sqlite3";

type DatabaseState = {
  path: string;
  status: "initializing" | "ready" | "unavailable";
  handle?: Database.Database;
};
const DATABASE_STATE_KEY = Symbol.for("kokpit.auth.database.readiness");
type Host = typeof globalThis & { [DATABASE_STATE_KEY]?: DatabaseState };
const path = () => process.env.KOKPIT_DB_PATH ?? "data/users.db";

export function recordDatabaseInitializing(): void {
  (globalThis as Host)[DATABASE_STATE_KEY] = { path: path(), status: "initializing" };
}

export function recordDatabaseInitialized(handle: Database.Database): void {
  (globalThis as Host)[DATABASE_STATE_KEY] = { path: path(), status: "ready", handle };
}

export function recordDatabaseUnavailable(): void {
  (globalThis as Host)[DATABASE_STATE_KEY] = { path: path(), status: "unavailable" };
}

export function recordDatabaseClosed(handle: Database.Database): void {
  const state = (globalThis as Host)[DATABASE_STATE_KEY];
  if (state?.handle === handle) state.status = "unavailable";
}

/** Never opens a database or initializes/migrates schema. */
export function getDatabaseReadiness(): "initializing" | "ready" | "unavailable" {
  const state = (globalThis as Host)[DATABASE_STATE_KEY];
  if (!state || state.path !== path()) return "initializing";
  const database = state.handle;
  if (state.status !== "ready" || !database?.open || database.readonly) return state.status === "initializing" ? "initializing" : "unavailable";
  let previousTimeout: number | undefined;
  try {
    previousTimeout = database.pragma("busy_timeout", { simple: true }) as number;
    database.pragma("busy_timeout = 50");
    if (database.pragma("query_only", { simple: true }) !== 0) return "unavailable";
    // Compile against every column used by account, session and admission
    // operations. LIMIT 0 checks schema without returning account information.
    database.prepare(`
      SELECT u.id, u.username, u.password_hash, u.totp_secret, u.created_at,
        u.session_version, u.recovery_code_hash,
        s.id, s.user_id, s.token_hash, s.device, s.created_at,
        s.last_seen_at, s.idle_timeout_hours, s.password_replacement_recommended,
        t.jti, t.user_id, t.session_version, t.issued_at, t.expires_at,
        t.attempts, t.state, t.password_replacement_recommended,
        l.key, l.attempts, l.expires_at, r.id, r.requested_at
      FROM users u LEFT JOIN sessions s ON 0
        LEFT JOIN login_rate_limits l ON 0 LEFT JOIN login_request_times r ON 0
        LEFT JOIN totp_challenges t ON 0
      LIMIT 0
    `).get();
    return "ready";
  } catch {
    return "unavailable";
  } finally {
    if (database.open && Number.isInteger(previousTimeout) && previousTimeout! >= 0) {
      try { database.pragma(`busy_timeout = ${previousTimeout}`); } catch { /* handle became unusable */ }
    }
  }
}
