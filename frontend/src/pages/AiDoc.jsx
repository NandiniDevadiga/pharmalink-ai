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
          {/* Section: Alternates */}
          {advice.alternatives && advice.alternatives.length > 0 && (
            <div className="advice-card full-width">
              <h3>🔄 Alternative Medicines</h3>
              <p className="card-desc">Suggested substitute medications with the same or equivalent clinical formulations:</p>
              <div className="chips-list">
                {advice.alternatives.map((alt, idx) => (
                  <span key={idx} className="alt-chip">{alt}</span>
                ))}
              </div>
            </div>
          )}

          {/* Section: Lifestyle advice */}
          <div className="advice-grid">
            <div className="advice-card">
              <h3>🥦 Diet & Nutrition</h3>
              <ul>
                {advice.diet.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="advice-card">
              <h3>🏃 Activity & Exercises</h3>
              <ul>
                {advice.activity.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="advice-card">
              <h3>🧘 Habits to Avoid</h3>
              <ul>
                {advice.avoid.map((item, idx) => (
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
