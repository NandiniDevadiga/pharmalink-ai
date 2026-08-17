import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";

export default function Login() {
  const [isRegistering, setIsRegistering] = useState(false);
  const [step, setStep] = useState(1); // Multi-step registration: 1=Account, 2=Branch Details
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  // Role is always 'pharmacy' on the public page. Admin creation is done in the Admin Panel.
  const role = "pharmacy";
  const [pharmacyId, setPharmacyId] = useState("");
  const [pharmacyName, setPharmacyName] = useState("");
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [openTime, setOpenTime] = useState("08:00");
  const [closeTime, setCloseTime] = useState("22:00");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");

  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from || "/dashboard";

  function resetForm() {
    setStep(1); setUsername(""); setPassword(""); setConfirmPassword("");
    setPharmacyId(""); setPharmacyName(""); setArea("");
    setAddress(""); setContactNumber(""); setOpenTime("08:00"); setCloseTime("22:00");
    setLatitude(""); setLongitude(""); setError(null); setSuccessMsg(null);
  }

  function handleNextStep(e) {
    e.preventDefault();
    setError(null);
    if (!username.trim()) return setError("Username cannot be empty.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirmPassword) return setError("Passwords do not match.");
    setStep(2);
  }

  async function handleSubmitPharmacy(e) {
    e.preventDefault();
    setError(null);
    if (!pharmacyId.trim()) return setError("Pharmacy ID is required.");
    if (!pharmacyName.trim()) return setError("Pharmacy Name is required.");
    setLoading(true);
    try {
      await api.register({
        username: username.trim(), password, role,
        pharmacyId: pharmacyId.trim(), pharmacyName: pharmacyName.trim(),
        area: area.trim(), address: address.trim(),
        contactNumber: contactNumber.trim(), openTime, closeTime,
        latitude: parseFloat(latitude) || null,
        longitude: parseFloat(longitude) || null,
      });
      setSuccessMsg("🎉 Registration successful! You can now log in.");
      resetForm();
      setIsRegistering(false);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const unameClean = username.trim();
      if (!unameClean) throw new Error("Username is required.");
      if (!password) throw new Error("Password is required.");
      await login(unameClean, password);
      navigate(redirectTo, { replace: true });
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  function fillDemo(user, pass) {
    setUsername(user); setPassword(pass); setIsRegistering(false); setError(null);
  }

  const EyeIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      {showPwd
        ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>
        : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
      }
    </svg>
  );

  return (
    <div className="lp-root">

      {/* Animated background blobs */}
      <div className="lp-blob lp-blob-1" />
      <div className="lp-blob lp-blob-2" />

      <div className={`lp-card ${isRegistering && role === "pharmacy" ? "lp-card--wide" : ""}`}>
        {/* Brand */}
        <div className="lp-brand">
          <div className="lp-brand-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C8 6 5 10.5 5 14a7 7 0 0014 0c0-3.5-3-8-7-12z" fill="white" />
              <circle cx="12" cy="14.5" r="2.4" fill="rgba(255,255,255,0.6)" />
            </svg>
          </div>
          <span className="lp-brand-name">PharmaLink</span>
        </div>

        <h2 className="lp-title">
          {isRegistering ? (step === 2 ? "📍 Branch Details" : "👤 Create Account") : "Welcome back"}
        </h2>
        <p className="lp-subtitle">
          {isRegistering
            ? (step === 2 ? "Tell us about your pharmacy branch." : "Set up your login credentials.")
            : "Sign in to your pharmacy staff portal."}
        </p>

        {/* Step indicator for pharmacy registration */}
        {isRegistering && (
          <div className="lp-steps">
            <div className={`lp-step ${step >= 1 ? "lp-step--done" : ""}`}>
              <div className="lp-step-dot">{step > 1 ? "✓" : "1"}</div>
              <span>Account</span>
            </div>
            <div className="lp-step-line" />
            <div className={`lp-step ${step >= 2 ? "lp-step--done" : ""}`}>
              <div className="lp-step-dot">2</div>
              <span>Branch</span>
            </div>
          </div>
        )}

        {successMsg && (
          <div className="lp-alert lp-alert--success">
            <span>✅</span> {successMsg}
          </div>
        )}
        {error && (
          <div className="lp-alert lp-alert--error">
            <span>⚠️</span> {error}
          </div>
        )}

        {/* ─── LOGIN FORM ─── */}
        {!isRegistering && (
          <form onSubmit={handleLogin} className="lp-form">
            <div className="lp-field">
              <label className="lp-label">Username</label>
              <div className="lp-input-wrap">
                <span className="lp-input-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                </span>
                <input type="text" placeholder="e.g. ph001 or admin" value={username} onChange={e => setUsername(e.target.value)} autoFocus />
              </div>
            </div>

            <div className="lp-field">
              <label className="lp-label">Password</label>
              <div className="lp-input-wrap">
                <span className="lp-input-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                </span>
                <input type={showPwd ? "text" : "password"} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
                <button type="button" className="lp-eye-btn" onClick={() => setShowPwd(!showPwd)}><EyeIcon /></button>
              </div>
            </div>

            <button type="submit" className="lp-btn-primary" disabled={loading}>
              {loading ? <span className="lp-spinner" /> : null}
              {loading ? "Signing in…" : "Sign In →"}
            </button>
          </form>
        )}

        {/* ─── STEP 1: ACCOUNT INFO ─── */}
        {isRegistering && step === 1 && (
          <form onSubmit={handleNextStep} className="lp-form">


            <div className="lp-field">
              <label className="lp-label">Username</label>
              <div className="lp-input-wrap">
                <span className="lp-input-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg></span>
                <input type="text" placeholder={role === "pharmacy" ? "e.g. ph001" : "e.g. admin2"} value={username} onChange={e => setUsername(e.target.value)} autoFocus />
              </div>
            </div>

            <div className="lp-field">
              <label className="lp-label">Password</label>
              <div className="lp-input-wrap">
                <span className="lp-input-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg></span>
                <input type={showPwd ? "text" : "password"} placeholder="Min. 6 characters" value={password} onChange={e => setPassword(e.target.value)} />
                <button type="button" className="lp-eye-btn" onClick={() => setShowPwd(!showPwd)}><EyeIcon /></button>
              </div>
            </div>

            <div className="lp-field">
              <label className="lp-label">Confirm Password</label>
              <div className="lp-input-wrap">
                <span className="lp-input-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg></span>
                <input type={showPwd ? "text" : "password"} placeholder="Repeat password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
              </div>
              {confirmPassword && password !== confirmPassword && <p className="lp-field-hint lp-field-hint--err">Passwords don't match</p>}
              {confirmPassword && password === confirmPassword && <p className="lp-field-hint lp-field-hint--ok">✓ Passwords match</p>}
            </div>

            <button type="submit" className="lp-btn-primary">
              Next: Branch Details →
            </button>
          </form>
        )}

        {/* ─── STEP 2: BRANCH DETAILS ─── */}
        {isRegistering && step === 2 && role === "pharmacy" && (
          <form onSubmit={handleSubmitPharmacy} className="lp-form">
            <div className="lp-2col">
              <div className="lp-field">
                <label className="lp-label">Pharmacy ID <span className="lp-required">*</span></label>
                <div className="lp-input-wrap">
                  <span className="lp-input-icon">#</span>
                  <input type="text" placeholder="e.g. PH013" value={pharmacyId} onChange={e => setPharmacyId(e.target.value)} autoFocus />
                </div>
              </div>
              <div className="lp-field">
                <label className="lp-label">Pharmacy Name <span className="lp-required">*</span></label>
                <div className="lp-input-wrap">
                  <span className="lp-input-icon">🏥</span>
                  <input type="text" placeholder="e.g. Andheri East Chemist" value={pharmacyName} onChange={e => setPharmacyName(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="lp-2col">
              <div className="lp-field">
                <label className="lp-label">Area</label>
                <div className="lp-input-wrap">
                  <span className="lp-input-icon">📍</span>
                  <input type="text" placeholder="e.g. Andheri" value={area} onChange={e => setArea(e.target.value)} />
                </div>
              </div>
              <div className="lp-field">
                <label className="lp-label">Contact Number</label>
                <div className="lp-input-wrap">
                  <span className="lp-input-icon">📞</span>
                  <input type="tel" placeholder="+91 9999999999" value={contactNumber} onChange={e => setContactNumber(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="lp-field">
              <label className="lp-label">Full Address</label>
              <div className="lp-input-wrap">
                <span className="lp-input-icon">🏠</span>
                <input type="text" placeholder="e.g. Shop No. 1, Main Road, Andheri West" value={address} onChange={e => setAddress(e.target.value)} />
              </div>
            </div>

            <div className="lp-2col">
              <div className="lp-field">
                <label className="lp-label">⏰ Open Time</label>
                <input className="lp-time-input" type="time" value={openTime} onChange={e => setOpenTime(e.target.value)} />
              </div>
              <div className="lp-field">
                <label className="lp-label">⏰ Close Time</label>
                <input className="lp-time-input" type="time" value={closeTime} onChange={e => setCloseTime(e.target.value)} />
              </div>
            </div>

            <div className="lp-coords-section">
              <p className="lp-coords-label">📌 GPS Coordinates <span className="lp-optional">(optional, for map locator)</span></p>
              <div className="lp-2col">
                <div className="lp-field">
                  <label className="lp-label">Latitude</label>
                  <input className="lp-plain-input" type="number" step="0.000001" placeholder="e.g. 19.0760" value={latitude} onChange={e => setLatitude(e.target.value)} />
                </div>
                <div className="lp-field">
                  <label className="lp-label">Longitude</label>
                  <input className="lp-plain-input" type="number" step="0.000001" placeholder="e.g. 72.8777" value={longitude} onChange={e => setLongitude(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="lp-btn-row">
              <button type="button" className="lp-btn-back" onClick={() => { setStep(1); setError(null); }}>← Back</button>
              <button type="submit" className="lp-btn-primary" style={{ flex: 1 }} disabled={loading}>
                {loading ? <><span className="lp-spinner" /> Registering…</> : "✅ Complete Registration"}
              </button>
            </div>
          </form>
        )}

        {/* Toggle link */}
        <div className="lp-toggle">
          {isRegistering ? (
            <span>Already have an account? <button type="button" className="lp-toggle-btn" onClick={() => { setIsRegistering(false); resetForm(); }}>Login here</button></span>
          ) : (
            <span>New branch?  <button type="button" className="lp-toggle-btn" onClick={() => { setIsRegistering(true); resetForm(); }}>Register here</button></span>
          )}
        </div>
      </div>

      <style>{`
        .lp-root {
          min-height: calc(100vh - 70px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 30px 20px;
          background: var(--color-bg);
          position: relative;
          overflow: hidden;
        }

        /* Animated background blobs */
        .lp-blob {
          position: fixed;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.12;
          pointer-events: none;
          animation: lp-float 8s ease-in-out infinite alternate;
        }
        .lp-blob-1 {
          width: 400px; height: 400px;
          background: var(--color-primary);
          top: -100px; left: -100px;
        }
        .lp-blob-2 {
          width: 300px; height: 300px;
          background: var(--color-accent);
          bottom: -80px; right: -80px;
          animation-delay: -4s;
        }
        @keyframes lp-float {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(30px, 20px) scale(1.05); }
        }

        /* Card */
        .lp-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 20px;
          padding: 36px 40px;
          width: 100%;
          max-width: 460px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.08);
          position: relative;
          z-index: 1;
          transition: max-width 0.4s ease;
        }
        .lp-card--wide { max-width: 620px; }

        /* Brand */
        .lp-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 24px;
        }
        .lp-brand-icon {
          width: 38px; height: 38px;
          background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .lp-brand-name {
          font-family: var(--font-display);
          font-weight: 800;
          font-size: 1.25rem;
          color: var(--color-primary);
          letter-spacing: -0.5px;
        }

        .lp-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--color-text);
          margin: 0 0 6px;
        }
        .lp-subtitle {
          font-size: 0.88rem;
          color: var(--color-text-muted);
          margin: 0 0 24px;
        }

        /* Step Indicator */
        .lp-steps {
          display: flex;
          align-items: center;
          gap: 0;
          margin-bottom: 24px;
        }
        .lp-step {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.82rem;
          color: var(--color-text-muted);
        }
        .lp-step--done { color: var(--color-primary); }
        .lp-step-dot {
          width: 28px; height: 28px;
          border-radius: 50%;
          background: var(--color-border);
          display: flex; align-items: center; justify-content: center;
          font-size: 0.78rem;
          font-weight: 700;
          transition: all 0.2s;
        }
        .lp-step--done .lp-step-dot {
          background: var(--color-primary);
          color: white;
        }
        .lp-step-line {
          flex: 1;
          height: 2px;
          background: var(--color-border);
          margin: 0 10px;
        }

        /* Alert */
        .lp-alert {
          padding: 12px 16px;
          border-radius: 10px;
          font-size: 0.88rem;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .lp-alert--success { background: #EDF6F1; color: #1A7A4B; border: 1px solid #A8DFC2; }
        .lp-alert--error { background: #FEF0EE; color: #C0392B; border: 1px solid #F5C6C1; }

        /* Form */
        .lp-form { display: flex; flex-direction: column; gap: 16px; }
        .lp-field { display: flex; flex-direction: column; gap: 6px; }
        .lp-label { font-size: 0.82rem; font-weight: 600; color: var(--color-text); }
        .lp-required { color: var(--color-danger); }
        .lp-optional { font-weight: 400; color: var(--color-text-muted); font-size: 0.78rem; }

        .lp-2col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }

        /* Input */
        .lp-input-wrap {
          display: flex;
          align-items: center;
          border: 1.5px solid var(--color-border);
          border-radius: 10px;
          background: var(--color-bg);
          transition: border-color 0.2s, box-shadow 0.2s;
          overflow: hidden;
        }
        .lp-input-wrap:focus-within {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px rgba(var(--color-primary-rgb, 37,99,235), 0.1);
        }
        .lp-input-icon {
          padding: 0 12px;
          color: var(--color-text-muted);
          font-size: 0.85rem;
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }
        .lp-input-wrap input {
          flex: 1;
          border: none;
          background: transparent;
          padding: 12px 10px 12px 0;
          font-size: 0.95rem;
          font-family: var(--font-body);
          color: var(--color-text);
          outline: none;
        }
        .lp-eye-btn {
          background: none;
          border: none;
          padding: 0 12px;
          color: var(--color-text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
        }
        .lp-time-input, .lp-plain-input {
          width: 100%;
          padding: 12px 14px;
          border: 1.5px solid var(--color-border);
          border-radius: 10px;
          font-size: 0.95rem;
          background: var(--color-bg);
          font-family: var(--font-body);
          color: var(--color-text);
          outline: none;
          box-sizing: border-box;
        }
        .lp-time-input:focus, .lp-plain-input:focus {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px rgba(37,99,235,0.1);
        }

        .lp-field-hint { font-size: 0.78rem; margin: 0; }
        .lp-field-hint--err { color: var(--color-danger); }
        .lp-field-hint--ok { color: var(--color-success); }

        /* Role Cards */
        .lp-role-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .lp-role-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 16px 12px;
          border: 2px solid var(--color-border);
          border-radius: 12px;
          background: var(--color-bg);
          cursor: pointer;
          transition: all 0.2s;
        }
        .lp-role-card:hover { border-color: var(--color-primary); }
        .lp-role-card--active {
          border-color: var(--color-primary);
          background: #EEF3FF;
          box-shadow: 0 0 0 3px rgba(37,99,235,0.1);
        }
        .lp-role-icon { font-size: 1.5rem; }
        .lp-role-card strong { font-size: 0.85rem; color: var(--color-text); }
        .lp-role-card span { font-size: 0.75rem; color: var(--color-text-muted); }

        /* Coords section */
        .lp-coords-section {
          background: var(--color-bg);
          border: 1px dashed var(--color-border);
          border-radius: 10px;
          padding: 14px;
        }
        .lp-coords-label { font-size: 0.82rem; font-weight: 600; margin: 0 0 10px; color: var(--color-text); }

        /* Buttons */
        .lp-btn-primary {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
          color: white;
          border: none;
          padding: 14px;
          border-radius: 12px;
          font-weight: 700;
          font-size: 0.95rem;
          cursor: pointer;
          transition: opacity 0.2s, transform 0.1s;
        }
        .lp-btn-primary:hover { opacity: 0.92; transform: translateY(-1px); }
        .lp-btn-primary:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
        .lp-btn-back {
          background: var(--color-bg);
          border: 1.5px solid var(--color-border);
          color: var(--color-text);
          padding: 14px 20px;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
          font-size: 0.95rem;
        }
        .lp-btn-back:hover { border-color: var(--color-primary); color: var(--color-primary); }
        .lp-btn-row { display: flex; gap: 10px; }

        /* Spinner */
        .lp-spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(255,255,255,0.4);
          border-top-color: white;
          border-radius: 50%;
          animation: lp-spin 0.7s linear infinite;
          display: inline-block;
        }
        @keyframes lp-spin { to { transform: rotate(360deg); } }

        /* Demo chips */
        .lp-demo-section { margin-top: 4px; }
        .lp-demo-label {
          font-size: 0.73rem;
          color: var(--color-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin: 0 0 10px;
          text-align: center;
        }
        .lp-demo-chips { display: flex; flex-direction: column; gap: 8px; }
        .lp-demo-chip {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          border: 1.5px solid var(--color-border);
          border-radius: 10px;
          background: var(--color-bg);
          cursor: pointer;
          text-align: left;
          transition: border-color 0.2s;
        }
        .lp-demo-chip:hover { border-color: var(--color-primary); }
        .lp-chip-icon { font-size: 1.3rem; }
        .lp-demo-chip div { display: flex; flex-direction: column; gap: 1px; }
        .lp-demo-chip strong { font-size: 0.82rem; color: var(--color-text); }
        .lp-demo-chip span { font-size: 0.75rem; color: var(--color-text-muted); }

        /* Toggle */
        .lp-toggle {
          margin-top: 20px;
          text-align: center;
          font-size: 0.85rem;
          color: var(--color-text-muted);
        }
        .lp-toggle-btn {
          background: none; border: none;
          color: var(--color-primary);
          font-weight: 700;
          cursor: pointer;
          text-decoration: underline;
          font-size: 0.85rem;
        }

        /* Info banner */
        .lp-info-banner {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 14px;
          background: #EEF3FF;
          border: 1px solid #BFCFFE;
          border-radius: 10px;
          font-size: 0.85rem;
          color: #3A4A6B;
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}
