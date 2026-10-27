import { AUTH_JSON_BODY_BYTES, readJsonObject, RequestBodyError } from "@/lib/requestBody";
import { NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  getUserByUsername,
  verifyRecoveryCode,
  hashPassword,
  updatePasswordWithRecoveryCode,
} from "@/auth";
import { isTrustedMutation } from "@/auth/requestGuard";
import { passwordExceedsBcryptLimit } from "@/auth/passwords";
import { NEW_PASSWORD_BYTE_LIMIT_MESSAGE } from "@/auth/passwordPolicy";
import { reserveRecoveryAttempt, releaseSuccessfulLoginAttempt } from "@/auth/loginRateLimit";

// Dummy hash so verifyRecoveryCode always does the same amount of work,
// preventing username enumeration via response-time timing attacks.
const DUMMY_HASH = createHash("sha256").update("dummy").digest("hex");

export async function POST(req: Request) {
  if (!isTrustedMutation(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(req, AUTH_JSON_BODY_BYTES);
  } catch (error) {
    return NextResponse.json({ error: error instanceof RequestBodyError ? error.message : "Invalid JSON" },
      { status: error instanceof RequestBodyError ? error.status : 400 });
  }

  const { username, recoveryCode, newPassword } = body as {
    username?: unknown;
    recoveryCode?: unknown;
    newPassword?: unknown;
  };
  if (
    typeof username !== "string" ||
    typeof recoveryCode !== "string" ||
    typeof newPassword !== "string" ||
    !username ||
    !recoveryCode ||
    !newPassword
  ) {
    return NextResponse.json(
      { error: "username, recoveryCode and newPassword are required" },
      { status: 400 }
    );
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "newPassword must be at least 8 characters" },
      { status: 400 }
    );
  }
  if (passwordExceedsBcryptLimit(newPassword)) {
    return NextResponse.json(
      { error: NEW_PASSWORD_BYTE_LIMIT_MESSAGE, code: "password_too_long" },
      { status: 400 }
    );
  }

  const admission = reserveRecoveryAttempt(username);
  if (!admission.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(admission.retryAfterSeconds) } }
    );
  }

  const user = getUserByUsername(username);
  const candidateHash = user?.recoveryCodeHash ?? DUMMY_HASH;
  const codeOk = verifyRecoveryCode(recoveryCode, candidateHash);

  if (!user || !user.recoveryCodeHash || !codeOk) {
    return NextResponse.json(
      { error: "Invalid username or recovery code" },
      { status: 401 }
    );
  }

  const passwordHash = await hashPassword(newPassword);
  // Recheck and consume the exact recovery-code hash in the same transaction
  // as credential/session replacement. A concurrent reset can win only once.
  if (!updatePasswordWithRecoveryCode(user.id, candidateHash, passwordHash)) {
    return NextResponse.json(
      { error: "Invalid username or recovery code" },
      { status: 401 }
    );
  }
  releaseSuccessfulLoginAttempt(admission.attempt);

  return NextResponse.json({
    ok: true,
    totpStillEnabled: user.totpSecret !== null,
  });
}
