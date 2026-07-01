import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

function formatTimestamp(iso) {
  if (!iso) return "Never logged in";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function AdminPanel() {
  const { session } = useAuth();
  const token = session?.token;

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);

  // Reset-password modal state
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);

  async function loadUsers() {
    setLoading(true);
    try {
      const data = await api.getUsers(token);
      setUsers(data);
      setError(null);
    } catch (err) {
      setError("Could not load accounts. Make sure you're logged in as admin and the backend is running.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleToggleActive(user) {
    setActionMsg(null);
    try {
      await api.setActive(token, user.username, !user.active);
      setActionMsg(`${user.username} is now ${!user.active ? "active" : "disabled"}.`);
      loadUsers();
    } catch (err) {
      setActionMsg(`Could not update ${user.username}: ${err.message}`);
    }
  }

  async function handleResetSubmit(e) {
    e.preventDefault();
    if (newPassword.length < 6) {
      setActionMsg("Password must be at least 6 characters.");
      return;
    }
    setResetSubmitting(true);
    try {
      await api.resetPassword(token, resetTarget.username, newPassword);
      setActionMsg(`Password reset for ${resetTarget.username}.`);
      setResetTarget(null);
      setNewPassword("");
    } catch (err) {
      setActionMsg(`Could not reset password: ${err.message}`);
    } finally {
      setResetSubmitting(false);
    }
  }

  if (loading) return <div className="admin-loading">Loading accounts…</div>;
  if (error) return <div className="admin-error">{error}</div>;

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div>
          <h1>Account Management</h1>
          <p className="admin-sub">Head office controls for all pharmacy + admin logins</p>
        </div>
      </div>

      {actionMsg && <div className="admin-toast">{actionMsg}</div>}

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Branch</th>
              <th>Status</th>
              <th>Created</th>
              <th>Last Login</th>
              <th>Last Login IP</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username} className={!u.active ? "row-disabled" : ""}>
                <td className="cell-username">{u.username}</td>
                <td>
                  <span className={`role-pill ${u.role === "admin" ? "role-admin" : "role-pharmacy"}`}>
                    {u.role}
                  </span>
                </td>
                <td>{u.pharmacy_name}</td>
                <td>
                  <span className={`status-pill ${u.active ? "status-active" : "status-disabled"}`}>
                    {u.active ? "Active" : "Disabled"}
                  </span>
                </td>
                <td className="cell-muted">{formatTimestamp(u.created_at)}</td>
                <td className="cell-muted">{formatTimestamp(u.last_login_at)}</td>
                <td className="cell-muted">{u.last_login_ip || "—"}</td>
                <td className="cell-actions">
                  <button className="btn-small" onClick={() => { setResetTarget(u); setNewPassword(""); }}>
                    Reset password
                  </button>
                  {u.username !== "admin" && (
                    <button
                      className={`btn-small ${u.active ? "btn-danger" : "btn-success"}`}
                      onClick={() => handleToggleActive(u)}
                    >
                      {u.active ? "Disable" : "Enable"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resetTarget && (
        <div className="modal-overlay" onClick={() => setResetTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Reset password for {resetTarget.username}</h3>
            <p className="modal-sub">{resetTarget.pharmacy_name}</p>
            <form onSubmit={handleResetSubmit}>
              <input
                type="text"
                placeholder="New password (min 6 characters)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoFocus
              />
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setResetTarget(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-confirm" disabled={resetSubmitting}>
                  {resetSubmitting ? "Saving..." : "Reset Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .admin-page { max-width: 1300px; margin: 0 auto; padding: 40px 32px 80px; }
        .admin-loading, .admin-error { padding: 80px; text-align: center; color: var(--color-text-muted); }
        .admin-error { color: var(--color-danger); }
        .admin-header h1 { font-size: 1.9rem; color: var(--color-primary); }
        .admin-sub { color: var(--color-text-muted); margin-top: 6px; }

        .admin-toast {
          margin-top: 18px;
          background: #EDF6F1;
          color: var(--color-primary);
          border: 1px solid #CFE6DA;
          padding: 12px 18px;
          border-radius: var(--radius-md);
          font-size: 0.88rem;
        }

        .table-card {
          margin-top: 24px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: 8px;
          overflow-x: auto;
        }
        table { width: 100%; border-collapse: collapse; font-size: 0.85rem; min-width: 900px; }
        th {
          text-align: left;
          padding: 12px 14px;
          color: var(--color-text-muted);
          font-weight: 600;
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          border-bottom: 1px solid var(--color-border);
        }
        td { padding: 12px 14px; border-bottom: 1px solid var(--color-border); }
        tr:last-child td { border-bottom: none; }
        .row-disabled { opacity: 0.55; }
        .cell-username { font-weight: 700; font-family: var(--font-display); }
        .cell-muted { color: var(--color-text-muted); font-size: 0.8rem; }
        .role-pill, .status-pill {
          font-size: 0.7rem;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 20px;
          text-transform: uppercase;
        }
        .role-admin { background: var(--color-primary); color: white; }
        .role-pharmacy { background: var(--color-accent-soft); color: #966319; }
        .status-active { background: #E3F2EC; color: var(--color-success); }
        .status-disabled { background: #FBEAE8; color: var(--color-danger); }
        .cell-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .btn-small {
          background: transparent;
          border: 1.5px solid var(--color-border);
          padding: 6px 12px;
          border-radius: var(--radius-sm);
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--color-text-muted);
          white-space: nowrap;
        }
        .btn-small:hover { border-color: var(--color-primary-light); color: var(--color-primary); }
        .btn-danger:hover { border-color: var(--color-danger); color: var(--color-danger); }
        .btn-success:hover { border-color: var(--color-success); color: var(--color-success); }

        .modal-overlay {
          position: fixed; inset: 0; background: rgba(28,40,38,0.45);
          display: flex; align-items: center; justify-content: center;
          z-index: 100; padding: 20px;
        }
        .modal-card {
          background: var(--color-surface);
          border-radius: var(--radius-lg);
          padding: 28px;
          max-width: 380px;
          width: 100%;
        }
        .modal-card h3 { font-size: 1.05rem; font-family: var(--font-body); }
        .modal-sub { color: var(--color-text-muted); font-size: 0.85rem; margin-top: 4px; }
        .modal-card form { margin-top: 18px; display: flex; flex-direction: column; gap: 14px; }
        .modal-card input {
          padding: 12px 14px;
          border: 1.5px solid var(--color-border);
          border-radius: var(--radius-md);
          font-size: 0.95rem;
        }
        .modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
        .btn-cancel {
          background: transparent; border: 1.5px solid var(--color-border);
          padding: 10px 16px; border-radius: var(--radius-md);
          font-weight: 600; font-size: 0.85rem; color: var(--color-text-muted);
        }
        .btn-confirm {
          background: var(--color-primary); color: white; border: none;
          padding: 10px 16px; border-radius: var(--radius-md);
          font-weight: 700; font-size: 0.85rem;
        }
        .btn-confirm:hover { background: var(--color-primary-light); }
        .btn-confirm:disabled { opacity: 0.6; }
      `}</style>
    </div>
  );
}
