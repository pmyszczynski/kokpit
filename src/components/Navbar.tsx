import Link from "next/link";
import LogoutButton from "./LogoutButton";

interface NavbarProps {
  showLogout: boolean;
}

export default function Navbar({ showLogout }: NavbarProps) {
  return (
    <nav className="navbar">
      <Link href="/" className="navbar-brand">kokpit</Link>
      <div className="navbar-actions">
        <Link href="/settings" className="settings-link" aria-label="Settings">
          ⚙
        </Link>
        {showLogout && <LogoutButton />}
      </div>
    </nav>
  );
}
