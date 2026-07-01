import { useState } from "react";
import { api } from "../api/client";

const MUMBAI_DEFAULT = { lat: 19.0760, lon: 72.8777 };

export default function MedLocator() {
  const [drugName, setDrugName] = useState("");
  const [location, setLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState("idle"); // idle | locating | got | denied
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function detectLocation() {
    setLocationStatus("locating");
    if (!navigator.geolocation) {
      setLocation(MUMBAI_DEFAULT);
      setLocationStatus("got");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocationStatus("got");
      },
      () => {
        setLocation(MUMBAI_DEFAULT);
        setLocationStatus("denied");
      },
      { timeout: 6000 }
    );
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!drugName.trim()) return;
    const loc = location || MUMBAI_DEFAULT;
    setLoading(true);
    setError(null);
    try {
      const data = await api.searchMedicine(drugName.trim(), loc.lat, loc.lon, 25);
      setResults(data);
    } catch (err) {
      setError("Could not reach the server. Make sure the backend is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="locator-page">
      <section className="locator-hero">
        <h1>Find your medicine, nearby.</h1>
        <p className="hero-sub">
          Search a medicine name and see which pharmacies near you have it in stock —
          with price per unit and the pharmacist's contact.
        </p>

        <form className="search-row" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="e.g. Paracetamol, Cetirizine, Metformin..."
            value={drugName}
            onChange={(e) => setDrugName(e.target.value)}
            aria-label="Medicine name"
          />
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
        </form>

        <div className="location-row">
          {locationStatus === "idle" && (
            <button className="btn-ghost" onClick={detectLocation} type="button">
              📍 Use my current location
            </button>
          )}
          {locationStatus === "locating" && <span className="loc-status">Detecting location…</span>}
          {locationStatus === "got" && (
            <span className="loc-status success">📍 Location set — searching near you</span>
          )}
          {locationStatus === "denied" && (
            <span className="loc-status warn">📍 Location unavailable — using Mumbai default. <button className="btn-link" onClick={detectLocation}>Retry</button></span>
          )}
        </div>
      </section>

      {error && <div className="alert-error">{error}</div>}

      {results && (
        <section className="results-section">
          <div className="results-header">
            <h2>{results.count} pharmac{results.count === 1 ? "y" : "ies"} found for "{results.query}"</h2>
          </div>

          {results.count === 0 && (
            <div className="empty-state">
              No nearby pharmacy currently lists this medicine in stock. Try a different spelling,
              or widen your search radius.
            </div>
          )}

          <div className="results-grid">
            {results.results.map((r, i) => (
              <article className="pharmacy-card" key={i}>
                <div className="card-top">
                  <h3>{r.pharmacy_name}</h3>
                  <span className={`badge ${r.otc_or_rx === "OTC" ? "badge-otc" : "badge-rx"}`}>
                    {r.otc_or_rx}
                  </span>
                </div>
                <p className="card-area">{r.area} · {r.distance_km} km away</p>
                <p className="card-address">{r.address}</p>

                <div className="card-stats">
                  <div className="stat">
                    <span className="stat-label">Drug</span>
                    <span className="stat-value">{r.drug_name}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Price / unit</span>
                    <span className="stat-value">₹{r.unit_price_inr}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">In stock</span>
                    <span className="stat-value">{r.stock_qty} units</span>
                  </div>
                </div>

                <div className="card-footer">
                  <span className="pharmacist">👤 {r.pharmacist_name}</span>
                  <a href={`tel:${r.contact_number.replace(/\s/g, "")}`} className="btn-call">
                    Call {r.contact_number}
                  </a>
                </div>
                <p className="card-hours">Open {r.open_time} – {r.close_time}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <style>{`
        .locator-page { max-width: 1100px; margin: 0 auto; padding: 48px 32px 80px; }
        .locator-hero h1 {
          font-size: 2.4rem;
          color: var(--color-primary);
          max-width: 640px;
        }
        .hero-sub {
          margin-top: 12px;
          color: var(--color-text-muted);
          max-width: 560px;
          font-size: 1.02rem;
          line-height: 1.5;
        }
        .search-row {
          display: flex;
          gap: 10px;
          margin-top: 28px;
          max-width: 600px;
        }
        .search-row input {
          flex: 1;
          padding: 14px 16px;
          border: 1.5px solid var(--color-border);
          border-radius: var(--radius-md);
          font-size: 1rem;
          font-family: var(--font-body);
          background: var(--color-surface);
        }
        .search-row input:focus { border-color: var(--color-primary-light); }
        .btn-primary {
          background: var(--color-primary);
          color: white;
          border: none;
          padding: 14px 26px;
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: 0.98rem;
          transition: background 0.15s;
        }
        .btn-primary:hover { background: var(--color-primary-light); }
        .btn-primary:disabled { opacity: 0.6; cursor: default; }
        .location-row { margin-top: 16px; }
        .btn-ghost {
          background: transparent;
          border: 1.5px dashed var(--color-border);
          padding: 9px 16px;
          border-radius: var(--radius-md);
          color: var(--color-text-muted);
          font-weight: 500;
        }
        .btn-ghost:hover { border-color: var(--color-primary-light); color: var(--color-primary); }
        .loc-status { font-size: 0.92rem; color: var(--color-text-muted); }
        .loc-status.success { color: var(--color-success); }
        .loc-status.warn { color: var(--color-accent); }
        .btn-link {
          background: none; border: none; color: var(--color-primary); font-weight: 600;
          text-decoration: underline; padding: 0; font-size: 0.92rem;
        }
        .alert-error {
          margin-top: 24px;
          background: #FBEAE8;
          color: var(--color-danger);
          padding: 14px 18px;
          border-radius: var(--radius-md);
          font-size: 0.92rem;
        }
        .results-section { margin-top: 44px; }
        .results-header h2 {
          font-size: 1.2rem;
          font-family: var(--font-body);
          font-weight: 700;
          color: var(--color-text);
        }
        .empty-state {
          margin-top: 16px;
          padding: 24px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          color: var(--color-text-muted);
        }
        .results-grid {
          margin-top: 20px;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 18px;
        }
        .pharmacy-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: 20px;
        }
        .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
        .card-top h3 { font-size: 1.05rem; color: var(--color-text); }
        .badge {
          font-size: 0.7rem;
          font-weight: 700;
          padding: 3px 9px;
          border-radius: 20px;
          white-space: nowrap;
        }
        .badge-otc { background: #E3F2EC; color: var(--color-success); }
        .badge-rx { background: var(--color-accent-soft); color: #966319; }
        .card-area { color: var(--color-text-muted); font-size: 0.85rem; margin-top: 4px; }
        .card-address { color: var(--color-text-muted); font-size: 0.82rem; margin-top: 2px; }
        .card-stats {
          display: flex;
          gap: 16px;
          margin-top: 16px;
          padding-top: 14px;
          border-top: 1px solid var(--color-border);
        }
        .stat { display: flex; flex-direction: column; gap: 2px; }
        .stat-label { font-size: 0.7rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
        .stat-value { font-size: 0.92rem; font-weight: 600; }
        .card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 16px;
          flex-wrap: wrap;
          gap: 8px;
        }
        .pharmacist { font-size: 0.85rem; color: var(--color-text-muted); }
        .btn-call {
          background: var(--color-accent);
          color: #3A2700;
          font-weight: 700;
          font-size: 0.82rem;
          padding: 8px 14px;
          border-radius: var(--radius-sm);
        }
        .card-hours { margin-top: 10px; font-size: 0.78rem; color: var(--color-text-muted); }
      `}</style>
    </div>
  );
}
