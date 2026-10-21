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

export class TotpChallengeCapacityError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Too many pending login challenges. Try again later.");
    this.name = "TotpChallengeCapacityError";
  }
}
