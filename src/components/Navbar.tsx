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
        {showLogout && <LogoutButton />}
      </div>
    </nav>
  );
}
