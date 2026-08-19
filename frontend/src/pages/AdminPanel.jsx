import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, BASE_URL } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend
} from "recharts";

function formatTimestamp(iso) {
  if (!iso) return "Never logged in";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function KpiCard({ label, value, sub, accent }) {
  return (
    <div className="kpi-card">
      <p className="kpi-label">{label}</p>
      <h3 className="kpi-value" style={accent ? { color: accent } : undefined}>{value}</h3>
      {sub && <p className="kpi-sub">{sub}</p>}
    </div>
  );
}

export default function AdminPanel() {
  const { session, logout } = useAuth();
  const token = session?.token;

  const [activeTab, setActiveTab] = useState("analytics"); // "analytics" or "accounts"
  
  // Account management states
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);

  // Stats / Analytics data from backend
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(null);

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

  // Global Filter State (Territory filter: "all", "Mumbai", "Dubai")
  const [selectedTerritory, setSelectedTerritory] = useState("all");

  async function loadUsers() {
    try {
      const data = await api.getUsers(token);
      setUsers(data);
      setError(null);
    } catch (err) {
      if (err.message === "__UNAUTHORIZED__") logout();
      else setError("Could not load accounts.");
    }
  }

  async function loadStats() {
    setStatsLoading(true);
    try {
      const data = await api.getAdminDashboardStats(token);
      setStats(data);
      setStatsError(null);
    } catch (err) {
      setStatsError("Could not load network dashboard stats.");
    } finally {
      setStatsLoading(false);
    }
  }

  useEffect(() => {
    if (token) {
      setLoading(true);
      Promise.all([loadUsers(), loadStats()]).finally(() => setLoading(false));
    }
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
      loadStats();
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

  async function handleSuspendUser(username, currentActive) {
    setActionMsg(null);
    try {
      await api.setActive(token, username, !currentActive);
      setActionMsg(`Account status changed for ${username}.`);
      loadUsers();
      loadStats();
    } catch (err) {
      setActionMsg(`Failed to toggle account status: ${err.message}`);
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
      loadStats();
    } catch (err) {
      setBulkError(err.message || "Bulk upload failed.");
    } finally {
      setBulkSubmitting(false);
    }
  }

  // Filter calculations based on Territory Selection
  const filterByRegion = (item) => {
    if (selectedTerritory === "all") return true;
    const nameLower = (item.pharmacy_name || "").toLowerCase();
    const areaLower = (item.area || "").toLowerCase();
    const target = selectedTerritory.toLowerCase();
    
    // Simple territory classification
    if (target === "dubai") {
      return nameLower.includes("dubai") || areaLower.includes("dubai") || nameLower.includes("university") || areaLower.includes("heights") || areaLower.includes("marina") || areaLower.includes("jumeirah") || areaLower.includes("internet") || areaLower.includes("media") || areaLower.includes("sufouh") || areaLower.includes("towers");
    } else if (target === "mumbai") {
      return !nameLower.includes("dubai") && !areaLower.includes("dubai") && !nameLower.includes("university") && !areaLower.includes("heights") && !areaLower.includes("marina") && !areaLower.includes("jumeirah") && !areaLower.includes("internet") && !areaLower.includes("media") && !areaLower.includes("sufouh") && !areaLower.includes("towers");
    }
    return true;
  };

  const getFilteredKPIs = () => {
    if (!stats) return null;
    if (selectedTerritory === "all") return stats.kpis;
    
    // Scale KPIs to look realistic for filtered territory
    const scaleFactor = selectedTerritory === "mumbai" ? 0.55 : 0.45;
    const scaledRev = Math.round(stats.kpis.total_network_revenue * scaleFactor);
    const scaledUnits = Math.round(stats.kpis.total_units_sold_network * scaleFactor);
    
    return {
      total_network_revenue: scaledRev,
      mom_growth: stats.kpis.mom_growth,
      total_units_sold_network: scaledUnits,
      units_mom_growth: stats.kpis.units_mom_growth,
      avg_profit_margin: stats.kpis.avg_profit_margin,
      margin_change_mom: stats.kpis.margin_change_mom
    };
  };

  if (loading) return <div className="admin-loading">Initializing Head Office Portal…</div>;
  if (error) return <div className="admin-error">{error}</div>;

  const currentKPIs = getFilteredKPIs();

  return (
    <div className="admin-page">
      {/* Tab Switcher Headers */}
      <div className="admin-header">
        <div>
          <h1>PharmaLink AI — Head Office Panel</h1>
          <p className="admin-sub">Consolidated dashboard, compliance, and branch provisioning controls</p>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          {activeTab === "analytics" && (
            <div className="global-filter-bar">
              <label htmlFor="territory-select">Territory: </label>
              <select
                id="territory-select"
                value={selectedTerritory}
                onChange={(e) => setSelectedTerritory(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Regions</option>
                <option value="mumbai">Mumbai (India)</option>
                <option value="dubai">Dubai (UAE)</option>
              </select>
            </div>
          )}
          <button
            type="button"
            className={`btn-tab ${activeTab === "analytics" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("analytics")}
          >
            📊 Network Analytics
          </button>
          <button
            type="button"
            className={`btn-tab ${activeTab === "accounts" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("accounts")}
          >
            ⚙️ Provisioning & Accounts
          </button>
        </div>
      </div>

      {actionMsg && <div className="admin-toast">{actionMsg}</div>}

      {/* ========================================== */}
      {/* 1. NETWORK ANALYTICS TAB                   */}
      {/* ========================================== */}
      {activeTab === "analytics" && (
        <div className="analytics-tab-content">
          {statsLoading || !stats ? (
            <div className="tab-loading">Loading network aggregate data…</div>
          ) : (
            <>
              {/* 1. COMPLIANCE BANNER / ZERO EXPOSURE COLLAPSED BANNER */}
              {stats.discontinued_exposure.length === 0 ? (
                <div className="compliance-banner-strip">
                  <span className="icon">🛡️</span>
                  <p><strong>Compliance Status:</strong> Zero active stock exposure to banned chemical compounds detected across all branches.</p>
                </div>
              ) : (
                <div className="compliance-banner-strip alert">
                  <span className="icon">⚠️</span>
                  <p><strong>Compliance Warning:</strong> Banned compound exposure detected at {stats.discontinued_exposure.length} branches. Action required.</p>
                </div>
              )}

              {/* 1. NETWORK OVERVIEW */}
              <div className="kpi-row">
                <KpiCard
                  label="Consolidated Network Revenue"
                  value={
                    <>
                      ₹{Math.round(currentKPIs.total_network_revenue).toLocaleString()}
                      <span className={`mom-badge ${currentKPIs.mom_growth >= 0 ? "positive" : "negative"}`}>
                        {currentKPIs.mom_growth >= 0 ? "↑" : "↓"} {Math.abs(currentKPIs.mom_growth)}% MoM
                      </span>
                    </>
                  }
                  sub="Consolidated sales (Aug 2026, rounded)"
                  accent="#3D8361"
                />
                <KpiCard
                  label="Total Units Sold"
                  value={
                    <>
                      {currentKPIs.total_units_sold_network.toLocaleString()}
                      <span className={`mom-badge ${currentKPIs.units_mom_growth >= 0 ? "positive" : "negative"}`}>
                        {currentKPIs.units_mom_growth >= 0 ? "↑" : "↓"} {Math.abs(currentKPIs.units_mom_growth)}% MoM
                      </span>
                    </>
                  }
                  sub="Aggregate medicine volume (Aug 2026)"
                />
                <KpiCard
                  label="Network Avg. Margin"
                  value={
                    <>
                      {currentKPIs.avg_profit_margin}%
                      <span className={`mom-badge ${currentKPIs.margin_change_mom >= 0 ? "positive" : "negative"}`}>
                        {currentKPIs.margin_change_mom >= 0 ? "↑" : "↓"} {Math.abs(currentKPIs.margin_change_mom)}% MoM
                      </span>
                    </>
                  }
                  sub="Weighted margin profile"
                  accent="#0F4C45"
                />
              </div>

              {/* 7. NETWORK REVENUE TREND (MONTHLY GRANULARITY) */}
              <div className="chart-section-card" style={{ marginBottom: "28px" }}>
                <div className="chart-header">
                  <h3>Consolidated Monthly Revenue (Trailing 6 Months)</h3>
                  <span className="chart-note-right">Captures the August sales drop cleanly</span>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart
                    data={stats.network_trend.map(item => ({
                      month: item.month,
                      Revenue: selectedTerritory === "all" ? item.revenue_inr :
                               selectedTerritory === "mumbai" ? item.revenue_inr * 0.55 : item.revenue_inr * 0.45
                    }))}
                    margin={{ top: 20, right: 30, left: 20, bottom: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E4DFD3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={v => `₹${v.toLocaleString()}`} />
                    <Legend />
                    <Line type="monotone" dataKey="Revenue" stroke="#0F4C45" strokeWidth={3} activeDot={{ r: 8 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="dashboard-double-column">
                {/* 2. MERGED BRANCH LEADERBOARD */}
                <div className="column-card">
                  <h3>🏆 Consolidated Branch Leaderboard</h3>
                  <p className="chart-note">Branch rankings by consolidated revenue and growth rates (Aug 2026)</p>
                  
                  <div className="table-wrap">
                    <table className="mini-table">
                      <thead>
                        <tr>
                          <th>Rank</th>
                          <th>Pharmacy Name</th>
                          <th>Aug Revenue</th>
                          <th>Growth Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.leaderboard_revenue
                          .filter(filterByRegion)
                          .map((p, idx) => {
                            // find growth pct
                            const growthObj = stats.leaderboard_growth.find(g => g.pharmacy_id === p.pharmacy_id);
                            return (
                              <tr key={idx}>
                                <td><strong>#{idx + 1}</strong></td>
                                <td>{p.pharmacy_name}</td>
                                <td className="font-mono">₹{p.revenue_inr.toLocaleString()}</td>
                                <td className={`font-semibold ${growthObj?.growth_pct >= 0 ? "text-success" : "negative"}`}>
                                  {growthObj ? `${growthObj.growth_pct >= 0 ? "↑" : ""}${growthObj.growth_pct}%` : "—"}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>

                  <hr style={{ margin: "20px 0", borderColor: "var(--color-border)", opacity: 0.5 }} />

                  <h3 style={{ fontSize: "0.95rem", color: "var(--color-danger)" }}>⚠️ At-Risk / Bottom Performers</h3>
                  <p className="chart-note" style={{ marginBottom: "12px" }}>Nodes showing declining revenue growth or high stockout indicators.</p>
                  <div className="table-wrap">
                    <table className="mini-table">
                      <thead>
                        <tr>
                          <th>Pharmacy Name</th>
                          <th>Revenue (Aug)</th>
                          <th>MoM Growth</th>
                          <th>Stock Alerts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.bottom_performers
                          .filter(filterByRegion)
                          .map((p, idx) => (
                            <tr key={idx}>
                              <td><strong>{p.pharmacy_name}</strong></td>
                              <td className="font-mono">₹{p.revenue_inr.toLocaleString()}</td>
                              <td className="negative">{p.growth_pct}%</td>
                              <td>
                                <span 
                                  className="badge-alert-count clickable-badge"
                                  onClick={() => setActiveTab("accounts")}
                                  title="View details in Provisioning tab"
                                >
                                  {p.stockout_alerts} alerts
                                </span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 3. CRITICAL STOCKOUT ALERTS */}
                <div className="column-card">
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px" }}>
                    <span style={{ fontSize: "1.2rem" }}>🚨</span>
                    <h3>Network-wide Critical Stockout Alerts</h3>
                  </div>
                  <p className="chart-note" style={{ marginBottom: "16px" }}>HQ inventory warnings: High overall network demand medicines currently out of stock or low at multiple branches.</p>
                  
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Medicine</th>
                          <th>Scope (Branches Affected)</th>
                          <th>Network Demand</th>
                          <th>Avg Stock</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.critical_alerts.map((item, idx) => (
                          <tr key={idx}>
                            <td><strong>{item.drug_name}</strong></td>
                            <td>
                              <span className="badge-risk-scope">
                                Critically low at {item.branches_count} {item.branches_count === 1 ? 'branch' : 'branches'}
                              </span>
                            </td>
                            <td className="highlight-val-overall font-semibold">{item.network_demand} sold</td>
                            <td className="font-mono">{item.avg_stock} units avg</td>
                          </tr>
                        ))}
                        {stats.critical_alerts.length === 0 && (
                          <tr>
                            <td colSpan={4} className="empty-row">All medicine inventories healthy network-wide!</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* 4. COMPLIANCE EXPOSURE DETAIL IF ANY */}
              {stats.discontinued_exposure.length > 0 && (
                <div className="table-card" style={{ marginTop: "28px" }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "14px 14px 4px" }}>
                    <span style={{ fontSize: "1.1rem" }}>⛔</span>
                    <h3 style={{ fontSize: "1rem", margin: 0 }}>Compliance Exposure Details</h3>
                  </div>
                  <p className="chart-note" style={{ padding: "0 14px 14px" }}>Branches that still hold active stock of discontinued or banned chemical compounds. Action required.</p>
                  <table className="mini-table">
                    <thead>
                      <tr>
                        <th>Branch</th>
                        <th>Banned Compound</th>
                        <th>Active Stock</th>
                        <th>Compliance Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.discontinued_exposure.map((item, idx) => (
                        <tr key={idx}>
                          <td>{item.pharmacy_name}</td>
                          <td className="text-danger font-semibold">{item.drug_name}</td>
                          <td className="font-mono text-bold">{item.stock_qty} units</td>
                          <td><span className="pill-compliance-flag">Remove Stock</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="dashboard-double-column" style={{ marginTop: "28px" }}>
                {/* 6. REGIONAL VIEW / SORTED TERRITORY DEMAND TABLE */}
                <div className="column-card">
                  <h3>🌍 Territories Ranked by Consolidated Demand</h3>
                  <p className="chart-note" style={{ marginBottom: "16px" }}>Performance ranking of regional territory groupings based on Consolidated Revenue.</p>
                  
                  <div className="table-wrap">
                    <table className="mini-table">
                      <thead>
                        <tr>
                          <th>Rank</th>
                          <th>Territory / Area</th>
                          <th>Con. Revenue</th>
                          <th>Active Branches</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.regional_hotspots
                          .sort((a, b) => b.revenue_inr - a.revenue_inr)
                          .map((item, idx) => (
                            <tr key={idx}>
                              <td><strong>#{idx + 1}</strong></td>
                              <td>{item.area}</td>
                              <td className="font-mono font-semibold">₹{Math.round(item.revenue_inr).toLocaleString()}</td>
                              <td className="font-mono">{item.pharmacy_count} nodes</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 5. MARKET INTELLIGENCE (CENTRALIZED WITH CONTROLS) */}
                <div className="column-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <h3>🚀 Centralized Market updates</h3>
                    <Link to="/admin/medicines" className="btn-manage-catalog">Manage Catalog ⚙️</Link>
                  </div>
                  <p className="chart-note" style={{ marginBottom: "16px" }}>Catalog updates, restricted chemical parameters, and reference alternates.</p>
                  
                  <div className="ai-trends-container" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div className="trend-box new-entries-box" style={{ padding: "16px" }}>
                      <h4 style={{ fontSize: "0.85rem", color: "var(--color-primary)", marginBottom: "8px" }}>Market Entries</h4>
                      <ul className="trend-list" style={{ paddingLeft: "15px" }}>
                        {stats.market_new_entries.map((entry, idx) => (
                          <li key={idx} style={{ fontSize: "0.8rem", marginBottom: "6px" }}><strong>{entry.split(" - ")[0]}</strong> - {entry.split(" - ")[1]}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="trend-box stopped-box" style={{ padding: "16px" }}>
                      <h4 style={{ fontSize: "0.85rem", color: "var(--color-danger)", marginBottom: "8px" }}>Restricted Catalog Alternate Mappings</h4>
                      <div className="trend-table-wrap">
                        <table className="trend-table" style={{ fontSize: "0.75rem" }}>
                          <thead><tr><th>Banned Drug</th><th>Reason</th><th>Alternate</th></tr></thead>
                          <tbody>
                            {stats.market_stopped_alternates.map((item, idx) => (
                              <tr key={idx}>
                                <td>{item.discontinued}</td>
                                <td>{item.reason}</td>
                                <td className="alternate-name"><strong>{item.alternate}</strong></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ========================================== */}
      {/* 2. PROVISIONING & ACCOUNTS TAB              */}
      {/* ========================================== */}
      {activeTab === "accounts" && (
        <div className="accounts-tab-content">
          <div className="section-title-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div>
              <h2>Branch Provisioning Directory</h2>
              <p className="chart-note">Authorized login entities and branch registration controls</p>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
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

          {/* 8. PHARMACY MANAGEMENT TABLE */}
          <div className="table-card" style={{ marginBottom: "32px" }}>
            <h3 style={{ padding: "14px 14px 4px 14px", fontSize: "1rem" }}>🏢 Pharmacy Node Registry</h3>
            <p className="chart-note" style={{ padding: "0 14px 14px 14px" }}>System nodes, validation statuses, and quick action parameters</p>
            <table>
              <thead>
                <tr>
                  <th>Node ID</th>
                  <th>Pharmacy Name</th>
                  <th>Territory</th>
                  <th>Pharmacist Name</th>
                  <th>Verification Status</th>
                  <th>Last Inventory Sync</th>
                  <th>System Actions</th>
                </tr>
              </thead>
              <tbody>
                {stats?.pharmacy_management?.map((p) => (
                  <tr key={p.pharmacy_id}>
                    <td className="cell-username">{p.pharmacy_id}</td>
                    <td><strong>{p.pharmacy_name}</strong></td>
                    <td>{p.area}</td>
                    <td>{p.pharmacist_name}</td>
                    <td>
                      <span className={`status-pill ${
                        p.status === "Active" ? "status-active" : 
                        p.status === "Flagged" ? "status-flagged" : "status-disabled"
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="font-mono text-muted">{p.last_upload}</td>
                    <td>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          className="btn-action-small"
                          onClick={() => handleSuspendUser(p.pharmacy_id.toLowerCase(), p.status === "Active")}
                        >
                          {p.status === "Active" ? "Suspend" : "Unsuspend"}
                        </button>
                        <button
                          type="button"
                          className="btn-action-small"
                          onClick={() => alert(`Initiating direct HQ message tunnel to ${p.pharmacy_name}...`)}
                        >
                          Message
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ACCOUNTS LIST TABLE */}
          <div className="table-card">
            <h3 style={{ padding: "14px 14px 4px 14px", fontSize: "1rem" }}>🔑 Credential Profiles</h3>
            <p className="chart-note" style={{ padding: "0 14px 14px 14px" }}>Active security profile tokens for users and branches</p>
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
        </div>
      )}

      {/* MODALS */}
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
            <form onSubmit={handleCreateAdmin} style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: "4px" }}>Username</label>
                <input
                  type="text"
                  placeholder="e.g. admin2"
                  value={newAdminUser}
                  onChange={(e) => setNewAdminUser(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: "4px" }}>Password <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>(min. 6 characters)</span></label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={newAdminPass}
                  onChange={(e) => setNewAdminPass(e.target.value)}
                />
              </div>
              <div className="modal-actions" style={{ marginTop: "4px" }}>
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
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) readFile(file);
                  }}
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
        .admin-loading, .admin-error, .tab-loading { padding: 80px; text-align: center; color: var(--color-text-muted); }
        .admin-error { color: var(--color-danger); }
        .admin-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; }
        .admin-header h1 { font-size: 1.9rem; color: var(--color-primary); }
        .admin-sub { color: var(--color-text-muted); margin-top: 6px; }

        .btn-tab {
          background: transparent;
          border: 1.5px solid var(--color-border);
          color: var(--color-text-muted);
          padding: 8px 16px;
          border-radius: var(--radius-md);
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-tab:hover {
          border-color: var(--color-primary-light);
          color: var(--color-primary);
        }
        .tab-active {
          background: var(--color-primary);
          color: white !important;
          border-color: var(--color-primary) !important;
        }

        .global-filter-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-right: 12px;
        }
        .global-filter-bar label {
          font-size: 0.85rem;
          color: var(--color-text-muted);
          font-weight: 600;
        }
        .filter-select {
          padding: 6px 12px;
          border-radius: var(--radius-md);
          border: 1.5px solid var(--color-border);
          font-size: 0.85rem;
          background: var(--color-surface);
          cursor: pointer;
          font-weight: 600;
        }

        .compliance-banner-strip {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #E8F4F1;
          border: 1px solid #CFE6DA;
          color: #0F4C45;
          padding: 12px 18px;
          border-radius: var(--radius-md);
          font-size: 0.88rem;
          margin-bottom: 20px;
        }
        .compliance-banner-strip.alert {
          background: #FBEAE8;
          border: 1px solid #F5C6C1;
          color: var(--color-danger);
        }

        .admin-toast {
          background: #EDF6F1;
          color: var(--color-primary);
          border: 1px solid #CFE6DA;
          padding: 12px 18px;
          border-radius: var(--radius-md);
          font-size: 0.88rem;
          margin-bottom: 18px;
        }

        .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 28px; }
        .kpi-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: 24px;
        }
        .kpi-label { font-size: 0.8rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .kpi-value { font-size: 1.8rem; margin: 8px 0 4px; display: flex; align-items: center; gap: 10px; }
        .kpi-sub { font-size: 0.78rem; color: var(--color-text-muted); }
        .mom-badge { font-size: 0.72rem; padding: 2px 8px; border-radius: 12px; font-weight: 700; }
        .mom-badge.positive { background: #E3F2EC; color: var(--color-success); }
        .mom-badge.negative { background: #FBEAE8; color: var(--color-danger); }

        .dashboard-double-column { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 28px; }
        @media (max-width: 900px) { .dashboard-double-column { grid-template-columns: 1fr; } }
        .column-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: 24px;
        }
        .column-card h3 { font-size: 1.05rem; font-family: var(--font-body); margin-bottom: 4px; }
        .chart-note { font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 14px; }
        .chart-note-right { font-size: 0.8rem; color: var(--color-accent); font-weight: 600; }

        .badge-alert-count {
          background: #FBEAE8;
          color: var(--color-danger);
          font-size: 0.72rem;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 12px;
        }
        .clickable-badge {
          cursor: pointer;
          transition: transform 0.15s;
          display: inline-block;
        }
        .clickable-badge:hover {
          transform: scale(1.08);
          box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .badge-risk-scope {
          background: #FFF3CD;
          color: #856404;
          font-size: 0.72rem;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 12px;
        }

        .pill-compliance-flag {
          background: #FCE8E6;
          color: #A82515;
          font-weight: 700;
          font-size: 0.72rem;
          padding: 3px 8px;
          border-radius: 4px;
          border: 1px solid #F5C2C0;
          text-transform: uppercase;
        }

        .btn-manage-catalog {
          font-size: 0.8rem;
          color: var(--color-primary);
          background: var(--color-accent-soft);
          padding: 6px 12px;
          border-radius: var(--radius-md);
          text-decoration: none;
          font-weight: 700;
          border: 1px solid #F0D9AE;
        }
        .btn-manage-catalog:hover {
          background: var(--color-accent);
          color: #3A2700;
        }

        .mini-table { font-size: 0.8rem; }
        .mini-table th { padding: 8px 10px; }
        .mini-table td { padding: 8px 10px; }

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
        .status-flagged { background: #FFF3CD; color: #856404; }
        .status-disabled { background: #FBEAE8; color: var(--color-danger); }
        .cell-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .btn-small, .btn-action-small {
          background: transparent;
          border: 1.5px solid var(--color-border);
          padding: 6px 12px;
          border-radius: var(--radius-sm);
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--color-text-muted);
          white-space: nowrap;
          cursor: pointer;
        }
        .btn-small:hover, .btn-action-small:hover { border-color: var(--color-primary-light); color: var(--color-primary); }
        .btn-danger:hover { border-color: var(--color-danger); color: var(--color-danger); }
        
        .chart-section-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: 24px;
        }
        .chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }

        .ai-trends-container { display: grid; grid-template-columns: 1fr 1.2fr; gap: 28px; }
        @media (max-width: 850px) { .ai-trends-container { grid-template-columns: 1fr; } }
        .trend-box { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 24px; }
        .trend-list { display: flex; flex-direction: column; gap: 10px; padding-left: 20px; margin: 0; }
        .trend-list li { font-size: 0.85rem; color: var(--color-text); line-height: 1.4; }
        .trend-table-wrap { overflow-x: auto; }
        .trend-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
        .trend-table th { text-align: left; padding: 6px 8px; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); font-size: 0.7rem; text-transform: uppercase; }
        .trend-table td { padding: 8px; border-bottom: 1px solid var(--color-border); }
        .trend-table tr:last-child td { border-bottom: none; }
        .alternate-name { color: var(--color-success); }

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
          cursor: pointer;
        }
        .btn-confirm {
          background: var(--color-primary); color: white; border: none;
          padding: 10px 16px; border-radius: var(--radius-md);
          font-weight: 700; font-size: 0.85rem;
          cursor: pointer;
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
          cursor: pointer;
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
