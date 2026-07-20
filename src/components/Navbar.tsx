import Link from "next/link";
import KokpitLogo from "./KokpitLogo";
import LogoutButton from "./LogoutButton";

interface NavbarProps {
  showLogout: boolean;
}

export default function Navbar({ showLogout }: NavbarProps) {
  return (
    <nav className="navbar">
      <Link href="/" className="navbar-brand">
        <KokpitLogo />
      </Link>
      <div className="navbar-actions">
        <Link href="/settings" className="settings-link" aria-label="Settings">
          ⚙
        </Link>
        {showLogout && <LogoutButton />}
      </div>
    </nav>
  );
}
