// In development: uses http://127.0.0.1:8000 (your local backend)
// In production (Vercel): uses VITE_API_URL environment variable
// which you set in Vercel dashboard to your Railway backend URL
// Connects to local backend in development, and Render backend in production
export const BASE_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://127.0.0.1:8000"
  : "https://pharmalink-ai.onrender.com";
async function request(path, options = {}) {
  const requestHeaders = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: requestHeaders
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("__UNAUTHORIZED__");
    if (res.status === 403) throw new Error("__FORBIDDEN__");
    throw new Error(`API error ${res.status}`);
  }
  return res.json();
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

export const api = {
  searchMedicine: (drugName, lat, lon, radius = 15) =>
    request(`/locator/search?drug_name=${encodeURIComponent(drugName)}&user_lat=${lat}&user_lon=${lon}&max_distance_km=${radius}`),

  getAdvice: (condition) =>
    request(`/aidoc/advice`, { method: "POST", body: JSON.stringify({ condition }) }),

  getConditionsList: () => request(`/aidoc/conditions`),

  uploadPrescription: async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${BASE_URL}/aidoc/upload-prescription`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    return res.json();
  },

  // All dashboard calls require a token now, and are scoped server-side to
  // the logged-in pharmacy (or full network for admin).
  getDashboardSummary: (token) => request(`/dashboard/summary`, { headers: authHeaders(token) }),
  getSalesTrend: (token, granularity = "monthly") =>
    request(`/dashboard/sales-trend?granularity=${granularity}`, { headers: authHeaders(token) }),
  getCategoryBreakdown: (token) => request(`/dashboard/category-breakdown`, { headers: authHeaders(token) }),
  getTopDrugs: (token, limit = 8) => request(`/dashboard/top-drugs?limit=${limit}`, { headers: authHeaders(token) }),
  getBranchPerformance: (token) => request(`/dashboard/branch-performance`, { headers: authHeaders(token) }),
  getLowStock: (token, threshold = 20) => request(`/dashboard/low-stock?threshold=${threshold}`, { headers: authHeaders(token) }),
  getOtcVsRx: (token) => request(`/dashboard/otc-vs-rx`, { headers: authHeaders(token) }),
  getQuarterlySales: (token) => request(`/dashboard/quarterly-sales`, { headers: authHeaders(token) }),
  getSeasonalHeatmap: (token) => request(`/dashboard/seasonal-heatmap`, { headers: authHeaders(token) }),
  getForecast: (token, monthsAhead = 1) => request(`/dashboard/forecast?months_ahead=${monthsAhead}`, { headers: authHeaders(token) }),
  getUnmetDemand: (token) => request(`/dashboard/unmet-demand`, { headers: authHeaders(token) }),

  // Admin panel - manage pharmacy/admin accounts (admin role only, enforced server-side too)
  getUsers: (token) => request(`/admin/users`, { headers: authHeaders(token) }),
  resetPassword: (token, username, newPassword) =>
    request(`/admin/reset-password`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ username, new_password: newPassword }),
    }),
  setActive: (token, username, active) =>
    request(`/admin/set-active`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ username, active }),
    }),
  bulkUpload: (token, data) =>
    request(`/admin/bulk-upload`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(data),
    }),
  register: (payload) =>
    request(`/auth/register`, {
      method: "POST",
      body: JSON.stringify({
        username: payload.username,
        password: payload.password,
        role: payload.role,
        pharmacy_id: payload.pharmacyId,
        pharmacy_name: payload.pharmacyName,
        area: payload.area,
        address: payload.address,
        contact_number: payload.contactNumber,
        open_time: payload.openTime,
        close_time: payload.closeTime,
        latitude: payload.latitude,
        longitude: payload.longitude,
      }),
    }),
  uploadStock: (token, data) =>
    request(`/dashboard/bulk-upload-stock`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(data),
    }),
  getPharmacyProfile: (token) =>
    request(`/pharmacy/profile`, { headers: authHeaders(token) }),
  updatePharmacyProfile: (token, data) =>
    request(`/pharmacy/profile`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify(data),
    }),
  getPharmacyStock: (token) => 
    request(`/pharmacy/stock`, { headers: authHeaders(token) }),
  searchGlobalMedicines: (token, q) =>
    request(`/pharmacy/medicines/search?q=${encodeURIComponent(q)}`, { headers: authHeaders(token) }),
  updatePharmacyStock: (token, itemData) => 
    request(`/pharmacy/stock`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(itemData),
    }),
  recordSale: (token, items) => 
    request(`/pharmacy/sales`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ items }),
    }),
};

