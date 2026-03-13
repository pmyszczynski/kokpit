import { generateSecret, generateURI, generateSync, verifySync } from "otplib";
import QRCode from "qrcode";

export function generateTotpSecret(): string {
  return generateSecret();
}

export function getTotpUri(secret: string, username: string): string {
  return generateURI({ issuer: "Kokpit", label: username, secret });
}

export async function getTotpQrCode(uri: string): Promise<string> {
  return QRCode.toDataURL(uri);
}

export function verifyTotpCode(token: string, secret: string): boolean {
  return verifySync({ token, secret }).valid;
}
