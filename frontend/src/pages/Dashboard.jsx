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

export default function Dashboard() {
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

  // Build seasonal chart data: pivot to {month, Cat1, Cat2, ...}
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

  if (loading) return <div className="dash-loading">Loading dashboard…</div>;
  if (error) return <div className="dash-error">{error}</div>;

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="dash-header">
        <div>
          <h1>{isAdmin ? "Network Dashboard" : `${summary.pharmacy_name} — Dashboard`}</h1>
          <p className="dash-sub">
            {isAdmin
              ? `Head office · all ${summary.active_pharmacies} branches · 12-month data`
              : `Your store's performance · 12-month data`}
          </p>
        </div>
        <div className="dash-account">
          <span className="account-pill">{isAdmin ? "Head Office" : session.pharmacy_id}</span>
          {isAdmin && <Link to="/admin" className="btn-admin-link">Manage Accounts</Link>}
          <button className="btn-logout" onClick={logout}>Log out</button>
        </div>
      </div>

      {/* ── KPI CARDS ── */}
      <div className="kpi-row">
        <KpiCard label="Total Revenue" value={`₹${(summary.total_revenue_inr / 100000).toFixed(2)}L`} sub="last 12 months" />
        <KpiCard label="Transactions" value={summary.total_transactions.toLocaleString()} sub="orders processed" />
        <KpiCard label="Avg Order Value" value={`₹${summary.avg_order_value_inr}`} sub="per transaction" />
        <KpiCard label="Units Sold" value={summary.total_units_sold.toLocaleString()} sub={isAdmin ? "across all branches" : "at your store"} />
        <KpiCard label="Low Stock Alerts" value={summary.low_stock_alerts} sub="below 20 units" accent="var(--color-danger)" />
      </div>

      {/* ── SECTION 1: SALES PERFORMANCE ── */}
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

      {/* ── SECTION 2: MEDICINE ANALYSIS ── */}
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
          <p className="chart-note">Shows which medicine categories spike in which months. Respiratory peaks in monsoon (Jul-Sep), electrolytes in summer (Apr-Jun).</p>
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

      {/* ── SECTION 3: BRANCH PERFORMANCE (admin only) ── */}
      {isAdmin && (
        <>
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
        </>
      )}

      {/* ── SECTION 4: STOCK MANAGEMENT ── */}
      <SectionTitle>📦 Stock Management</SectionTitle>

      <div className="table-card">
        <h3>⚠️ Low Stock Items (below 20 units){!isAdmin && " — your store"}</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {isAdmin && <th>Pharmacy</th>}
                <th>Drug</th><th>Category</th><th>Stock Left</th><th>Price/Unit</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.slice(0, 15).map((item, i) => (
                <tr key={i}>
                  {isAdmin && <td>{item.pharmacy_name}</td>}
                  <td>{item.drug_name}</td>
                  <td><span className="cat-tag">{item.category}</span></td>
                  <td className={item.stock_qty < 5 ? "stock-critical" : "stock-low"}>{item.stock_qty}</td>
                  <td>₹{item.unit_price_inr}</td>
                </tr>
              ))}
              {lowStock.length === 0 && <tr><td colSpan={5} className="empty-row">All stock levels healthy 🎉</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SECTION 5: ORDER FORECASTING ── */}
      <SectionTitle>🔮 Order Forecasting</SectionTitle>
      <div className="table-card">
        <div className="forecast-header">
          <div>
            <h3>How many units should you order?</h3>
            <p className="chart-note">Based on 3-month trailing average × seasonal demand multiplier + 20% safety buffer. Shows top medicines needing reorder.</p>
          </div>
          <div className="forecast-controls">
            <span>Forecast for:</span>
            {[1, 2, 3].map(m => (
              <button
                key={m}
                className={`btn-period ${forecastMonths === m ? "active" : ""}`}
                onClick={async () => { setForecastMonths(m); await loadForecast(m); }}
              >
                {m} month{m > 1 ? "s" : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Drug</th><th>Category</th><th>Avg Monthly Sales</th>
                <th>Seasonal Boost</th><th>Forecast Need</th>
                <th>Current Stock</th><th>Units to Order</th><th>Priority</th>
              </tr>
            </thead>
            <tbody>
              {forecast.filter(f => f.priority !== "OK").slice(0, 20).map((f, i) => (
                <tr key={i}>
                  <td>{f.drug_name}</td>
                  <td><span className="cat-tag">{f.category}</span></td>
                  <td>{f.avg_monthly_sales}</td>
                  <td>{f.seasonal_multiplier > 1 ? <span className="seasonal-boost">×{f.seasonal_multiplier}</span> : "—"}</td>
                  <td>{f.forecast_qty}</td>
                  <td className={f.current_stock < 10 ? "stock-critical" : ""}>{f.current_stock}</td>
                  <td><strong>{f.units_to_order}</strong></td>
                  <td><span className={`priority-pill priority-${f.priority.toLowerCase()}`}>{f.priority}</span></td>
                </tr>
              ))}
              {forecast.filter(f => f.priority !== "OK").length === 0 && (
                <tr><td colSpan={8} className="empty-row">All medicines adequately stocked for the forecast period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SECTION 6: UNMET DEMAND ── */}
      <SectionTitle>🔍 Unmet Demand — What Patients Couldn't Find</SectionTitle>
      <div className="table-card">
        <div>
          <h3>Medicines searched but not in stock</h3>
          <p className="chart-note">
            Logged automatically when a customer searches the Med Locator and finds zero in-stock results near them.
            Also shows which other pharmacies currently have it, so you can refer patients or place inter-pharmacy orders.
          </p>
        </div>
        {unmetDemand?.unmet_demands?.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Medicine</th><th>Times Searched</th><th>Your Stock</th><th>Available Elsewhere</th>
                </tr>
              </thead>
              <tbody>
                {unmetDemand.unmet_demands.map((d, i) => (
                  <tr key={i}>
                    <td><strong>{d.drug_name}</strong></td>
                    <td><span className="search-count">{d.times_searched}×</span></td>
                    <td className={d.local_stock === 0 ? "stock-critical" : ""}>{d.local_stock ?? "—"}</td>
                    <td>
                      {d.available_at_other_pharmacies.length > 0
                        ? d.available_at_other_pharmacies.map((p, j) => (
                            <div key={j} className="elsewhere-entry">
                              {p.pharmacy_name} ({p.area}) — {p.stock_qty} units @ ₹{p.unit_price_inr}
                            </div>
                          ))
                        : <span className="text-muted">Not available at any branch</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            {unmetDemand?.message || "No unmet demand data yet. This populates automatically as customers use the Med Locator."}
          </div>
        )}
      </div>

      <style>{`
        .dashboard-page { max-width: 1300px; margin: 0 auto; padding: 40px 32px 80px; }
        .dash-loading, .dash-error { padding: 80px; text-align: center; color: var(--color-text-muted); }
        .dash-error { color: var(--color-danger); }
        .dash-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
        .dash-header h1 { font-size: 1.9rem; color: var(--color-primary); }
        .dash-sub { color: var(--color-text-muted); margin-top: 6px; }
        .dash-account { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .account-pill { background: var(--color-accent-soft); color: #966319; font-weight: 700; font-size: 0.78rem; padding: 6px 12px; border-radius: 20px; text-transform: uppercase; }
        .btn-admin-link { background: var(--color-accent-soft); color: #966319; padding: 7px 14px; border-radius: var(--radius-md); font-size: 0.82rem; font-weight: 700; }
        .btn-admin-link:hover { background: var(--color-accent); color: #3A2700; }
        .btn-logout { background: transparent; border: 1.5px solid var(--color-border); padding: 7px 14px; border-radius: var(--radius-md); font-size: 0.82rem; font-weight: 600; color: var(--color-text-muted); }
        .btn-logout:hover { border-color: var(--color-danger); color: var(--color-danger); }

        .section-title { font-size: 1.1rem; font-family: var(--font-body); font-weight: 700; margin: 36px 0 16px; color: var(--color-text); border-left: 4px solid var(--color-accent); padding-left: 12px; }

        .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-top: 28px; }
        .kpi-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 18px 20px; }
        .kpi-label { font-size: 0.78rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
        .kpi-value { font-size: 1.6rem; margin-top: 6px; color: var(--color-primary); font-family: var(--font-display); }
        .kpi-sub { font-size: 0.78rem; color: var(--color-text-muted); margin-top: 4px; }

        .chart-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
        .chart-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 20px; }
        .chart-card.wide { grid-column: span 2; }
        .chart-card h3 { font-size: 0.95rem; font-family: var(--font-body); font-weight: 700; margin-bottom: 8px; }
        .chart-note { font-size: 0.78rem; color: var(--color-text-muted); margin-bottom: 14px; line-height: 1.4; }
        @media (max-width: 900px) { .chart-grid { grid-template-columns: 1fr; } .chart-card.wide { grid-column: span 1; } }

        .table-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 0; }
        .table-card h3 { font-size: 0.95rem; margin-bottom: 6px; color: var(--color-danger); }
        .table-wrap { overflow-x: auto; margin-top: 14px; }
        table { width: 100%; border-collapse: collapse; font-size: 0.85rem; min-width: 600px; }
        th { text-align: left; padding: 8px 10px; color: var(--color-text-muted); font-weight: 600; border-bottom: 1px solid var(--color-border); font-size: 0.72rem; text-transform: uppercase; }
        td { padding: 9px 10px; border-bottom: 1px solid var(--color-border); }
        tr:last-child td { border-bottom: none; }
        .cat-tag { background: var(--color-accent-soft); color: #966319; padding: 2px 8px; border-radius: 10px; font-size: 0.72rem; white-space: nowrap; }
        .stock-low { color: var(--color-accent); font-weight: 700; }
        .stock-critical { color: var(--color-danger); font-weight: 700; }
        .empty-row { text-align: center; color: var(--color-text-muted); padding: 20px; }
        .empty-state { padding: 20px; color: var(--color-text-muted); font-size: 0.88rem; margin-top: 12px; }
        .text-muted { color: var(--color-text-muted); font-size: 0.82rem; }

        .forecast-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
        .forecast-header h3 { font-size: 0.95rem; margin-bottom: 4px; color: var(--color-text); }
        .forecast-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .forecast-controls span { font-size: 0.82rem; color: var(--color-text-muted); }
        .btn-period { background: transparent; border: 1.5px solid var(--color-border); padding: 6px 12px; border-radius: var(--radius-sm); font-size: 0.8rem; font-weight: 600; color: var(--color-text-muted); }
        .btn-period.active { background: var(--color-primary); border-color: var(--color-primary); color: white; }
        .seasonal-boost { background: #FFF3E0; color: #E65100; font-size: 0.78rem; font-weight: 700; padding: 2px 7px; border-radius: 10px; }
        .priority-pill { font-size: 0.7rem; font-weight: 700; padding: 3px 9px; border-radius: 20px; text-transform: uppercase; }
        .priority-high { background: #FBEAE8; color: var(--color-danger); }
        .priority-medium { background: var(--color-accent-soft); color: #966319; }
        .priority-ok { background: #E3F2EC; color: var(--color-success); }

        .search-count { background: var(--color-primary); color: white; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; }
        .elsewhere-entry { font-size: 0.78rem; color: var(--color-text-muted); margin-bottom: 3px; }
      `}</style>
    </div>
  );
}
