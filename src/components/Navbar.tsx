import LogoutButton from "./LogoutButton";

interface NavbarProps {
  showLogout: boolean;
}

export default async function Navbar({ showLogout }: NavbarProps) {
  return (
    <nav className="navbar">
      <a href="/" className="navbar-brand">kokpit</a>
      <div className="navbar-actions">
        {showLogout && <LogoutButton />}
      </div>
    </nav>
  );
}
