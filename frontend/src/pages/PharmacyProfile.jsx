import { useState, useEffect } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export default function PharmacyProfile() {
  const { session } = useAuth();
  const token = session?.token;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const [formData, setFormData] = useState({
    pharmacy_name: "",
    area: "",
    address: "",
    contact_number: "",
    open_time: "",
    close_time: "",
    latitude: "",
    longitude: ""
  });

  useEffect(() => {
    async function fetchProfile() {
      if (!token) return;
      try {
        setLoading(true);
        const res = await api.getPharmacyProfile(token);
        if (res.profile) {
          setFormData({
            pharmacy_name: res.profile.pharmacy_name || "",
            area: res.profile.area || "",
            address: res.profile.address || "",
            contact_number: res.profile.contact_number || "",
            open_time: res.profile.open_time || "08:00",
            close_time: res.profile.close_time || "22:00",
            latitude: res.profile.latitude || "",
            longitude: res.profile.longitude || ""
          });
        }
      } catch (err) {
        setError("Failed to load profile: " + err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, [token]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const payload = {
        ...formData,
        latitude: formData.latitude ? parseFloat(formData.latitude) : null,
        longitude: formData.longitude ? parseFloat(formData.longitude) : null
      };
      
      await api.updatePharmacyProfile(token, payload);
      setMessage("Profile updated successfully!");
    } catch (err) {
      setError("Failed to update profile: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: "40px", textAlign: "center" }}>Loading Profile...</div>;

  return (
    <div className="profile-page">
      <div className="profile-container">
        <h1>Pharmacy Profile</h1>
        <p className="subtitle">Update your branch details and location.</p>

        {message && <div className="alert alert-success">{message}</div>}
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="profile-form">
          <div className="form-group">
            <label>Pharmacy Name</label>
            <input
              type="text"
              name="pharmacy_name"
              value={formData.pharmacy_name}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group half">
              <label>Area</label>
              <input
                type="text"
                name="area"
                value={formData.area}
                onChange={handleChange}
                placeholder="e.g. Andheri East"
              />
            </div>
            <div className="form-group half">
              <label>Contact Number</label>
              <input
                type="text"
                name="contact_number"
                value={formData.contact_number}
                onChange={handleChange}
                placeholder="+91 9999999999"
              />
            </div>
          </div>

          <div className="form-group">
            <label>Address</label>
            <textarea
              name="address"
              value={formData.address}
              onChange={handleChange}
              rows="3"
            />
          </div>

          <div className="form-row">
            <div className="form-group half">
              <label>Open Time</label>
              <input
                type="time"
                name="open_time"
                value={formData.open_time}
                onChange={handleChange}
              />
            </div>
            <div className="form-group half">
              <label>Close Time</label>
              <input
                type="time"
                name="close_time"
                value={formData.close_time}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="form-section-title">
            <h3>Location Coordinates</h3>
            <p className="help-text">
              Enter precise GPS coordinates so patients can find you in the MedLocator.
              You can find these by dropping a pin on Google Maps.
            </p>
          </div>

          <div className="form-row">
            <div className="form-group half">
              <label>Latitude</label>
              <input
                type="number"
                step="any"
                name="latitude"
                value={formData.latitude}
                onChange={handleChange}
                placeholder="e.g. 19.0760"
                required
              />
            </div>
            <div className="form-group half">
              <label>Longitude</label>
              <input
                type="number"
                step="any"
                name="longitude"
                value={formData.longitude}
                onChange={handleChange}
                placeholder="e.g. 72.8777"
                required
              />
            </div>
          </div>

          <button type="submit" className="btn-save" disabled={saving}>
            {saving ? "Saving..." : "Save Profile"}
          </button>
        </form>
      </div>

      <style>{`
        .profile-page {
          padding: 40px 20px;
          display: flex;
          justify-content: center;
          min-height: calc(100vh - 70px);
          background: var(--color-bg);
        }
        .profile-container {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: 40px;
          max-width: 650px;
          width: 100%;
          box-shadow: 0 4px 12px rgba(0,0,0,0.03);
        }
        .profile-container h1 {
          margin: 0 0 5px 0;
          color: var(--color-primary);
          font-size: 1.8rem;
        }
        .subtitle {
          color: var(--color-text-muted);
          margin-bottom: 24px;
        }
        .alert {
          padding: 12px 16px;
          border-radius: var(--radius-md);
          margin-bottom: 24px;
        }
        .alert-success {
          background: #EDF6F1;
          color: var(--color-success);
          border: 1px solid #CFE6DA;
        }
        .alert-error {
          background: #FBEAE8;
          color: var(--color-danger);
          border: 1px solid #F5C6C1;
        }
        .profile-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .form-row {
          display: flex;
          gap: 20px;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .form-group.half {
          flex: 1;
        }
        .form-group label {
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--color-text);
        }
        .form-group input, .form-group textarea {
          padding: 10px 12px;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          font-family: var(--font-body);
          font-size: 1rem;
        }
        .form-group input:focus, .form-group textarea:focus {
          border-color: var(--color-primary);
          outline: none;
        }
        .form-section-title {
          margin-top: 10px;
          padding-top: 20px;
          border-top: 1px solid var(--color-border);
        }
        .form-section-title h3 {
          margin: 0 0 5px 0;
          font-size: 1.2rem;
          color: var(--color-text);
        }
        .help-text {
          margin: 0;
          font-size: 0.85rem;
          color: var(--color-text-muted);
          line-height: 1.4;
        }
        .btn-save {
          background: var(--color-primary);
          color: white;
          border: none;
          padding: 14px;
          border-radius: var(--radius-md);
          font-size: 1.05rem;
          font-weight: bold;
          cursor: pointer;
          margin-top: 10px;
          transition: background 0.2s;
        }
        .btn-save:hover {
          background: var(--color-primary-light);
        }
        .btn-save:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
