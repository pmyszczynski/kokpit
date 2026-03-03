// Auth module — Phase 1 (Authentication system task) will fill this out.
// Responsibilities:
//   - Username/password auth (bcrypt)
//   - Session token management (httpOnly cookie, configurable expiry)
//   - Route protection middleware
//   - Optional TOTP 2FA
//   - First-run setup wizard when no users exist
//
// DO NOT use this placeholder directly. It will be replaced.

export type Session = {
  userId: string;
  expiresAt: Date;
};

export async function verifySession(_token: string): Promise<Session | null> {
  throw new Error("Auth system not yet implemented (Phase 1)");
}
