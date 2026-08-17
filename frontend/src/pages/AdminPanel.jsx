import { useEffect, useState } from "react";
import { api, BASE_URL } from "../api/client";
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

  // Bulk upload modal states
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [bulkError, setBulkError] = useState(null);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  // Create Admin modal state
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [newAdminUser, setNewAdminUser] = useState("");
  const [newAdminPass, setNewAdminPass] = useState("");
  const [adminCreating, setAdminCreating] = useState(false);


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

  async function handleDeleteUser(user) {
    setActionMsg(null);
    if (!window.confirm(`Are you sure you want to delete user ${user.username}?`)) {
      return;
    }
    try {
      await api.deleteUser(token, user.username);
      setActionMsg(`User ${user.username} has been deleted.`);
      loadUsers();
    } catch (err) {
      setActionMsg(`Could not delete ${user.username}: ${err.message}`);
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

  async function handleCreateAdmin(e) {
    e.preventDefault();
    if (newAdminUser.trim().length < 3) return setActionMsg("Username must be at least 3 characters.");
    if (newAdminPass.length < 6) return setActionMsg("Password must be at least 6 characters.");
    setAdminCreating(true);
    try {
      const response = await fetch(`${BASE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          username: newAdminUser.trim(),
          password: newAdminPass,
          role: "admin",
          pharmacy_id: null,
          pharmacy_name: "Head Office",
          area: null, address: null, contact_number: null,
          open_time: null, close_time: null, latitude: null, longitude: null
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Failed to create admin.");
      setActionMsg(`✅ Admin account '${newAdminUser.trim()}' created successfully.`);
      setShowAdminModal(false);
      setNewAdminUser("");
      setNewAdminPass("");
      loadUsers();
    } catch (err) {
      setActionMsg(`❌ ${err.message}`);
    } finally {
      setAdminCreating(false);
    }
  }

  function handleCSVParse(text) {

    try {
      setBulkError(null);
      const lines = text.split(/\r?\n/);
      if (lines.length === 0 || !lines[0].trim()) {
        throw new Error("File is empty.");
      }
      
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const requiredHeaders = ["username", "role", "pharmacy_name", "password"];
      const missing = requiredHeaders.filter(req => !headers.includes(req));
      if (missing.length > 0) {
        throw new Error(`Invalid CSV template. Missing columns: ${missing.join(", ")}`);
      }
      
      const parsed = [];
      const splitRegex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const rawCols = line.split(splitRegex);
        const cleanCols = rawCols.map(c => {
          let cleaned = c.trim();
          if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
            cleaned = cleaned.substring(1, cleaned.length - 1);
          }
          return cleaned;
        });

        const userObj = {};
        headers.forEach((h, idx) => {
          userObj[h] = cleanCols[idx] || "";
        });
        parsed.push(userObj);
      }
      
      if (parsed.length === 0) {
        throw new Error("No data rows found in the CSV.");
      }
      
      setPreviewData(parsed);
    } catch (err) {
      setBulkError(err.message || "Failed to parse CSV file.");
      setPreviewData(null);
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    readFile(file);
  }

  function readFile(file) {
    if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
      setBulkError("Please upload a valid CSV file.");
      setPreviewData(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      handleCSVParse(evt.target.result);
    };
    reader.onerror = () => {
      setBulkError("Could not read file.");
      setPreviewData(null);
    };
    reader.readAsText(file);
  }

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      readFile(file);
    }
  }

  function downloadCSVTemplate() {
    const headers = "username,role,pharmacy_id,pharmacy_name,password,area,address,contact_number,open_time,close_time,latitude,longitude\n";
    const sampleRow = "ph013,pharmacy,PH013,Andheri East Chemist,pharma123,Andheri,Shop 1 Main Rd,+919999999999,08:00,22:00,19.0760,72.8777\n";
    const blob = new Blob([headers + sampleRow], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.setAttribute("href", url);
    a.setAttribute("download", "pharmalink_users_template.csv");
    a.click();
    window.URL.revokeObjectURL(url);
  }

  async function handleBulkSubmit() {
    if (!previewData || previewData.length === 0) return;
    setBulkError(null);
    setBulkSubmitting(true);
    try {
      const response = await api.bulkUpload(token, previewData);
      setActionMsg(response.message || "Successfully imported accounts.");
      setShowBulkModal(false);
      setPreviewData(null);
      loadUsers();
    } catch (err) {
      setBulkError(err.message || "Bulk upload failed.");
    } finally {
      setBulkSubmitting(false);
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
        <div style={{display:"flex", gap:"10px"}}>
          <button
            type="button"
            className="btn-admin-create"
            onClick={() => { setShowAdminModal(true); setActionMsg(null); }}
          >
            👤 Add Admin Account
          </button>
          <button
            type="button"
            className="btn-confirm"
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
            onClick={() => { setShowBulkModal(true); setPreviewData(null); setBulkError(null); }}
          >
            📂 Bulk Upload Accounts
          </button>
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
                      className="btn-small btn-danger"
                      onClick={() => handleDeleteUser(u)}
                    >
                      Delete
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

      {showAdminModal && (
        <div className="modal-overlay" onClick={() => setShowAdminModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <h3>👤 Create Admin Account</h3>
              <button className="btn-close-x" onClick={() => setShowAdminModal(false)}>&times;</button>
            </div>
            <p className="modal-sub">This account will have full Head Office access and can see all branch data.</p>
            <form onSubmit={handleCreateAdmin} style={{display:"flex", flexDirection:"column", gap:"12px", marginTop:"16px"}}>
              <div>
                <label style={{fontSize:"0.8rem", fontWeight:600, display:"block", marginBottom:"4px"}}>Username</label>
                <input
                  type="text"
                  placeholder="e.g. admin2"
                  value={newAdminUser}
                  onChange={(e) => setNewAdminUser(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label style={{fontSize:"0.8rem", fontWeight:600, display:"block", marginBottom:"4px"}}>Password <span style={{color:"var(--color-text-muted)", fontWeight:400}}>(min. 6 characters)</span></label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={newAdminPass}
                  onChange={(e) => setNewAdminPass(e.target.value)}
                />
              </div>
              <div className="modal-actions" style={{marginTop:"4px"}}>
                <button type="button" className="btn-cancel" onClick={() => setShowAdminModal(false)}>Cancel</button>
                <button type="submit" className="btn-confirm" disabled={adminCreating}>
                  {adminCreating ? "Creating…" : "Create Admin Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBulkModal && (
        <div className="modal-overlay" onClick={() => { if (!bulkSubmitting) setShowBulkModal(false); }}>
          <div className="modal-card bulk-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <h3>Bulk Upload Accounts</h3>
              <button className="btn-close-x" onClick={() => setShowBulkModal(false)}>&times;</button>
            </div>
            
            <p className="modal-sub">
              Upload multiple pharmacy branch or admin accounts using a CSV file.
            </p>

            {bulkError && <div className="alert-error" style={{ marginTop: "12px", marginBottom: "12px", background: "#FBEAE8", color: "var(--color-danger)", padding: "10px 14px", borderRadius: "var(--radius-md)", fontSize: "0.85rem" }}>⚠️ {bulkError}</div>}

            {!previewData ? (
              <div className="upload-modal-content" style={{ marginTop: "18px" }}>
                <button type="button" className="btn-template-download" onClick={downloadCSVTemplate}>
                  📥 Download CSV Template
                </button>
                
                <div
                  className={`dropzone ${isDragging ? "dragging" : ""}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <span className="dropzone-icon">📋</span>
                  <p className="dropzone-text">Drag and drop your template CSV here</p>
                  <span className="dropzone-or">or</span>
                  <label htmlFor="csv-file-input" className="btn-file-select">
                    Choose File
                  </label>
                  <input
                    type="file"
                    id="csv-file-input"
                    accept=".csv"
                    onChange={handleFileChange}
                    hidden
                  />
                </div>
              </div>
            ) : (
              <div className="preview-modal-content" style={{ marginTop: "18px" }}>
                <div className="preview-table-header">
                  <h4>Previewing {previewData.length} Account{previewData.length !== 1 ? "s" : ""}</h4>
                  <button className="btn-link" onClick={() => setPreviewData(null)} style={{ fontSize: "0.8rem", color: "var(--color-primary)", background: "none", border: "none", textDecoration: "underline", padding: "0", cursor: "pointer" }}>
                    Choose a different file
                  </button>
                </div>
                
                <div className="preview-table-wrap">
                  <table className="preview-table">
                    <thead>
                      <tr>
                        <th>Username</th>
                        <th>Role</th>
                        <th>Pharmacy ID</th>
                        <th>Pharmacy Name</th>
                        <th>Area</th>
                        <th>Password</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.map((row, idx) => (
                        <tr key={idx}>
                          <td><strong>{row.username}</strong></td>
                          <td>
                            <span className={`role-pill ${row.role === 'admin' ? 'role-admin' : 'role-pharmacy'}`}>
                              {row.role}
                            </span>
                          </td>
                          <td>{row.pharmacy_id || "—"}</td>
                          <td>{row.pharmacy_name || "Head Office"}</td>
                          <td>{row.area || "—"}</td>
                          <td><code>{row.password}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="modal-actions" style={{ marginTop: "20px" }}>
                  <button
                    type="button"
                    className="btn-cancel"
                    disabled={bulkSubmitting}
                    onClick={() => { setPreviewData(null); setShowBulkModal(false); }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-confirm"
                    disabled={bulkSubmitting}
                    onClick={handleBulkSubmit}
                  >
                    {bulkSubmitting ? "Importing..." : "Confirm & Import"}
                  </button>
                </div>
              </div>
            )}
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

        .bulk-modal-card {
          max-width: 720px;
          width: 100%;
        }
        .modal-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .btn-close-x {
          background: none;
          border: none;
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--color-text-muted);
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }
        .btn-close-x:hover {
          color: var(--color-danger);
        }
        .btn-template-download {
          background: var(--color-accent-soft);
          color: #966319;
          border: 1.5px solid #F0D9AE;
          padding: 8px 14px;
          border-radius: var(--radius-md);
          font-weight: 700;
          font-size: 0.82rem;
          margin-bottom: 16px;
          display: inline-block;
        }
        .btn-template-download:hover {
          background: var(--color-accent);
          color: #3A2700;
          border-color: var(--color-accent);
        }
        .dropzone {
          border: 2px dashed var(--color-border);
          border-radius: var(--radius-lg);
          padding: 32px;
          display: flex;
          flex-direction: column;
          align-items: center;
          background: var(--color-bg);
          transition: all 0.15s ease-in-out;
        }
        .dropzone.dragging {
          border-color: var(--color-primary-light);
          background: #E8F4F1;
        }
        .dropzone-icon {
          font-size: 2.2rem;
          margin-bottom: 8px;
        }
        .dropzone-text {
          font-size: 0.92rem;
          font-weight: 500;
          color: var(--color-text-muted);
          margin-bottom: 4px;
        }
        .dropzone-or {
          font-size: 0.78rem;
          color: var(--color-text-muted);
          text-transform: uppercase;
          margin: 8px 0;
          letter-spacing: 0.05em;
        }
        .btn-file-select {
          background: var(--color-surface);
          border: 1.5px solid var(--color-border);
          padding: 8px 18px;
          border-radius: var(--radius-md);
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--color-text);
          cursor: pointer;
          transition: border-color 0.15s;
        }
        .btn-file-select:hover {
          border-color: var(--color-primary-light);
          color: var(--color-primary);
        }
        .preview-table-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .preview-table-header h4 {
          font-size: 0.95rem;
          font-family: var(--font-body);
          color: var(--color-text);
        }
        .preview-table-wrap {
          max-height: 280px;
          overflow-y: auto;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
        }
        .preview-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8rem;
        }
        .preview-table th {
          background: var(--color-bg);
          padding: 8px 12px;
          font-size: 0.7rem;
          color: var(--color-text-muted);
          text-transform: uppercase;
          border-bottom: 1px solid var(--color-border);
          position: sticky;
          top: 0;
          z-index: 5;
        }
        .preview-table td {
          padding: 8px 12px;
          border-bottom: 1px solid var(--color-border);
        }
        .preview-table tr:last-child td {
          border-bottom: none;
        }
        .preview-table code {
          background: rgba(0,0,0,0.04);
          padding: 2px 4px;
          border-radius: 4px;
          font-family: monospace;
        }
        .btn-admin-create {
          background: #EEF3FF;
          border: 1.5px solid #BFCFFE;
          color: var(--color-primary);
          padding: 10px 18px;
          border-radius: var(--radius-md);
          font-size: 0.88rem;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: background 0.15s;
          white-space: nowrap;
        }
        .btn-admin-create:hover { background: #D9E5FF; }
      `}</style>
    </div>
  );
}
