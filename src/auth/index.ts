export type { User } from "./users";
export {
  createUser,
  getUserByUsername,
  getUserById,
  countUsers,
  setTotpSecret,
  clearTotpSecret,
  updateTotpSecretAndRevokeOtherSessions,
  setRecoveryCodeHash,
  clearRecoveryCodeHash,
  updatePasswordHash,
  updatePasswordWithRecoveryCode,
} from "./users";
export { hashPassword, verifyPassword } from "./passwords";
export { signTotpChallenge, verifyTotpChallenge } from "./jwt";
export { getAuthUser, getAuthSession, SESSION_COOKIE_NAME } from "./session";
export { createSession, revokeSession, revokeUserSessions, revokeToken, listSessions } from "./sessionStore";
export type { AuthSession } from "./sessionStore";
export { verifySessionPassword } from "./reauthenticate";
export { isAuthenticationEnabled, isRequestAuthenticated } from "./apiAuth";
export { getDb, closeDb } from "./db";
export {
  generateTotpSecret,
  getTotpUri,
  getTotpQrCode,
  verifyTotpCode,
} from "./totp";
export {
  generateRecoveryCode,
  hashRecoveryCode,
  verifyRecoveryCode,
} from "./recovery";
