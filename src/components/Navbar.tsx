import Link from "next/link";
import LogoutButton from "./LogoutButton";
import EditToggleButton from "./edit/EditToggleButton";

interface NavbarProps {
  showLogout: boolean;
  /** Whether the viewer may edit — gates the dashboard edit toggle. */
  canEdit?: boolean;
}

export default function Navbar({ showLogout, canEdit = false }: NavbarProps) {
  return (
    <nav className="navbar">
      <Link href="/" className="navbar-brand">kokpit</Link>
      <div className="navbar-actions">
        {canEdit && <EditToggleButton />}
        <Link href="/settings" className="settings-link" aria-label="Settings">
          ⚙
        </Link>
        {showLogout && <LogoutButton />}
      </div>
    </nav>
  );
}
