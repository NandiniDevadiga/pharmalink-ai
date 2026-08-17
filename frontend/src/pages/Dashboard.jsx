import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell, Legend, ComposedChart, Area,
} from "recharts";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const COLORS = ["#0F4C45", "#E8A33D", "#3D8361", "#C1473B", "#1A6B5F", "#966319", "#5C6E6A", "#7BA89F", "#4A90A4", "#8B6F47", "#D4844A", "#6B8E23"];

function KpiCard({ label, value, sub, accent }) {
  return (
    <div className="kpi-card">
      <p className="kpi-label">{label}</p>
      <h3 className="kpi-value" style={accent ? { color: accent } : undefined}>{value}</h3>
      {sub && <p className="kpi-sub">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }) {
  return <h2 className="section-title">{children}</h2>;
}

// =============================================================================
// MAIN WRAPPER
// =============================================================================
export default function Dashboard() {
  const { session } = useAuth();
  const isAdmin = session?.role === "admin";

  return (
    <>
      {isAdmin ? <AdminDashboard /> : <PharmacyDashboard />}
      <DashboardStyles />
    </>
  );
}

// =============================================================================
// PHARMACY DASHBOARD (Customized Layout for Individual Branch)
// =============================================================================
function PharmacyDashboard() {
  const { session, logout } = useAuth();
  const token = session?.token;

  const [data, setData] = useState(null);
  const [selectedQuarter, setSelectedQuarter] = useState("3"); // Default to Q3
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Bulk upload stock modal states
  const [showUploadStockModal, setShowUploadStockModal] = useState(false);
  const [stockPreviewData, setStockPreviewData] = useState(null);
  const [stockIsDragging, setStockIsDragging] = useState(false);
  const [stockError, setStockError] = useState(null);
  const [stockSubmitting, setStockSubmitting] = useState(false);

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true);
      try {
        const res = await api.getCustomDashboard(token);
        setData(res);
        setError(null);
      } catch (err) {
        if (err.message === "__UNAUTHORIZED__") logout();
        else setError("Could not load dashboard. Make sure the backend is running.");
      } finally {
        setLoading(false);
      }
    }
    if (token) {
      loadDashboard();
    }
  }, [token, logout]);

  if (loading) return <div className="dash-loading">Loading dashboard…</div>;
  if (error) return <div className="dash-error">{error}</div>;
  if (!data) return <div className="dash-error">No data available</div>;

  const quarterMonthsMap = {
    "1": ["01", "02", "03"],
    "2": ["04", "05", "06"],
    "3": ["07", "08", "09"],
    "4": ["10", "11", "12"]
  };

  const getMonthName = (monthStr) => {
    const [, month] = monthStr.split("-");
    const names = {
      "01": "January", "02": "February", "03": "March",
      "04": "April", "05": "May", "06": "June",
      "07": "July", "08": "August", "09": "September",
      "10": "October", "11": "November", "12": "December"
    };
    return names[month] || monthStr;
  };

  const filteredTrend = (() => {
    const targetMonths = quarterMonthsMap[selectedQuarter];
    const trendMap = {};
    if (data.trend) {
      data.trend.forEach(t => {
        const [, m] = t.month_str.split("-");
        if (targetMonths.includes(m)) {
          trendMap[m] = t.total_inr;
        }
      });
    }
    return targetMonths.map(m => {
      const monthStr = `2026-${m}`;
      return {
        month: getMonthName(monthStr),
        Sales: trendMap[m] || 0
      };
    });
  })();

  function downloadStockTemplate() {
    const h = "drug_name,category,manufacturer,unit_price_inr,stock_qty,otc_or_rx\n";
    const s = "Metformin 500mg,Antidiabetic,Abbott,12.0,150,Rx\n";
    const blob = new Blob([h + s], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.setAttribute("href", url);
    a.setAttribute("download", "pharmalink_stock_template.csv");
    a.click();
    window.URL.revokeObjectURL(url);
  }

  function handleStockCSVParse(text) {
    try {
      setStockError(null);
      const lines = text.split(/\r?\n/);
      if (lines.length === 0 || !lines[0].trim()) throw new Error("File is empty.");
      
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const required = ["drug_name", "category", "manufacturer", "unit_price_inr", "stock_qty", "otc_or_rx"];
      const missing = required.filter(req => !headers.includes(req));
      if (missing.length > 0) throw new Error(`Missing columns: ${missing.join(", ")}`);
      
      const parsed = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cleanCols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => {
          let cl = c.trim();
          if (cl.startsWith('"') && cl.endsWith('"')) cl = cl.substring(1, cl.length - 1);
          return cl;
        });
        const obj = {};
        headers.forEach((h, idx) => {
          let val = cleanCols[idx] || "";
          if (h === "unit_price_inr") obj[h] = parseFloat(val);
          else if (h === "stock_qty") obj[h] = parseInt(val, 10);
          else obj[h] = val;
        });
        parsed.push(obj);
      }
      setStockPreviewData(parsed);
    } catch (err) {
      setStockError(err.message);
    }
  }

  async function handleStockSubmit() {
    if (!stockPreviewData) return;
    setStockSubmitting(true);
    try {
      await api.uploadStock(token, stockPreviewData);
      setShowUploadStockModal(false);
      setStockPreviewData(null);
      window.location.reload();
    } catch (err) {
      setStockError(err.message);
    } finally {
      setStockSubmitting(false);
    }
  }

  return (
    <div className="dashboard-page">
      <div className="dash-header">
        <div>
          <h1>{data.pharmacy_name} — Dashboard</h1>
          <p className="dash-sub">Real-time overview of your store's sales, stock levels, and market insights.</p>
        </div>
        <div className="dash-controls">
          <button
            type="button"
            className="btn-admin-link"
            onClick={() => { setShowUploadStockModal(true); setStockPreviewData(null); setStockError(null); }}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            📦 Upload Stock CSV
          </button>
          <span className="account-pill">{data.pharmacy_id}</span>
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard label="Medicines in Stock" value={data.unique_meds.toLocaleString()} sub="Unique formulations" />
        <KpiCard label="Units Sold (Aug 2026)" value={data.sold_this_month.toLocaleString()} sub="Total medicine volume" />
        <KpiCard 
          label="Revenue (Aug 2026)" 
          value={
            <>
              ₹{data.revenue_this_month.toLocaleString()}
              <span className={`mom-badge ${data.revenue_growth_pct >= 0 ? "positive" : "negative"}`}>
                {data.revenue_growth_pct >= 0 ? "↑" : "↓"} {Math.abs(data.revenue_growth_pct)}% MoM
              </span>
            </>
          } 
          sub="Sales value this month" 
          accent="#3D8361" 
        />
        <KpiCard 
          label="Gross Profit Margin (Aug 2026)" 
          value={`₹${data.gross_profit_this_month.toLocaleString()} (${data.profit_margin_pct}%)`} 
          sub="Profit after cost of goods" 
          accent="#0F4C45" 
        />
      </div>

      {/* ── SMART REORDER SUGGESTIONS ── */}
      <div className="reorder-section-card" style={{ marginBottom: "28px" }}>
        <div className="reorder-header">
          <span className="icon">🚨</span>
          <h3>Smart Reorder Recommendations</h3>
        </div>
        <p className="chart-note">Prioritized restocking list combining low stock levels (&lt; 100 units) with high network demand. Order these immediately to prevent stockouts.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Medicine Name</th>
                <th>Current Stock</th>
                <th>Network Demand (Units Sold)</th>
                <th>Suggested Reorder Quantity</th>
              </tr>
            </thead>
            <tbody>
              {data.reorder_suggestions?.map((item, idx) => (
                <tr key={idx}>
                  <td><strong>{item.drug_name}</strong></td>
                  <td className="stock-critical">{item.current_stock} units left</td>
                  <td className="highlight-val-overall">{item.network_demand} units sold</td>
                  <td><span className="reorder-pill">Order {item.suggested_reorder} units</span></td>
                </tr>
              ))}
              {(!data.reorder_suggestions || data.reorder_suggestions.length === 0) && (
                <tr><td colSpan={4} className="empty-row">No low stock items with network demand detected. All inventory is healthy! 🎉</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ai-trends-container">
        <div className="trend-box new-entries-box">
          <div className="box-header"><span className="icon">🚀</span><h3>New Medicine Market Entries</h3></div>
          <p className="box-sub">Latest drugs introduced to the market. Consider stocking these to meet new demands.</p>
          <ul className="trend-list">
            {data.market_new_entries.map((entry, idx) => (
              <li key={idx}><strong>{entry.split(" - ")[0]}</strong> - {entry.split(" - ")[1]}</li>
            ))}
          </ul>
        </div>

        <div className="trend-box stopped-box">
          <div className="box-header"><span className="icon">⚠️</span><h3>Discontinued Medicines & Alternates</h3></div>
          <p className="box-sub">Medicines recently halted or restricted. Restock the suggested replacements instead.</p>
          <div className="trend-table-wrap">
            <table className="trend-table">
              <thead><tr><th>Discontinued Drug</th><th>Reason</th><th>Suggested Alternate</th></tr></thead>
              <tbody>
                {data.market_stopped_alternates.map((item, idx) => (
                  <tr key={idx}>
                    <td className="discontinued-name">{item.discontinued}</td>
                    <td className="discontinued-reason">{item.reason}</td>
                    <td className="alternate-name"><strong>{item.alternate}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="chart-section-card">
        <div className="chart-header">
          <h3>Quarterly Sales Revenue (Last 3 Months Trend)</h3>
          <div className="quarter-selector">
            <label htmlFor="quarter-select">Filter by Quarter: </label>
            <select id="quarter-select" value={selectedQuarter} onChange={(e) => setSelectedQuarter(e.target.value)}>
              <option value="1">Quarter 1 (Jan - Mar)</option>
              <option value="2">Quarter 2 (Apr - Jun)</option>
              <option value="3">Quarter 3 (Jul - Sep)</option>
              <option value="4">Quarter 4 (Oct - Dec)</option>
            </select>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={filteredTrend} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E4DFD3" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${v.toLocaleString()}`} />
            <Tooltip formatter={v => `₹${v.toLocaleString()}`} />
            <Legend />
            <Line type="monotone" dataKey="Sales" stroke="#0F4C45" strokeWidth={3} activeDot={{ r: 8 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="top-tables-grid">
        <div className="table-card">
          <h3>🏆 Top 10 Sold Medicines (This Branch, Aug 2026)</h3>
          <p className="chart-note">Highest selling products at this branch this month.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Rank</th><th>Medicine Name</th><th>Units Sold</th></tr></thead>
              <tbody>
                {data.top_sold.map((m, idx) => (
                  <tr key={idx}><td><strong>#{idx + 1}</strong></td><td>{m.drug_name}</td><td className="highlight-val">{m.quantity} units</td></tr>
                ))}
                {data.top_sold.length === 0 && <tr><td colSpan={3} className="empty-row">No sales data recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="table-card">
          <h3>🔥 Top 10 Demanded Medicines (Overall Network, Aug 2026)</h3>
          <p className="chart-note">Highest selling products overall across all pharmacy branches this month.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Rank</th><th>Medicine Name</th><th>Units Demanded</th></tr></thead>
              <tbody>
                {data.top_demanded_overall.map((m, idx) => (
                  <tr key={idx}><td><strong>#{idx + 1}</strong></td><td>{m.drug_name}</td><td className="highlight-val-overall">{m.quantity} units</td></tr>
                ))}
                {data.top_demanded_overall.length === 0 && <tr><td colSpan={3} className="empty-row">No network sales recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="stock-levels-section">
        <h3>📦 Inventory Stock Levels Classification</h3>
        <p className="chart-note">Categorized by unit stock: High (&gt; 500 units), Medium (100 - 500 units), and Low (&lt; 100 units).</p>
        <div className="stock-grid-table">
          <div className="stock-col high-stock-col">
            <h4 className="col-title col-high">🟢 High Stock (&gt;500)</h4>
            <ul className="stock-list">
              {data.high_stock.map((item, idx) => <li key={idx}>{item}</li>)}
              {data.high_stock.length === 0 && <li className="empty-li text-muted">No items in high stock</li>}
            </ul>
          </div>
          <div className="stock-col med-stock-col">
            <h4 className="col-title col-med">🟡 Medium Stock (100 - 500)</h4>
            <ul className="stock-list">
              {data.med_stock.map((item, idx) => <li key={idx}>{item}</li>)}
              {data.med_stock.length === 0 && <li className="empty-li text-muted">No items in medium stock</li>}
            </ul>
          </div>
          <div className="stock-col low-stock-col">
            <h4 className="col-title col-low">🔴 Low Stock (&lt;100)</h4>
            <ul className="stock-list">
              {data.low_stock.map((item, idx) => <li key={idx} className="low-stock-item">{item}</li>)}
              {data.low_stock.length === 0 && <li className="empty-li text-muted text-success">All stock levels healthy 🎉</li>}
            </ul>
          </div>
        </div>
      </div>

      {showUploadStockModal && (
        <div className="modal-overlay" onClick={() => { if (!stockSubmitting) setShowUploadStockModal(false); }}>
          <div className="modal-card bulk-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <h3>Upload Branch Inventory Stock</h3>
              <button className="btn-close-x" onClick={() => setShowUploadStockModal(false)}>&times;</button>
            </div>
            <p className="modal-sub">Upload your branch's complete medicine stock list to replace database stock.</p>
            {stockError && <div className="alert-error" style={{ marginTop: "12px", background: "#FBEAE8", color: "var(--color-danger)", padding: "10px 14px", borderRadius: "var(--radius-md)" }}>⚠️ {stockError}</div>}
            {!stockPreviewData ? (
              <div className="upload-modal-content" style={{ marginTop: "18px" }}>
                <button type="button" className="btn-template-download" onClick={downloadStockTemplate}>📥 Download CSV Template</button>
                <div className="dropzone">
                  <span className="dropzone-icon">📦</span>
                  <p className="dropzone-text">Drag and drop stock CSV here</p>
                  <span className="dropzone-or">or</span>
                  <label htmlFor="stock-file-input" className="btn-file-select">Choose File</label>
                  <input type="file" id="stock-file-input" accept=".csv" onChange={(e) => handleStockCSVParse(e.target.files?.[0])} hidden />
                </div>
              </div>
            ) : (
              <div className="preview-modal-content" style={{ marginTop: "18px" }}>
                <div className="preview-table-wrap">
                  <table className="preview-table">
                    <thead><tr><th>Drug Name</th><th>Category</th><th>Manufacturer</th><th>Unit Price</th><th>Quantity</th></tr></thead>
                    <tbody>
                      {stockPreviewData.slice(0, 10).map((row, idx) => (
                        <tr key={idx}><td><strong>{row.drug_name}</strong></td><td>{row.category}</td><td>{row.manufacturer}</td><td>₹{row.unit_price_inr}</td><td>{row.stock_qty}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="modal-actions" style={{ marginTop: "20px" }}>
                  <button type="button" className="btn-cancel" onClick={() => setStockPreviewData(null)}>Cancel</button>
                  <button type="button" className="btn-confirm" onClick={handleStockSubmit}>{stockSubmitting ? "Uploading..." : "Confirm"}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// ADMIN DASHBOARD (Original Network-wide Layout)
// =============================================================================
function AdminDashboard() {
  const { session, logout } = useAuth();
  const token = session?.token;
  const isAdmin = session?.role === "admin";

  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [quarterly, setQuarterly] = useState([]);
  const [categories, setCategories] = useState([]);
  const [topDrugs, setTopDrugs] = useState([]);
  const [seasonal, setSeasonal] = useState([]);
  const [branches, setBranches] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [otcRx, setOtcRx] = useState([]);
  const [forecast, setForecast] = useState([]);
  const [unmetDemand, setUnmetDemand] = useState(null);
  const [forecastMonths, setForecastMonths] = useState(1);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadForecast(months) {
    const f = await api.getForecast(token, months);
    setForecast(f);
  }

  useEffect(() => {
    async function loadAll() {
      try {
        const calls = [
          api.getDashboardSummary(token),
          api.getSalesTrend(token, "monthly"),
          api.getQuarterlySales(token),
          api.getCategoryBreakdown(token),
          api.getTopDrugs(token, 10),
          api.getSeasonalHeatmap(token),
          api.getLowStock(token, 20),
          api.getOtcVsRx(token),
          api.getForecast(token, 1),
          api.getUnmetDemand(token),
        ];
        const [s, t, q, c, td, seas, ls, or_, fc, ud] = await Promise.all(calls);
        setSummary(s); setTrend(t); setQuarterly(q); setCategories(c);
        setTopDrugs(td); setSeasonal(seas); setLowStock(ls); setOtcRx(or_);
        setForecast(fc); setUnmetDemand(ud);
        if (isAdmin) {
          const b = await api.getBranchPerformance(token);
          setBranches(b);
        }
      } catch (err) {
        if (err.message === "__UNAUTHORIZED__") logout();
        else setError("Could not load dashboard. Make sure the backend is running on port 8000.");
      } finally {
        setLoading(false);
      }
    }
    loadAll();
  }, [token, isAdmin, logout]);

  if (loading) return <div className="dash-loading">Loading dashboard…</div>;
  if (error) return <div className="dash-error">{error}</div>;

  const seasonalPivot = (() => {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const pivot = months.map(m => ({ month: m }));
    seasonal.forEach(({ category, month_name, units_sold }) => {
      const idx = months.indexOf(month_name);
      if (idx >= 0) pivot[idx][category] = (pivot[idx][category] || 0) + units_sold;
    });
    return pivot;
  })();
  const seasonalCategories = [...new Set(seasonal.map(s => s.category))];

  return (
    <div className="dashboard-page">
      <div className="dash-header">
        <div>
          <h1>Network Dashboard</h1>
          <p className="dash-sub">Head office · all {summary.active_pharmacies} branches · 12-month data</p>
        </div>
        <div className="dash-account">
          <span className="account-pill">Head Office</span>
          <Link to="/admin" className="btn-admin-link">Manage Accounts</Link>
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard label="Total Revenue" value={`₹${(summary.total_revenue_inr / 100000).toFixed(2)}L`} sub="last 12 months" />
        <KpiCard label="Transactions" value={summary.total_transactions.toLocaleString()} sub="orders processed" />
        <KpiCard label="Avg Order Value" value={`₹${summary.avg_order_value_inr}`} sub="per transaction" />
        <KpiCard label="Units Sold" value={summary.total_units_sold.toLocaleString()} sub="across all branches" />
        <KpiCard label="Low Stock Alerts" value={summary.low_stock_alerts} sub="below 20 units" accent="var(--color-danger)" />
      </div>

      <SectionTitle>📈 Sales Performance</SectionTitle>
      <div className="chart-grid">
        <div className="chart-card wide">
          <h3>Monthly Revenue Trend</h3>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4DFD3" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={v => `₹${v.toLocaleString()}`} />
              <Area type="monotone" dataKey="revenue_inr" fill="#E8F4F1" stroke="#0F4C45" strokeWidth={2.5} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Quarterly Revenue</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={quarterly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4DFD3" />
              <XAxis dataKey="quarter" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={v => `₹${v.toLocaleString()}`} />
              <Bar dataKey="revenue_inr" radius={[6,6,0,0]}>
                {quarterly.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>OTC vs Prescription Split</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={otcRx} dataKey="revenue_inr" nameKey="otc_or_rx" cx="50%" cy="50%" outerRadius={90} label={d => d.otc_or_rx}>
                {otcRx.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <Tooltip formatter={v => `₹${v.toLocaleString()}`} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <SectionTitle>💊 Medicine Analysis</SectionTitle>
      <div className="chart-grid">
        <div className="chart-card">
          <h3>Revenue by Category</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={categories} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4DFD3" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
              <YAxis dataKey="category" type="category" tick={{ fontSize: 11 }} width={120} />
              <Tooltip formatter={v => `₹${v.toLocaleString()}`} />
              <Bar dataKey="revenue_inr" radius={[0,6,6,0]}>
                {categories.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Top 10 Selling Medicines (Units)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topDrugs} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4DFD3" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="drug_name" type="category" tick={{ fontSize: 9 }} width={160} />
              <Tooltip />
              <Bar dataKey="units_sold" fill="#E8A33D" radius={[0,6,6,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card wide">
          <h3>🌧️ Seasonal Demand Pattern — Units Sold by Category per Month</h3>
          <p className="chart-note">Shows category trends monthly.</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={seasonalPivot} margin={{ bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4DFD3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              {seasonalCategories.map((cat, i) => (
                <Bar key={cat} dataKey={cat} stackId="a" fill={COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <SectionTitle>🏪 Branch Performance</SectionTitle>
      <div className="chart-grid">
        <div className="chart-card wide">
          <h3>Revenue by Branch (Head Office View)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={branches} margin={{ bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4DFD3" />
              <XAxis dataKey="area" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={80} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={v => `₹${v.toLocaleString()}`} />
              <Bar dataKey="revenue_inr" fill="#1A6B5F" radius={[6,6,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <SectionTitle>📦 Stock Management</SectionTitle>
      <div className="table-card">
        <h3>⚠️ Low Stock Items (below 20 units)</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Pharmacy</th><th>Drug</th><th>Category</th><th>Stock Left</th><th>Price/Unit</th></tr></thead>
            <tbody>
              {lowStock.slice(0, 15).map((item, i) => (
                <tr key={i}>
                  <td>{item.pharmacy_name}</td><td>{item.drug_name}</td>
                  <td><span className="cat-tag">{item.category}</span></td>
                  <td className={item.stock_qty < 5 ? "stock-critical" : "stock-low"}>{item.stock_qty}</td>
                  <td>₹{item.unit_price_inr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SectionTitle>🔮 Order Forecasting</SectionTitle>
      <div className="table-card">
        <div className="forecast-header">
          <h3>How many units should you order?</h3>
          <div className="forecast-controls">
            <span>Forecast for:</span>
            {[1, 2, 3].map(m => (
              <button key={m} className={`btn-period ${forecastMonths === m ? "active" : ""}`} onClick={async () => { setForecastMonths(m); await loadForecast(m); }}>
                {m} month{m > 1 ? "s" : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Drug</th><th>Category</th><th>Avg Monthly Sales</th><th>Seasonal Boost</th><th>Forecast Need</th><th>Current Stock</th><th>Units to Order</th><th>Priority</th></tr></thead>
            <tbody>
              {forecast.filter(f => f.priority !== "OK").slice(0, 20).map((f, i) => (
                <tr key={i}>
                  <td>{f.drug_name}</td><td><span className="cat-tag">{f.category}</span></td><td>{f.avg_monthly_sales}</td>
                  <td>{f.seasonal_multiplier > 1 ? <span className="seasonal-boost">×{f.seasonal_multiplier}</span> : "—"}</td>
                  <td>{f.forecast_qty}</td><td className={f.current_stock < 10 ? "stock-critical" : ""}>{f.current_stock}</td>
                  <td><strong>{f.units_to_order}</strong></td><td><span className={`priority-pill priority-${f.priority.toLowerCase()}`}>{f.priority}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SectionTitle>🔍 Unmet Demand — What Patients Couldn't Find</SectionTitle>
      <div className="table-card">
        <h3>Medicines searched but not in stock</h3>
        {unmetDemand?.unmet_demands?.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Medicine</th><th>Times Searched</th><th>Your Stock</th><th>Available Elsewhere</th></tr></thead>
              <tbody>
                {unmetDemand.unmet_demands.map((d, i) => (
                  <tr key={i}>
                    <td><strong>{d.drug_name}</strong></td><td><span className="search-count">{d.times_searched}×</span></td>
                    <td className={d.local_stock === 0 ? "stock-critical" : ""}>{d.local_stock ?? "—"}</td>
                    <td>
                      {d.available_at_other_pharmacies.map((p, j) => (
                        <div key={j} className="elsewhere-entry">{p.pharmacy_name} ({p.area}) — {p.stock_qty} units @ ₹{p.unit_price_inr}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">No unmet demand data.</div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// GLOBAL CSS STYLING
// =============================================================================
function DashboardStyles() {
  return (
    <style>{`
      .dashboard-page { max-width: 1300px; margin: 0 auto; padding: 40px 32px 80px; }
      .dash-loading, .dash-error { padding: 80px; text-align: center; color: var(--color-text-muted); font-size: 1.1rem; }
      .dash-error { color: var(--color-danger); }
      .dash-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
      .dash-header h1 { font-size: 1.9rem; color: var(--color-primary); }
      .dash-sub { color: var(--color-text-muted); margin-top: 6px; }
      .dash-controls { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
      .branch-switcher select {
        padding: 8px 12px;
        border: 1.5px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        font-weight: 600;
        font-size: 0.85rem;
        color: var(--color-text);
        cursor: pointer;
      }
      .account-pill { background: var(--color-accent-soft); color: #966319; font-weight: 700; font-size: 0.78rem; padding: 6px 12px; border-radius: 20px; text-transform: uppercase; }

      .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin-bottom: 28px; margin-top: 20px; }
      .kpi-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 22px 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
      .kpi-label { font-size: 0.78rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
      .kpi-value { font-size: 1.8rem; margin-top: 8px; color: var(--color-primary); font-family: var(--font-display); }
      .kpi-sub { font-size: 0.78rem; color: var(--color-text-muted); margin-top: 6px; }

      .mom-badge {
        font-size: 0.7rem;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 8px;
        display: inline-block;
        vertical-align: middle;
      }
      .mom-badge.positive {
        background: #E3F2EC;
        color: var(--color-success);
      }
      .mom-badge.negative {
        background: #FBEAE8;
        color: var(--color-danger);
      }
      .reorder-section-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: 24px;
      }
      .reorder-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .reorder-header h3 {
        font-size: 1rem;
        font-weight: 700;
        color: var(--color-primary);
        margin: 0;
      }
      .reorder-pill {
        background: #E8F4F1;
        color: var(--color-primary);
        font-weight: 700;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 0.78rem;
      }

      .section-title { font-size: 1.1rem; font-family: var(--font-body); font-weight: 700; margin: 36px 0 16px; color: var(--color-text); border-left: 4px solid var(--color-accent); padding-left: 12px; }

      /* AI Trends Container */
      .ai-trends-container { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 28px; margin-top: 20px; }
      .trend-box { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 24px; }
      .box-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .box-header .icon { font-size: 1.3rem; }
      .box-header h3 { font-size: 1.05rem; font-weight: 700; color: var(--color-primary); margin: 0; }
      .box-sub { font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 16px; line-height: 1.4; }
      .trend-list { display: flex; flex-direction: column; gap: 10px; padding-left: 20px; margin: 0; }
      .trend-list li { font-size: 0.85rem; color: var(--color-text); line-height: 1.4; }
      .trend-table-wrap { overflow-x: auto; }
      .trend-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
      .trend-table th { text-align: left; padding: 6px 8px; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); font-size: 0.7rem; text-transform: uppercase; }
      .trend-table td { padding: 8px; border-bottom: 1px solid var(--color-border); }
      .trend-table tr:last-child td { border-bottom: none; }
      .discontinued-name { font-weight: 600; color: var(--color-danger); }
      .discontinued-reason { color: var(--color-text-muted); }
      .alternate-name { color: var(--color-success); }
      @media (max-width: 900px) { .ai-trends-container { grid-template-columns: 1fr; } }

      /* Chart section */
      .chart-section-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 28px; }
      .chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; flex-wrap: wrap; gap: 10px; }
      .chart-header h3 { font-size: 1rem; font-weight: 700; color: var(--color-primary); }
      .quarter-selector select {
        padding: 6px 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg);
        font-weight: 600;
        font-size: 0.8rem;
        color: var(--color-text);
        cursor: pointer;
      }

      /* Top 10 side by side */
      .top-tables-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 28px; }
      .table-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 24px; }
      .table-card h3 { font-size: 1rem; font-weight: 700; color: var(--color-primary); margin-bottom: 4px; }
      .chart-note { font-size: 0.78rem; color: var(--color-text-muted); margin-bottom: 14px; }
      .table-wrap { overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
      th { text-align: left; padding: 10px; color: var(--color-text-muted); font-weight: 600; border-bottom: 1px solid var(--color-border); font-size: 0.72rem; text-transform: uppercase; }
      td { padding: 10px; border-bottom: 1px solid var(--color-border); }
      tr:last-child td { border-bottom: none; }
      .highlight-val { color: var(--color-primary); font-weight: 700; }
      .highlight-val-overall { color: #E8A33D; font-weight: 700; }
      .empty-row { text-align: center; color: var(--color-text-muted); padding: 20px; }
      @media (max-width: 900px) { .top-tables-grid { grid-template-columns: 1fr; } }

      /* Stock Levels Section */
      .stock-levels-section { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 28px; }
      .stock-levels-section h3 { font-size: 1rem; font-weight: 700; color: var(--color-primary); margin-bottom: 4px; }
      .stock-grid-table { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 18px; }
      .stock-col { border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg); overflow: hidden; }
      .col-title { padding: 12px 14px; font-size: 0.82rem; font-weight: 700; margin: 0; text-transform: uppercase; border-bottom: 1px solid var(--color-border); }
      .col-high { background: #E8F4F1; color: var(--color-success); }
      .col-med { background: var(--color-accent-soft); color: #966319; }
      .col-low { background: #FFF3F2; color: var(--color-danger); }
      .stock-list { list-style: none; padding: 10px 14px; margin: 0; display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto; }
      .stock-list li { font-size: 0.82rem; color: var(--color-text); border-bottom: 1px solid rgba(0,0,0,0.03); padding-bottom: 6px; }
      .stock-list li:last-child { border-bottom: none; }
      .low-stock-item { font-weight: 600; color: var(--color-danger); }
      .empty-li { border: none !important; font-style: italic; }
      @media (max-width: 900px) { .stock-grid-table { grid-template-columns: 1fr; } }

      /* Original admin styles */
      .dash-account { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .btn-admin-link { background: var(--color-accent-soft); color: #966319; padding: 7px 14px; border-radius: var(--radius-md); font-size: 0.82rem; font-weight: 700; text-decoration: none; display: inline-block; }
      .btn-admin-link:hover { background: var(--color-accent); color: #3A2700; }
      .chart-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
      .chart-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 20px; }
      .chart-card.wide { grid-column: span 2; }
      .chart-card h3 { font-size: 0.95rem; font-family: var(--font-body); font-weight: 700; margin-bottom: 8px; }
      .cat-tag { background: var(--color-accent-soft); color: #966319; padding: 2px 8px; border-radius: 10px; font-size: 0.72rem; white-space: nowrap; }
      .stock-low { color: var(--color-accent); font-weight: 700; }
      .stock-critical { color: var(--color-danger); font-weight: 700; }
      .forecast-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
      .forecast-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .forecast-controls span { font-size: 0.82rem; color: var(--color-text-muted); }
      .btn-period { background: transparent; border: 1.5px solid var(--color-border); padding: 6px 12px; border-radius: var(--radius-sm); font-size: 0.8rem; font-weight: 600; color: var(--color-text-muted); cursor: pointer; }
      .btn-period.active { background: var(--color-primary); border-color: var(--color-primary); color: white; }
      .seasonal-boost { background: #FFF3E0; color: #E65100; font-size: 0.78rem; font-weight: 700; padding: 2px 7px; border-radius: 10px; }
      .search-count { background: var(--color-primary); color: white; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; }
      .elsewhere-entry { font-size: 0.78rem; color: var(--color-text-muted); margin-bottom: 3px; }

      /* Modal and Dropzone */
      .dropzone { border: 2px dashed var(--color-border); border-radius: var(--radius-lg); padding: 32px; display: flex; flex-direction: column; align-items: center; background: var(--color-bg); }
      .dropzone-icon { font-size: 2.2rem; margin-bottom: 8px; }
      .dropzone-text { font-size: 0.92rem; font-weight: 500; color: var(--color-text-muted); margin-bottom: 4px; }
      .dropzone-or { font-size: 0.78rem; color: var(--color-text-muted); text-transform: uppercase; margin: 8px 0; }
      .btn-file-select { background: var(--color-surface); border: 1.5px solid var(--color-border); padding: 8px 18px; border-radius: var(--radius-md); font-size: 0.85rem; font-weight: 600; color: var(--color-text); cursor: pointer; }
      .btn-file-select:hover { border-color: var(--color-primary-light); color: var(--color-primary); }
      .preview-table-wrap { max-height: 280px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
      .preview-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
      .preview-table th { background: var(--color-bg); padding: 8px 12px; font-size: 0.7rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); position: sticky; top: 0; }
      .preview-table td { padding: 8px 12px; border-bottom: 1px solid var(--color-border); }
      .btn-cancel { background: transparent; border: 1.5px solid var(--color-border); padding: 10px 16px; border-radius: var(--radius-md); font-weight: 600; font-size: 0.85rem; color: var(--color-text-muted); cursor: pointer; }
      .btn-confirm { background: var(--color-primary); color: white; border: none; padding: 10px 16px; border-radius: var(--radius-md); font-weight: 700; font-size: 0.85rem; cursor: pointer; }
      .modal-card { background: var(--color-surface); border-radius: var(--radius-lg); padding: 28px; max-width: 380px; width: 100%; }
      .bulk-modal-card { max-width: 720px; width: 100%; }
      .modal-header-row { display: flex; justify-content: space-between; align-items: center; }
      .btn-close-x { background: none; border: none; font-size: 1.5rem; font-weight: 700; color: var(--color-text-muted); cursor: pointer; }
      .btn-close-x:hover { color: var(--color-danger); }
      .modal-overlay { position: fixed; inset: 0; background: rgba(28,40,38,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
      .alert-error { margin-top: 12px; background: #FBEAE8; color: var(--color-danger); padding: 10px 14px; border-radius: var(--radius-md); font-size: 0.85rem; }
    `}</style>
  );
}
