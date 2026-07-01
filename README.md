# Pharmalink AI

A two-phase pharmacy-tech project:

1. **Customer Phase** — Med Locator (find medicine near you, with price/stock/pharmacist
   contact) + AI Doc (lifestyle/food/activity guidance, never medicine recommendations).
2. **Pharmacy Dashboard** — PowerBI-style analytics dashboard for pharmacy network performance.

Built fully with free/open tools: React (Vite) + FastAPI + Recharts. No paid services,
no API keys, no Power BI Embedded subscription required.

---

## Project structure

```
pharmalink/
├── data/
│   ├── generate_dataset.py     # Generates the synthetic dataset (see "Dataset" below)
│   ├── pharmacies.csv          # 12 pharmacy branches with location, contact, hours
│   ├── stock.csv               # Per-branch medicine stock & pricing
│   └── sales_transactions.csv  # ~12,800 transactions over 12 months (for dashboard)
├── backend/
│   ├── main.py                 # FastAPI app: locator, aidoc, dashboard endpoints
│   └── requirements.txt
└── frontend/                   # React app (Vite)
    └── src/
        ├── pages/MedLocator.jsx
        ├── pages/AiDoc.jsx
        ├── pages/Dashboard.jsx
        ├── components/NavBar.jsx
        └── api/client.js
```

---

## Dataset — where it came from

Your mentor asked you to base your dataset on something real that's available online,
extending it with extra rows/details as needed. **This is exactly what this project does now** —
not "inspired by," but built directly on a real downloaded file.

