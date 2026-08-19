import { useEffect, useState, useMemo } from "react";
import { api, BASE_URL } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend
} from "recharts";

/* ─── helpers ─── */
function fmt(n) {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(1)}L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
function fmtUnits(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}
function formatTimestamp(iso) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

/* ─── KPI Card ─── */
function KpiCard({ label, value, sub, color, icon }) {
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <span className="kpi-icon">{icon}</span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value" style={{ color }}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

/* ─── Branch Table ─── */
function BranchTable({ title, branches, accent }) {
  return (
    <div className="branch-table-card">
      <h3 className="branch-table-title" style={{ color: accent }}>{title}</h3>
      <table className="branch-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Pharmacy</th>
            <th>Area</th>
            <th>Region</th>
            <th>Yearly Rev.</th>
            <th>Aug Rev.</th>
            <th>Aug Units</th>
            <th>MoM Growth</th>
            <th>Stockout Alerts</th>
            <th>Contact</th>
          </tr>
        </thead>
        <tbody>
          {branches.map((b, i) => (
            <tr key={b.pharmacy_id}>
              <td className="rank-cell">#{i + 1}</td>
              <td><strong>{b.pharmacy_name}</strong></td>
              <td className="muted-cell">{b.area}</td>
              <td>
                <span className={`region-pill ${b.region === "Dubai" ? "dubai" : "mumbai"}`}>
                  {b.region}
                </span>
              </td>
              <td className="mono-cell">{fmt(b.yearly_rev)}</td>
              <td className="mono-cell">{fmt(b.aug_rev)}</td>
              <td className="mono-cell">{fmtUnits(b.aug_units)}</td>
              <td>
                <span className={`growth-badge ${b.growth_pct >= 0 ? "pos" : "neg"}`}>
                  {b.growth_pct >= 0 ? "↑" : "↓"} {Math.abs(b.growth_pct)}%
                </span>
              </td>
              <td>
                {b.stockout_alerts > 0
                  ? <span className="alert-dot">{b.stockout_alerts}</span>
                  : <span className="ok-dot">✓</span>}
              </td>
              <td className="muted-cell">{b.contact}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
export default function AdminPanel() {
  const { session, logout } = useAuth();
  const token = session?.token;

  const [activeTab, setActiveTab] = useState("analytics");
  const [region, setRegion] = useState("all");   // "all" | "Mumbai" | "Dubai"
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(null);

  // accounts tab
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [newAdminUser, setNewAdminUser] = useState("");
  const [newAdminPass, setNewAdminPass] = useState("");

  /* ── load stats ── */
  async function loadStats() {
    setStatsLoading(true);
    try {
      const data = await api.getAdminDashboardStats(token);
      setStats(data);
    } catch (e) {
      if (e.message === "__UNAUTHORIZED__") logout();
      else setStatsError("Could not load dashboard. Is the backend running?");
    } finally {
      setStatsLoading(false);
    }
  }

  async function loadUsers() {
    setUsersLoading(true);
    try { setUsers(await api.getUsers(token)); } catch {}
    setUsersLoading(false);
  }

  useEffect(() => { loadStats(); }, [token]);
  useEffect(() => { if (activeTab === "accounts") loadUsers(); }, [activeTab]);

  /* ── filtered branches by region ── */
  const filterBranches = (list) =>
    region === "all" ? list : list.filter(b => b.region === region);

  /* ── filtered KPIs ── */
  const kpis = useMemo(() => {
    if (!stats) return null;
    if (region === "all") return stats.kpis;
    const scale = region === "Mumbai" ? 0.55 : 0.45;
    const k = stats.kpis;
    return {
      yearly_revenue:      Math.round(k.yearly_revenue * scale),
      monthly_revenue_aug: Math.round(k.monthly_revenue_aug * scale),
      monthly_revenue_jul: Math.round(k.monthly_revenue_jul * scale),
      growth_pct:          k.growth_pct,   // growth % stays same
      total_units_yearly:  Math.round(k.total_units_yearly * scale)
    };
  }, [stats, region]);

  /* ── filtered trend chart ── */
  const trendData = useMemo(() => {
    if (!stats) return [];
    const scale = region === "Mumbai" ? 0.55 : region === "Dubai" ? 0.45 : 1;
    return stats.monthly_trend.map(m => ({
      month: m.month.slice(5),   // "2026-03" → "03"
      Revenue: Math.round(m.revenue * scale)
    }));
  }, [stats, region]);

  /* ── account helpers ── */
  async function handleDelete(u) {
    if (!window.confirm(`Delete ${u.username}?`)) return;
    try {
      await api.deleteUser(token, u.username);
      setActionMsg(`Deleted ${u.username}`);
      loadUsers();
    } catch (e) { setActionMsg(e.message); }
  }

  async function handleReset(e) {
    e.preventDefault();
    if (newPassword.length < 6) return;
    try {
      await api.resetPassword(token, resetTarget.username, newPassword);
      setActionMsg(`Password reset for ${resetTarget.username}`);
      setResetTarget(null);
    } catch (e) { setActionMsg(e.message); }
  }

  async function handleCreateAdmin(e) {
    e.preventDefault();
    try {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          username: newAdminUser.trim(), password: newAdminPass, role: "admin",
          pharmacy_id: null, pharmacy_name: "Head Office",
          area: null, address: null, contact_number: null,
          open_time: null, close_time: null, latitude: null, longitude: null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);
      setActionMsg(`Admin '${newAdminUser}' created`);
      setShowAdminModal(false); setNewAdminUser(""); setNewAdminPass("");
      loadUsers();
    } catch (e) { setActionMsg(e.message); }
  }

  /* ══════════════ RENDER ══════════════ */
  return (
    <div className="ap-page">
      {/* Header */}
      <div className="ap-header">
        <div>
          <h1 className="ap-title">Head Office Dashboard</h1>
          <p className="ap-sub">PharmaLink AI — Network Analytics & Branch Management</p>
        </div>
        <div className="ap-header-right">
          {/* Region dropdown */}
          <div className="region-wrap">
            <label htmlFor="region-sel">View</label>
            <select id="region-sel" value={region} onChange={e => setRegion(e.target.value)}>
              <option value="all">Total Network</option>
              <option value="Mumbai">Mumbai</option>
              <option value="Dubai">Dubai</option>
            </select>
          </div>
          {/* Tab buttons */}
          <button
            className={`ap-tab ${activeTab === "analytics" ? "active" : ""}`}
            onClick={() => setActiveTab("analytics")}
          >📊 Analytics</button>
          <button
            className={`ap-tab ${activeTab === "accounts" ? "active" : ""}`}
            onClick={() => setActiveTab("accounts")}
          >⚙️ Accounts</button>
        </div>
      </div>

      {actionMsg && (
        <div className="ap-toast" onClick={() => setActionMsg(null)}>{actionMsg} ✕</div>
      )}

      {/* ══ ANALYTICS TAB ══ */}
      {activeTab === "analytics" && (
        <>
          {statsLoading ? (
            <div className="ap-loading">
              <div className="spinner" />
              <p>Loading dashboard data…</p>
            </div>
          ) : statsError ? (
            <div className="ap-error">{statsError}</div>
          ) : stats && kpis && (
            <>
              {/* KPI Row */}
              <div className="kpi-row">
                <KpiCard
                  icon="💰" label="Total Revenue (Yearly)"
                  value={fmt(kpis.yearly_revenue)}
                  sub="Full year 2026"
                  color="#0F4C45"
                />
                <KpiCard
                  icon="📅" label="Revenue This Month"
                  value={fmt(kpis.monthly_revenue_aug)}
                  sub="August 2026"
                  color="#3D8361"
                />
                <KpiCard
                  icon="📈" label="MoM Growth"
                  value={
                    <span style={{ color: kpis.growth_pct >= 0 ? "#2E7D4F" : "#C1473B" }}>
                      {kpis.growth_pct >= 0 ? "+" : ""}{kpis.growth_pct}%
                    </span>
                  }
                  sub="vs July 2026"
                />
                <KpiCard
                  icon="💊" label="Units Sold (Yearly)"
                  value={fmtUnits(kpis.total_units_yearly)}
                  sub="All medicines, all branches"
                  color="#966319"
                />
              </div>

              {/* Revenue Trend Chart */}
              <div className="chart-card">
                <h3>Monthly Revenue Trend — 2026
                  <span className="chart-region-badge">{region === "all" ? "All Regions" : region}</span>
                </h3>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={trendData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0F4C45" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#0F4C45" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E4DFD3" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={v => fmt(v)} />
                    <Legend />
                    <Area
                      type="monotone" dataKey="Revenue"
                      stroke="#0F4C45" strokeWidth={3}
                      fill="url(#revGrad)"
                      dot={{ r: 5, fill: "#0F4C45" }}
                      activeDot={{ r: 7 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Top 5 Branches */}
              <BranchTable
                title="🏆 Top 5 Performing Branches"
                branches={filterBranches(stats.top5_branches).slice(0, 5)}
                accent="#0F4C45"
              />

              {/* Bottom 5 Branches */}
              <BranchTable
                title="⚠️ Bottom 5 Performing Branches"
                branches={filterBranches(stats.bottom5_branches).slice(0, 5)}
                accent="#C1473B"
              />

              {/* Compliance banner */}
              <div className={`compliance-banner ${stats.discontinued_exposure.length > 0 ? "warn" : ""}`}>
                {stats.discontinued_exposure.length === 0
                  ? "🛡️ Compliance: Zero banned compound stock detected across all branches."
                  : `⚠️ Compliance Warning: ${stats.discontinued_exposure.length} banned compound exposures found — action required.`}
              </div>
            </>
          )}
        </>
      )}

      {/* ══ ACCOUNTS TAB ══ */}
      {activeTab === "accounts" && (
        <div className="accounts-tab">
          <div className="accounts-header">
            <h2>Branch & Admin Accounts</h2>
            <button className="btn-create" onClick={() => setShowAdminModal(true)}>
              + New Admin Account
            </button>
          </div>

          {usersLoading ? (
            <div className="ap-loading"><div className="spinner" /><p>Loading accounts…</p></div>
          ) : (
            <div className="accounts-table-wrap">
              <table className="accounts-table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Branch</th>
                    <th>Status</th>
                    <th>Last Login</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.username} className={!u.active ? "disabled-row" : ""}>
                      <td><strong>{u.username}</strong></td>
                      <td>
                        <span className={`role-pill ${u.role === "admin" ? "admin" : "pharmacy"}`}>
                          {u.role}
                        </span>
                      </td>
                      <td>{u.pharmacy_name || "—"}</td>
                      <td>
                        <span className={`status-pill ${u.active ? "active" : "inactive"}`}>
                          {u.active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="muted-cell">{formatTimestamp(u.last_login_at)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn-sm" onClick={() => { setResetTarget(u); setNewPassword(""); }}>
                            Reset PW
                          </button>
                          {u.username !== "admin" && (
                            <button className="btn-sm danger" onClick={() => handleDelete(u)}>Delete</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div className="modal-overlay" onClick={() => setResetTarget(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>Reset password — {resetTarget.username}</h3>
            <form onSubmit={handleReset}>
              <input
                type="text" placeholder="New password (min 6 chars)"
                value={newPassword} onChange={e => setNewPassword(e.target.value)} autoFocus
              />
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setResetTarget(null)}>Cancel</button>
                <button type="submit" className="btn-confirm">Reset</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Admin Modal */}
      {showAdminModal && (
        <div className="modal-overlay" onClick={() => setShowAdminModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>Create Admin Account</h3>
            <form onSubmit={handleCreateAdmin}>
              <input type="text" placeholder="Username" value={newAdminUser} onChange={e => setNewAdminUser(e.target.value)} autoFocus />
              <input type="password" placeholder="Password (min 6 chars)" value={newAdminPass} onChange={e => setNewAdminPass(e.target.value)} />
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowAdminModal(false)}>Cancel</button>
                <button type="submit" className="btn-confirm">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        :root {
          --primary: #0F4C45;
          --primary-light: #1A6B5F;
          --accent: #E8A33D;
          --danger: #C1473B;
          --success: #2E7D4F;
          --bg: #F5F2EC;
          --surface: #FFFFFF;
          --border: #DDD8CF;
          --text: #1A1A1A;
          --muted: #6B7280;
        }

        .ap-page {
          max-width: 1360px;
          margin: 0 auto;
          padding: 36px 32px 80px;
          font-family: 'Inter', sans-serif;
        }

        /* Header */
        .ap-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 32px;
          flex-wrap: wrap;
          gap: 16px;
        }
        .ap-title { font-size: 2rem; color: var(--primary); margin: 0; font-weight: 800; }
        .ap-sub { color: var(--muted); margin-top: 6px; font-size: 0.9rem; }
        .ap-header-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

        /* Region dropdown */
        .region-wrap { display: flex; align-items: center; gap: 8px; }
        .region-wrap label { font-size: 0.82rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
        .region-wrap select {
          padding: 9px 14px;
          border: 2px solid var(--border);
          border-radius: 10px;
          font-size: 0.9rem;
          font-weight: 700;
          background: var(--surface);
          color: var(--primary);
          cursor: pointer;
          outline: none;
          transition: border-color 0.15s;
        }
        .region-wrap select:focus { border-color: var(--primary); }

        /* Tabs */
        .ap-tab {
          padding: 10px 20px;
          border-radius: 10px;
          border: 2px solid var(--border);
          background: transparent;
          font-weight: 700;
          font-size: 0.88rem;
          color: var(--muted);
          cursor: pointer;
          transition: all 0.18s;
        }
        .ap-tab:hover { border-color: var(--primary); color: var(--primary); }
        .ap-tab.active { background: var(--primary); color: #fff; border-color: var(--primary); }

        /* Toast */
        .ap-toast {
          background: #E8F4F1; color: var(--primary);
          border: 1px solid #B5D9CF;
          padding: 12px 20px; border-radius: 10px;
          font-size: 0.88rem; margin-bottom: 20px; cursor: pointer;
        }

        /* Loading / Error */
        .ap-loading { display: flex; flex-direction: column; align-items: center; padding: 80px; gap: 16px; color: var(--muted); }
        .spinner {
          width: 40px; height: 40px;
          border: 4px solid #E0DDD7;
          border-top-color: var(--primary);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .ap-error { color: var(--danger); padding: 40px; text-align: center; }

        /* KPI Row */
        .kpi-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
          gap: 20px;
          margin-bottom: 28px;
        }
        .kpi-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 24px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .kpi-card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.07); }
        .kpi-top { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
        .kpi-icon { font-size: 1.3rem; }
        .kpi-label { font-size: 0.75rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .kpi-value { font-size: 2rem; font-weight: 800; color: var(--primary); line-height: 1.1; margin-bottom: 6px; }
        .kpi-sub { font-size: 0.78rem; color: var(--muted); }

        /* Chart */
        .chart-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 28px;
          margin-bottom: 28px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        }
        .chart-card h3 { font-size: 1.1rem; color: var(--primary); margin-bottom: 20px; display: flex; align-items: center; gap: 12px; }
        .chart-region-badge {
          background: #E8F4F1; color: var(--primary-light);
          font-size: 0.72rem; font-weight: 700;
          padding: 3px 10px; border-radius: 20px;
        }

        /* Branch tables */
        .branch-table-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          overflow: hidden;
          margin-bottom: 28px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        }
        .branch-table-title {
          font-size: 1.05rem;
          font-weight: 800;
          padding: 20px 24px 16px;
          margin: 0;
          border-bottom: 1px solid var(--border);
        }
        .branch-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.82rem;
        }
        .branch-table th {
          text-align: left;
          padding: 11px 16px;
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--muted);
          background: #FAFAF8;
          border-bottom: 1px solid var(--border);
        }
        .branch-table td {
          padding: 13px 16px;
          border-bottom: 1px solid #F0EDE7;
          vertical-align: middle;
        }
        .branch-table tr:last-child td { border-bottom: none; }
        .branch-table tr:hover td { background: #FAFAF8; }
        .rank-cell { font-weight: 800; color: var(--muted); font-size: 0.78rem; }
        .mono-cell { font-family: 'Courier New', monospace; font-weight: 600; }
        .muted-cell { color: var(--muted); }

        .region-pill {
          font-size: 0.68rem; font-weight: 700;
          padding: 3px 9px; border-radius: 20px;
          text-transform: uppercase; letter-spacing: 0.04em;
        }
        .region-pill.dubai { background: #E8F4F1; color: #0F4C45; }
        .region-pill.mumbai { background: #FFF3E0; color: #E65100; }

        .growth-badge {
          font-size: 0.72rem; font-weight: 700;
          padding: 3px 9px; border-radius: 20px;
        }
        .growth-badge.pos { background: #E3F2EC; color: var(--success); }
        .growth-badge.neg { background: #FBEAE8; color: var(--danger); }

        .alert-dot {
          background: #FBEAE8; color: var(--danger);
          font-size: 0.72rem; font-weight: 700;
          padding: 3px 9px; border-radius: 20px;
        }
        .ok-dot { color: var(--success); font-weight: 700; font-size: 0.9rem; }

        /* Compliance */
        .compliance-banner {
          background: #E8F4F1; color: #0F4C45;
          border: 1px solid #B5D9CF;
          padding: 14px 20px; border-radius: 12px;
          font-size: 0.88rem; font-weight: 600;
          margin-bottom: 28px;
        }
        .compliance-banner.warn { background: #FFF3CD; color: #856404; border-color: #FFEAA7; }

        /* Accounts tab */
        .accounts-tab { padding-top: 4px; }
        .accounts-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .accounts-header h2 { font-size: 1.3rem; color: var(--primary); }
        .btn-create {
          background: var(--primary); color: #fff;
          border: none; padding: 10px 20px;
          border-radius: 10px; font-weight: 700;
          font-size: 0.88rem; cursor: pointer;
          transition: background 0.15s;
        }
        .btn-create:hover { background: var(--primary-light); }

        .accounts-table-wrap { overflow-x: auto; }
        .accounts-table {
          width: 100%; border-collapse: collapse;
          font-size: 0.83rem;
          background: var(--surface);
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid var(--border);
        }
        .accounts-table th {
          text-align: left; padding: 12px 16px;
          font-size: 0.7rem; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.04em;
          color: var(--muted); background: #FAFAF8;
          border-bottom: 1px solid var(--border);
        }
        .accounts-table td { padding: 12px 16px; border-bottom: 1px solid #F0EDE7; }
        .accounts-table tr:last-child td { border-bottom: none; }
        .accounts-table tr.disabled-row { opacity: 0.5; }

        .role-pill, .status-pill {
          font-size: 0.68rem; font-weight: 700;
          padding: 3px 9px; border-radius: 20px;
          text-transform: uppercase;
        }
        .role-pill.admin { background: var(--primary); color: #fff; }
        .role-pill.pharmacy { background: #FFF3E0; color: #E65100; }
        .status-pill.active { background: #E3F2EC; color: var(--success); }
        .status-pill.inactive { background: #FBEAE8; color: var(--danger); }

        .btn-sm {
          background: transparent; border: 1.5px solid var(--border);
          padding: 5px 12px; border-radius: 8px;
          font-size: 0.75rem; font-weight: 600; color: var(--muted);
          cursor: pointer; transition: all 0.15s;
        }
        .btn-sm:hover { border-color: var(--primary); color: var(--primary); }
        .btn-sm.danger:hover { border-color: var(--danger); color: var(--danger); }

        /* Modals */
        .modal-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.4);
          display: flex; align-items: center; justify-content: center;
          z-index: 200;
        }
        .modal-box {
          background: var(--surface); border-radius: 16px;
          padding: 32px; width: 360px; max-width: 95vw;
          box-shadow: 0 20px 60px rgba(0,0,0,0.15);
        }
        .modal-box h3 { font-size: 1rem; color: var(--primary); margin-bottom: 20px; }
        .modal-box form { display: flex; flex-direction: column; gap: 12px; }
        .modal-box input {
          padding: 12px 14px; border: 1.5px solid var(--border);
          border-radius: 10px; font-size: 0.95rem; outline: none;
          transition: border-color 0.15s;
        }
        .modal-box input:focus { border-color: var(--primary); }
        .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px; }
        .btn-cancel {
          background: transparent; border: 1.5px solid var(--border);
          padding: 10px 18px; border-radius: 10px;
          font-weight: 700; font-size: 0.85rem; color: var(--muted); cursor: pointer;
        }
        .btn-confirm {
          background: var(--primary); color: #fff; border: none;
          padding: 10px 18px; border-radius: 10px;
          font-weight: 700; font-size: 0.85rem; cursor: pointer;
        }
        .btn-confirm:hover { background: var(--primary-light); }

        @media (max-width: 900px) {
          .branch-table { font-size: 0.74rem; }
          .branch-table th, .branch-table td { padding: 10px; }
          .kpi-row { grid-template-columns: 1fr 1fr; }
        }
      `}</style>
    </div>
  );
}
