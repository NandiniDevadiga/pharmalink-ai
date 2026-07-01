import { useState, useRef } from "react";
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

  // Prescription upload state
  const [uploading, setUploading] = useState(false);
  const [ocrResult, setOcrResult] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

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

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setOcrResult(null);
    try {
      const result = await api.uploadPrescription(file);
      setOcrResult(result);
      if (result.detected_condition) {
        setCondition(result.detected_condition);
        // Auto-fetch advice for the detected condition right away
        fetchAdvice(result.detected_condition);
      }
    } catch (err) {
      setUploadError("Could not process this image. You can still type your condition manually below.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="aidoc-page">
      <section className="aidoc-hero">
        <h1>AI Doc — lifestyle guidance, not prescriptions.</h1>
        <p className="hero-sub">
          Upload a prescription so I can read the diagnosis, or just type a condition below.
          AI Doc never recommends medicines — for that, always consult a licensed doctor or pharmacist.
        </p>

        <div className="upload-box">
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleFileSelect}
            id="prescription-upload"
            hidden
          />
          <label htmlFor="prescription-upload" className="upload-label">
            {uploading ? "Reading prescription..." : "📋 Upload a prescription image"}
          </label>
          <p className="upload-hint">
            Works best with printed/typed prescriptions. I'll look for the diagnosis only —
            never medicine names — and pre-fill the condition below if found.
          </p>
        </div>

        {uploadError && <div className="alert-error">{uploadError}</div>}

        {ocrResult && (
          <div className={`ocr-result ${ocrResult.detected_condition ? "ocr-found" : "ocr-not-found"}`}>
            <p className="ocr-message">
              {ocrResult.ocr_available === false
                ? "⚠️ OCR isn't set up on this server yet — please type your condition manually."
                : ocrResult.detected_condition
                  ? `✅ ${ocrResult.message} Pre-filled below — feel free to correct it.`
                  : `ℹ️ ${ocrResult.message}`}
            </p>
            {ocrResult.raw_text && (
              <details className="ocr-raw">
                <summary>See what was read from the image</summary>
                <pre>{ocrResult.raw_text}</pre>
              </details>
            )}
          </div>
        )}

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
          {QUICK_CONDITIONS.map((c) => (
            <button key={c} className="chip" onClick={() => fetchAdvice(c)} type="button">
              {c}
            </button>
          ))}
        </div>
      </section>

      {error && <div className="alert-error">{error}</div>}

      {advice && (
        <section className="advice-section">
          <div className="disclaimer-banner">⚕️ {advice.disclaimer}</div>

          <h2>
            Issue: <span className="issue-name">{advice.condition}</span>
            {advice.resolved_from_medicine && (
              <span className="resolved-tag">
                resolved from "{advice.original_input}"
              </span>
            )}
            {!advice.matched_known_condition && (
              <span className="generic-tag">general guidance — not a specific match yet</span>
            )}
          </h2>

          <div className="advice-grid">
            <div className="advice-card do-card">
              <h3>🍽️ Food — Do</h3>
              <ul>{advice.food_dos.map((item, i) => <li key={i}>{item}</li>)}</ul>
            </div>
            <div className="advice-card dont-card">
              <h3>🍽️ Food — Avoid</h3>
              <ul>{advice.food_donts.map((item, i) => <li key={i}>{item}</li>)}</ul>
            </div>
            <div className="advice-card do-card">
              <h3>🏃 Activity — Do</h3>
              <ul>{advice.activity_dos.map((item, i) => <li key={i}>{item}</li>)}</ul>
            </div>
            <div className="advice-card dont-card">
              <h3>🏃 Activity — Avoid</h3>
              <ul>{advice.activity_donts.map((item, i) => <li key={i}>{item}</li>)}</ul>
            </div>
            <div className="advice-card other-card wide-card">
              <h3>💡 Other Suggestions</h3>
              <ul>{advice.other_suggestions.map((item, i) => <li key={i}>{item}</li>)}</ul>
            </div>
          </div>
        </section>
      )}

      <style>{`
        .aidoc-page { max-width: 1100px; margin: 0 auto; padding: 48px 32px 80px; }
        .aidoc-hero h1 { font-size: 2.2rem; color: var(--color-primary); max-width: 680px; }
        .hero-sub {
          margin-top: 12px; color: var(--color-text-muted); max-width: 600px;
          font-size: 1.02rem; line-height: 1.5;
        }

        .upload-box {
          margin-top: 28px;
          max-width: 600px;
          background: var(--color-surface);
          border: 1.5px dashed var(--color-border);
          border-radius: var(--radius-lg);
          padding: 20px 24px;
        }
        .upload-label {
          display: inline-block;
          background: var(--color-primary);
          color: white;
          padding: 11px 20px;
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: 0.92rem;
          cursor: pointer;
        }
        .upload-label:hover { background: var(--color-primary-light); }
        .upload-hint {
          margin-top: 10px;
          font-size: 0.8rem;
          color: var(--color-text-muted);
          line-height: 1.4;
        }

        .ocr-result {
          margin-top: 16px;
          max-width: 600px;
          padding: 14px 18px;
          border-radius: var(--radius-md);
          font-size: 0.88rem;
        }
        .ocr-found { background: #EDF6F1; border: 1px solid #CFE6DA; color: var(--color-primary); }
        .ocr-not-found { background: var(--color-accent-soft); border: 1px solid #F0D9AE; color: #7A5316; }
        .ocr-message { margin: 0; }
        .ocr-raw { margin-top: 10px; }
        .ocr-raw summary { cursor: pointer; font-size: 0.8rem; font-weight: 600; }
        .ocr-raw pre {
          margin-top: 8px;
          background: rgba(0,0,0,0.04);
          padding: 10px 12px;
          border-radius: var(--radius-sm);
          font-size: 0.78rem;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .search-row { display: flex; gap: 10px; margin-top: 20px; max-width: 600px; }
        .search-row input {
          flex: 1; padding: 14px 16px; border: 1.5px solid var(--color-border);
          border-radius: var(--radius-md); font-size: 1rem; font-family: var(--font-body);
          background: var(--color-surface);
        }
        .search-row input:focus { border-color: var(--color-primary-light); }
        .btn-primary {
          background: var(--color-primary); color: white; border: none;
          padding: 14px 26px; border-radius: var(--radius-md); font-weight: 600;
          font-size: 0.98rem; transition: background 0.15s;
        }
        .btn-primary:hover { background: var(--color-primary-light); }
        .btn-primary:disabled { opacity: 0.6; cursor: default; }
        .quick-chips { margin-top: 18px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .chip-label { font-size: 0.85rem; color: var(--color-text-muted); margin-right: 4px; }
        .chip {
          background: var(--color-accent-soft); border: none; padding: 6px 14px;
          border-radius: 20px; font-size: 0.85rem; color: #966319; font-weight: 600;
          text-transform: capitalize;
        }
        .chip:hover { background: var(--color-accent); color: #3A2700; }
        .alert-error {
          margin-top: 24px; background: #FBEAE8; color: var(--color-danger);
          padding: 14px 18px; border-radius: var(--radius-md); font-size: 0.92rem;
          max-width: 600px;
        }
        .advice-section { margin-top: 40px; }
        .disclaimer-banner {
          background: #EDF6F1; color: var(--color-primary); border: 1px solid #CFE6DA;
          padding: 12px 18px; border-radius: var(--radius-md); font-size: 0.88rem;
          margin-bottom: 24px;
        }
        .advice-section h2 {
          font-size: 1.2rem; font-family: var(--font-body); font-weight: 700;
          margin-bottom: 18px;
        }
        .issue-name { color: var(--color-primary); text-transform: capitalize; }
        .resolved-tag {
          display: inline-block;
          margin-left: 10px;
          font-size: 0.7rem;
          font-weight: 600;
          color: var(--color-success);
          background: #E3F2EC;
          padding: 3px 9px;
          border-radius: 10px;
          vertical-align: middle;
          text-transform: none;
        }
        .generic-tag {
          display: inline-block;
          margin-left: 10px;
          font-size: 0.7rem;
          font-weight: 600;
          color: var(--color-text-muted);
          text-transform: none;
          background: var(--color-bg);
          padding: 3px 9px;
          border-radius: 10px;
          vertical-align: middle;
        }
        .advice-grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px;
        }
        .advice-card {
          background: var(--color-surface); border-radius: var(--radius-lg);
          padding: 20px; border: 1px solid var(--color-border);
        }
        .advice-card h3 { font-size: 1rem; font-family: var(--font-body); margin-bottom: 12px; }
        .do-card { border-left: 4px solid var(--color-success); }
        .dont-card { border-left: 4px solid var(--color-danger); }
        .other-card { border-left: 4px solid var(--color-accent); }
        .wide-card { grid-column: 1 / -1; }
        .advice-card ul { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }
        .advice-card li { font-size: 0.9rem; line-height: 1.4; color: var(--color-text); }
      `}</style>
    </div>
  );
}
