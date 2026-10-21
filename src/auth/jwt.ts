import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { randomUUID } from "node:crypto";
import { getServerSecret } from "./serverSecret";
import { getUserById } from "./users";
import { SessionInvalidatedError } from "./errors";
import {
  TOTP_CHALLENGE_TTL_SECONDS, isTotpChallengeClaims, isRegisteredTotpChallenge,
  registerTotpChallenge, type TotpChallengeClaims,
} from "./totpChallengeStore";

export async function signTotpChallenge(userId: string, expectedSessionVersion: number): Promise<string> {
  const user = getUserById(userId);
  if (!user || user.sessionVersion !== expectedSessionVersion) {
    throw new SessionInvalidatedError();
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const challenge: TotpChallengeClaims = {
    userId, sessionVersion: expectedSessionVersion, jti: randomUUID(), issuedAt,
    expiresAt: issuedAt + TOTP_CHALLENGE_TTL_SECONDS,
  };
  const token = await new SignJWT({ userId, sessionVersion: expectedSessionVersion, type: "totp_challenge" })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(challenge.jti)
    .setExpirationTime(challenge.expiresAt)
    .setIssuedAt(challenge.issuedAt)
    .sign(getServerSecret());
  // Signing yielded: conditionally register against the same credential
  // generation. Never publish a token for stale proof or without a live row.
  registerTotpChallenge(challenge);
  return token;
}

export async function verifyTotpChallenge(token: string): Promise<TotpChallengeClaims | null> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getServerSecret(), { algorithms: ["HS256"] }));
  } catch {
    return null;
  }
  if (payload.type !== "totp_challenge") return null;
  const challenge = { jti: payload.jti, userId: payload.userId, sessionVersion: payload.sessionVersion, issuedAt: payload.iat, expiresAt: payload.exp };
  // Database failures remain retryable route errors rather than pretending a
  // correctly signed challenge was rejected cryptographically.
  return isTotpChallengeClaims(challenge) && isRegisteredTotpChallenge(challenge) ? challenge : null;
}