**Real, downloaded base file (kept untouched as proof in `data/source/`):**
- [A-Z Medicine Dataset of India](https://www.kaggle.com/datasets/shudhanshusingh/az-medicine-dataset-of-india)
  (Kaggle, by shudhanshusingh) — **253,973 real Indian pharmaceutical products**, including
  real medicine names, real prices (as of Nov 2022), real manufacturers (7,600+ companies),
  pack sizes, and active ingredient compositions.
- This file is preserved exactly as downloaded at `data/source/A_Z_medicines_dataset_of_India.csv`
  — show this to your mentor as your starting dataset.

**What `generate_dataset.py` adds on top of the real file (the "extend it" part):**
1. **Category labelling** — each real medicine row is tagged with a pharmacology category
   (Analgesic, Antibiotic, Antidiabetic, Cardiovascular, etc.) based on its real active
   ingredient composition. This is standard ATC-style classification applied to real data,
   not invented data.
2. **Per-unit pricing** — computed directly from the real pack price divided by the real pack
   size (e.g. a real ₹223.42 strip of 10 tablets becomes a real ₹22.34 per-unit price). Pure
   arithmetic on real numbers, no fabrication.
3. **Pharmacy network, stock levels, and sales transactions** — these layers are genuinely
   synthetic, because no public dataset publishes per-store stock or transaction-level sales
   data (it's private commercial information no pharmacy chain releases). This is exactly the
   kind of "add on details/rows" your mentor described — the 439 real medicines selected from
   the real catalog are distributed across 12 synthetic Mumbai pharmacy branches with synthetic
   stock counts and a year of synthetic daily transactions.

**For your report**, you can describe this with full honesty: *"The drug catalog (names, prices,
manufacturers, compositions) is sourced directly from a real public dataset (A-Z Medicine Dataset
of India, Kaggle, 253,973 rows). We added pharmacology category labels and computed per-unit
pricing from this real data. Pharmacy locations, stock levels, and sales transactions were
synthetically generated on top of this real catalog, since no public dataset provides
store-level commercial data of this kind."*

**Regional note:** the dataset is India-specific (real Indian medicine names/prices) and the
synthetic pharmacy network is set in Mumbai. If your course requires a different country/region,
the synthetic layer (pharmacy locations) is the part to change — the real medicine catalog can
stay as-is, or you'd need a different country's real medicine dataset as the base file instead.

To regenerate the dataset yourself:
```bash
cd data
pip install pandas numpy faker
python generate_dataset.py
```
(This reads `source/A_Z_medicines_dataset_of_India.csv`, so don't delete that file.)


---

## Running the backend

```bash
cd backend
pip install -r requirements.txt
python3 generate_users.py    # creates users.json with hashed pharmacy/admin logins
uvicorn main:app --reload --port 8000
```

API docs (auto-generated, browsable) will be at: **http://127.0.0.1:8000/docs**

This is FastAPI's built-in interactive API tester — open that URL, click any
endpoint, hit "Try it out", and you can test the API directly without the
frontend running at all. Great for debugging.

### Login credentials (demo accounts)

Each pharmacy branch has its own login, scoped to only its own data. Plus one
head-office "admin" account that sees the whole network. Default passwords
(printed when you run `generate_users.py`):

| Username | Password | Role | Sees |
|---|---|---|---|
| `ph001` – `ph012` | `pharma123` | pharmacy | only that branch's own dashboard |
| `admin` | `admin123` | admin | all 12 branches, network-wide view |

Change these before any real deployment — they're intentionally simple for a
one-week student demo.

### Endpoints

| Endpoint | Auth required? | Purpose |
|---|---|---|
| `POST /auth/login` | No | Log in, get a JWT token |
| `GET /auth/me` | Yes | Who am I currently logged in as |
| `GET /admin/users` | Yes, **admin only** | List all accounts with status/timestamps |
| `POST /admin/reset-password` | Yes, **admin only** | Reset any account's password |
| `POST /admin/set-active` | Yes, **admin only** | Enable/disable an account |
| `GET /locator/search` | No (public) | Search medicine near a lat/lon |
| `POST /aidoc/advice` | No (public) | Get structured lifestyle advice for a condition |
| `POST /aidoc/upload-prescription` | No (public) | OCR a prescription image, auto-detect diagnosis |
| `GET /dashboard/summary` | Yes | KPI summary — scoped to your branch, or all if admin |
| `GET /dashboard/sales-trend` | Yes | Revenue trend over time — scoped |
| `GET /dashboard/category-breakdown` | Yes | Revenue by drug category — scoped |
| `GET /dashboard/top-drugs` | Yes | Best-selling drugs — scoped |
| `GET /dashboard/branch-performance` | Yes, **admin only** | Compare all branches (403 for branch logins) |
| `GET /dashboard/low-stock` | Yes | Low stock items — scoped |
| `GET /dashboard/otc-vs-rx` | Yes | OTC vs prescription split — scoped |

"Scoped" means: a `ph001` login only ever sees `ph001`'s own numbers. The
`admin` login sees everything. This is enforced **server-side** in `main.py`
(`scope_sales()` / `scope_stock()` functions) — the frontend can't bypass it
even if someone edits the JS.

## Admin Panel (Account Management)

Logged in as `admin`, click **"Manage Accounts"** on the dashboard to reach
`/admin`. From here you can see, for every account:
- Role (pharmacy / admin) and which branch it belongs to
- Active/Disabled status
- Created timestamp
- Last login timestamp + IP address (updates every time that account logs in)
- **Reset password** for any account (new password is bcrypt-hashed before saving)
- **Disable/Enable** an account (e.g. simulating a branch closing — they can no
  longer log in while disabled, but their historical sales data is untouched)

This page is protected two ways: the frontend route redirects non-admins away,
**and** every admin endpoint independently checks the JWT role server-side
(`require_admin` dependency in `auth.py`), so it can't be bypassed by directly
calling the API either.

## AI Doc — prescription upload + structured advice

AI Doc now returns advice in this exact structure for each condition:
1. **Issue** (the condition itself)
2. **Food — Do**
3. **Food — Avoid**
4. **Activity — Do**
5. **Activity — Avoid**
6. **Other Suggestions**

12 conditions have curated, specific advice: diabetes, high blood pressure,
cold, acidity, obesity, headache, eczema, common cough, back pain, anxiety,
common cold allergy, insomnia. Anything else gets sensible generic advice.

### Prescription upload

Users can upload a prescription image instead of typing a condition. The flow:
1. Image is sent to `/aidoc/upload-prescription`
2. **Tesseract OCR** (free, runs locally, no API cost) extracts all text from the image
3. The extracted text is scanned for **diagnosis phrasing only** (e.g. "migraine",
   "hypertension", "eczema") using a pattern list in `main.py` (`DIAGNOSIS_PATTERNS`)
4. If a diagnosis is found, the condition field is pre-filled automatically and
   advice is fetched right away
5. If nothing is confidently detected (very common with handwritten prescriptions —
   OCR struggles with handwriting even with paid tools), the user is asked to type
   the condition manually instead

**Safety design — read this for your report:** the OCR text may well contain medicine
names (since that's what's usually on a prescription), but the backend **only ever
extracts a diagnosis-style match**, never a medicine name, into `detected_condition`.
The raw OCR text is shown to the user (collapsible, for transparency) but is never
auto-filled into anything that drives medicine suggestions — keeping the "no meds
recommended" rule intact even when reading real prescriptions.

### Installing Tesseract OCR (Windows)

The backend's OCR feature needs Tesseract installed separately (it's a free,
open-source engine, not a Python package alone):

1. Download the Windows installer from the **UB Mannheim Tesseract build**
   (the standard free community build): search "UB Mannheim tesseract" or go to
   `https://github.com/UB-Mannheim/tesseract/wiki`
2. Run the installer, keep default options, note the install path
   (usually `C:\Program Files\Tesseract-OCR`)
3. Add that folder to your Windows PATH (Search → "Environment Variables" →
   edit Path → add the folder)
4. Restart PowerShell, then verify: `tesseract --version`

If you skip this step, `/aidoc/upload-prescription` will still work — it just
returns `"ocr_available": false"` and asks the user to type the condition
manually instead. **The app never breaks without Tesseract**, OCR is a bonus
feature layered on top of manual entry, which always works.

## Running the frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Make sure the backend is running on port 8000 first
(the frontend calls `http://127.0.0.1:8000` directly — see `src/api/client.js`).

- **Med Locator** and **AI Doc** are public — any visitor can use them, no login.
- **Dashboard** requires login (`/login` page). Customers never see this unless
  they specifically know the staff login exists — it's a small link in the nav
  bar labeled "Pharmacy Staff Login", not advertised as part of the customer flow.
- A branch login lands on their own store's numbers. The admin login lands on
  the network-wide view, with an extra "Branch Performance" chart comparing
  all stores (not shown to branch users — they get a 403 if they try the URL
  directly, so it's enforced even if someone pokes at the API).

### Note on session persistence

The login session is currently kept in memory only (not saved to browser
storage), so refreshing the page logs you out. This was a deliberate choice
to keep things simple and bug-free for a demo. If you want "stay logged in
after refresh" for your final submission, you can switch `AuthContext.jsx` to
use `localStorage` to persist the token — it's a small change (the comments
in that file point to where).


---

## About the Power BI question

True Power BI embedding into a website requires **Power BI Embedded**, which needs
an Azure subscription — not free, and not realistic in a one-week student project.
Instead, this project builds the dashboard **natively in React using Recharts**
(a free charting library), so it's fully interactive and lives directly on your
website with zero hosting cost.

If you still want a Power BI artifact for your report/demo (many mentors like
seeing the actual .pbix file even if it's not embedded):
1. Open Power BI Desktop (free download).
2. Import `data/sales_transactions.csv`, `data/stock.csv`, and `data/pharmacies.csv`.
3. Build a few visuals (revenue trend, category pie, branch bar chart) mirroring
   what's already in the React dashboard.
4. Save as `.pbix` and include it as a supplementary file in your submission —
   you don't need to embed it anywhere.

---

## Important note on AI Doc

By design, the `/aidoc/advice` endpoint **never returns medicine names, dosages,
or treatment instructions** — only lifestyle, food, and activity guidance, with
a disclaimer to consult a licensed doctor. This was intentional based on your
project spec ("No meds recommends anywhere") and is also the safer, more
defensible design choice for a health-adjacent student project.

---

## One-week build checklist

- [x] Real dataset downloaded (A-Z Medicine Dataset of India, Kaggle, 253,973 rows)
      and extended with categories, per-unit pricing, pharmacy network, stock,
      and transactions
- [x] Backend API (FastAPI) — locator, AI doc, dashboard analytics
- [x] Login system — per-branch + admin accounts, JWT-based, bcrypt-hashed passwords
- [x] Admin panel — view all accounts, timestamps, reset passwords, enable/disable
- [x] Dashboard data scoped server-side per logged-in pharmacy (admin sees all)
- [x] Med Locator frontend page
- [x] AI Doc frontend page — structured 6-part advice + prescription upload with OCR
- [x] Pharmacy Dashboard frontend page (charts: trend, category, top drugs,
      branch performance [admin only], OTC/Rx split, low-stock table)
- [x] Login page + protected dashboard route (customers can't reach it)
- [ ] Optional: build matching Power BI (.pbix) file for report appendix
- [ ] Optional: install Tesseract OCR locally to test prescription upload end-to-end
- [ ] Polish pass, deploy or record demo, write report
