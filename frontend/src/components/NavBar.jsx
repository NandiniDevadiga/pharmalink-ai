import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function NavBar() {
  const { session, logout } = useAuth();

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <span className="brand-mark" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C8 6 5 10.5 5 14a7 7 0 0014 0c0-3.5-3-8-7-12z" fill="var(--color-accent)"/>
            <circle cx="12" cy="14.5" r="2.4" fill="var(--color-primary)"/>
          </svg>
        </span>
        <span className="brand-name">Pharmalink<span className="brand-ai">AI</span></span>
      </div>
      <div className="navbar-links">
        <NavLink to="/" className="nav-link" end>Med Locator</NavLink>
        <NavLink to="/aidoc" className="nav-link">AI Doc</NavLink>
        <span className="nav-divider" aria-hidden="true" />
        {session?.role === "admin" && (
          <NavLink to="/admin/medicines" className="nav-link admin-nav">Medicine Catalog</NavLink>
        )}
        
        {session?.role === "pharmacy" && (
          <>
            <NavLink to="/pos" className="nav-link pos-link">Point of Sale</NavLink>
            <NavLink to="/inventory" className="nav-link">Inventory</NavLink>
            <NavLink to="/profile" className="nav-link">Profile</NavLink>
          </>
        )}

        <NavLink to="/dashboard" className="nav-link staff-link">
          {session ? (session.role === "admin" ? "Admin Dashboard" : "Analytics") : "Pharmacy Staff Login"}
        </NavLink>
        
        {session && (
          <button onClick={logout} className="nav-link logout-btn">Log out</button>
        )}
      </div>

      <style>{`
        .navbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 40px;
          background: var(--color-surface);
          border-bottom: 1px solid var(--color-border);
          position: sticky;
          top: 0;
          z-index: 50;
        }
        .navbar-brand {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .brand-mark {
          display: flex;
        }
        .brand-name {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 1.25rem;
          color: var(--color-primary);
        }
        .brand-ai {
          color: var(--color-accent);
        }
        .navbar-links {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .nav-divider {
          width: 1px;
          height: 20px;
          background: var(--color-border);
          margin: 0 6px;
        }
        .nav-link {
          padding: 8px 16px;
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: 0.92rem;
          color: var(--color-text-muted);
          transition: background 0.15s, color 0.15s;
          text-decoration: none;
        }
        .nav-link:hover {
          background: var(--color-accent-soft);
          color: var(--color-primary);
        }
        .nav-link.active {
          background: var(--color-primary);
          color: white;
        }
        .admin-nav {
          color: var(--color-accent);
          background: var(--color-accent-soft);
        }
        .admin-nav.active {
          background: var(--color-accent);
          color: white;
        }
        .pos-link {
          color: var(--color-success);
          background: #E3F2EC;
        }
        .pos-link.active {
          background: var(--color-success);
          color: white;
        }
        .staff-link {
          font-size: 0.82rem;
          color: var(--color-text-muted);
          opacity: 0.85;
        }
        .staff-link:hover { opacity: 1; }
        .logout-btn {
          background: transparent;
          border: 1px solid #F5C6C1;
          color: var(--color-danger);
          cursor: pointer;
          font-family: var(--font-body);
        }
        .logout-btn:hover {
          background: #FBEAE8;
          color: var(--color-danger);
        }
        @media (max-width: 720px) {
          .navbar { padding: 14px 18px; flex-wrap: wrap; gap: 10px; }
          .navbar-links { gap: 4px; }
          .nav-link { padding: 6px 10px; font-size: 0.82rem; }
        }
      `}</style>
    </nav>
  );
}

