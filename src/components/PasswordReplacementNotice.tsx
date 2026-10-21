import Link from "next/link";
import "./PasswordReplacementNotice.css";

/** Shown only for a fully authenticated session that used a legacy long input. */
export default function PasswordReplacementNotice() {
  return (
    <aside className="password-replacement-notice" role="status">
      <p>
        Only the first 72 UTF-8 bytes of this password were checked.
        Replace it with a password of at most 72 UTF-8 bytes.
      </p>
      <p>
        <Link href="/reset-password">Use your saved recovery code to replace this password.</Link>{" "}
        If you no longer have that code, use the emergency password reset on the host.
      </p>
    </aside>
  );
}
