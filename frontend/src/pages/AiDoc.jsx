import { useState } from "react";
import { api } from "../api/client";

const QUICK_CONDITIONS = [
  "diabetes", "high blood pressure", "headache", "eczema", "acidity",
  "back pain", "insomnia", "anxiety", "hypothyroidism",
];

export default function AiDoc() {
  const [condition, setCondition] = useState("");
  const [advice, setAdvice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function fetchAdvice(value) {
    const c = (value ?? condition).trim();
    if (!c) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAdvice(c);
      setAdvice(data);
      setCondition(c);
    } catch (err) {
      setError("Could not reach the server. Make sure the backend is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="aidoc-page">
      <section className="aidoc-hero">
        <h1>AI Doc — Substitutes & Lifestyle Guide</h1>
        <p className="hero-sub">
          Type a medicine or health condition to find its alternatives and healthy lifestyle choices (food, activity) tailored to the condition.
        </p>

        <form className="search-row" onSubmit={(e) => { e.preventDefault(); fetchAdvice(); }}>
          <input
            type="text"
            placeholder="e.g. headache, eczema, diabetes..."
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            aria-label="Health condition"
          />
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Thinking..." : "Get Advice"}
          </button>
        </form>

        <div className="quick-chips">
          <span className="chip-label">Quick try:</span>
          {QUICK_CONDITIONS.map((cond) => (
            <button
              key={cond}
              type="button"
              className="chip"
              onClick={() => {
                setCondition(cond);
                fetchAdvice(cond);
              }}
            >
              {cond}
            </button>
          ))}
        </div>
      </section>

      {error && <div className="alert-error" style={{ maxWidth: "600px" }}>{error}</div>}

      {advice && (
        <div className="advice-container">
          <p className="disclaimer-alert" style={{ fontSize: "0.85rem", fontStyle: "italic", background: "#FFF3CD", border: "1px solid #FFEBAA", color: "#856404", padding: "12px", borderRadius: "var(--radius-md)", marginBottom: "20px" }}>
            ⚠️ <strong>Disclaimer:</strong> {advice.disclaimer}
          </p>

          {/* Section: Alternates */}
          {advice.alternative_medicines && advice.alternative_medicines.length > 0 && (
            <div className="advice-card full-width" style={{ marginBottom: "24px" }}>
              <h3>🔄 Equivalent Chemical Alternates</h3>
              <p className="card-desc">Suggested substitute medications with the same or equivalent clinical formulations in stock:</p>
              <div className="chips-list">
                {advice.alternative_medicines.map((alt, idx) => (
                  <span key={idx} className="alt-chip">{alt}</span>
                ))}
              </div>
            </div>
          )}

          {/* Section: Lifestyle advice */}
          <div className="advice-grid">
            <div className="advice-card">
              <h3>🥦 Diet & Nutrition Guidelines</h3>
              <div style={{ marginBottom: "14px" }}>
                <h4 style={{ color: "var(--color-success)", fontSize: "0.85rem", marginBottom: "6px" }}>Recommended Foods:</h4>
                <ul>
                  {advice.food_dos?.map((item, idx) => (
                    <li key={idx} style={{ listStyleType: "none", position: "relative", paddingLeft: "15px" }}>
                      <span style={{ position: "absolute", left: 0, color: "var(--color-success)" }}>✓</span> {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 style={{ color: "var(--color-danger)", fontSize: "0.85rem", marginBottom: "6px" }}>Foods to Avoid:</h4>
                <ul>
                  {advice.food_donts?.map((item, idx) => (
                    <li key={idx} style={{ listStyleType: "none", position: "relative", paddingLeft: "15px" }}>
                      <span style={{ position: "absolute", left: 0, color: "var(--color-danger)" }}>✗</span> {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="advice-card">
              <h3>🏃 Activity & Exercises</h3>
              <div style={{ marginBottom: "14px" }}>
                <h4 style={{ color: "var(--color-success)", fontSize: "0.85rem", marginBottom: "6px" }}>Do's:</h4>
                <ul>
                  {advice.activity_dos?.map((item, idx) => (
                    <li key={idx} style={{ listStyleType: "none", position: "relative", paddingLeft: "15px" }}>
                      <span style={{ position: "absolute", left: 0, color: "var(--color-success)" }}>✓</span> {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 style={{ color: "var(--color-danger)", fontSize: "0.85rem", marginBottom: "6px" }}>Avoid:</h4>
                <ul>
                  {advice.activity_donts?.map((item, idx) => (
                    <li key={idx} style={{ listStyleType: "none", position: "relative", paddingLeft: "15px" }}>
                      <span style={{ position: "absolute", left: 0, color: "var(--color-danger)" }}>✗</span> {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="advice-card">
              <h3>🧘 Habits & Suggestions</h3>
              <ul>
                {advice.other_suggestions?.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .aidoc-page {
          max-width: 1200px;
          margin: 0 auto;
          padding: 50px 32px 100px;
        }
        
        .aidoc-hero {
          margin-bottom: 40px;
        }
        .aidoc-hero h1 { font-size: 2.2rem; color: var(--color-primary); max-width: 680px; }
        .hero-sub {
          margin-top: 12px; color: var(--color-text-muted); max-width: 600px;
          font-size: 1.02rem; line-height: 1.5;
        }

        .search-row { display: flex; gap: 10px; margin-top: 30px; max-width: 600px; }
        .search-row input {
          flex: 1; padding: 14px 16px; border: 1.5px solid var(--color-border);
          border-radius: var(--radius-md); font-size: 1rem; font-family: var(--font-body);
          background: var(--color-surface);
        }
        .search-row input:focus { border-color: var(--color-primary-light); }
        .btn-primary {
          background: var(--color-primary); color: white; border: none;
          padding: 0 24px; border-radius: var(--radius-md); font-weight: 700;
          cursor: pointer; font-size: 0.95rem; transition: background 0.1s;
        }
        .btn-primary:hover { background: var(--color-primary-light); }
        .btn-primary:disabled { opacity: 0.6; }

        .quick-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 20px; align-items: center; max-width: 750px; }
        .chip-label { font-size: 0.82rem; color: var(--color-text-muted); font-weight: 600; margin-right: 4px; }
        .chip {
          background: var(--color-surface); border: 1.5px solid var(--color-border);
          border-radius: 20px; padding: 6px 14px; font-size: 0.82rem; font-weight: 500;
          color: var(--color-text-muted); cursor: pointer; transition: all 0.1s;
        }
        .chip:hover { border-color: var(--color-accent); color: var(--color-text); }

        .advice-container { margin-top: 40px; }
        
        .advice-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: 24px;
        }
        .advice-card.full-width {
          margin-bottom: 24px;
        }
        .advice-card h3 { font-size: 1.05rem; font-weight: 700; color: var(--color-primary); margin-bottom: 8px; }
        .card-desc { font-size: 0.88rem; color: var(--color-text-muted); margin-bottom: 16px; }
        
        .chips-list { display: flex; gap: 10px; flex-wrap: wrap; }
        .alt-chip {
          background: var(--color-accent-soft);
          color: #8C5B18;
          font-weight: 700;
          font-size: 0.88rem;
          padding: 8px 16px;
          border-radius: var(--radius-md);
          border: 1.5px solid #F0D9AE;
        }

        .advice-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        .advice-card ul { padding-left: 20px; margin: 0; }
        .advice-card li { font-size: 0.9rem; color: var(--color-text); line-height: 1.6; margin-bottom: 8px; }
        .advice-card li:last-child { margin-bottom: 0; }

        @media (max-width: 900px) {
          .advice-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
