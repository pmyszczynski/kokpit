/**
 * Thrown when credentials were verified against an account generation that
 * changed before a session or challenge could be issued.
 */
export class SessionInvalidatedError extends Error {
  constructor() {
    super("Session creation was invalidated");
    this.name = "SessionInvalidatedError";
  }
}
