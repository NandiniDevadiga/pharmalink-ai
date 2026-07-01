"""
Pharmalink AI - Backend (FastAPI)
===================================
Three endpoint groups:
1. /locator/*  -> Med Locator: search medicine across pharmacies near a location
2. /aidoc/*    -> AI Doc: lifestyle/food/activity advice (rule-based, NO medicine names)
3. /dashboard/*-> Pharmacy Dashboard: aggregated analytics for PowerBI-style charts

Run with: uvicorn main:app --reload --port 8000
"""

from fastapi import FastAPI, Query, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from typing import Optional, List
import pandas as pd
import math
import os

from auth import (
    authenticate_user, create_access_token, get_current_user, require_admin,
    TokenData, list_users_safe, admin_reset_password, admin_set_active,
)

app = FastAPI(title="Pharmalink AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this in production
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
# On Railway, the backend folder is the root, so data/ is right next to main.py
if not os.path.exists(DATA_DIR):
    DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

df_pharmacies = pd.read_csv(os.path.join(DATA_DIR, "pharmacies.csv"))
df_stock = pd.read_csv(os.path.join(DATA_DIR, "stock.csv"))
df_sales = pd.read_csv(os.path.join(DATA_DIR, "sales_transactions.csv"))
df_sales["date"] = pd.to_datetime(df_sales["date"])

# Auto-generate medicine->condition lookup from the REAL catalog at startup.
# This ensures every drug in our actual dataset (Lombard, Pansoft, Thyroprime
# etc.) is automatically recognised by AI Doc, without manual hand-coding.
_CATALOG_CATEGORY_TO_CONDITION = {
    "Analgesic": "headache",
    "Antibiotic": "cold",
    "Antihistamine": "common cold allergy",
    "Antidiabetic": "diabetes",
    "Cardiovascular": "high blood pressure",
    "Gastrointestinal": "acidity",
    "Neurological": "anxiety",
    "Respiratory": "common cough",
    "Supplement": "back pain",
    "Dermatological": "eczema",
    "Hormonal": "hypothyroidism",
}

import re as _re

def _build_catalog_medicine_map():
    catalog_path = os.path.join(DATA_DIR, "real_medicine_catalog.csv")
    if not os.path.exists(catalog_path):
        return {}
    cat = pd.read_csv(catalog_path)
    entries = {}
    for _, row in cat.iterrows():
        condition = _CATALOG_CATEGORY_TO_CONDITION.get(row["category"])
        if not condition:
            continue
        full_key = str(row["drug_name"]).lower().strip()
        entries[full_key] = condition
        # Also index by just the brand word (before first space/digit),
        # so "Lombard 250mg Tablet" -> also indexed as "lombard"
        short_key = _re.split(r"[\s\d]", full_key)[0].strip()
        if len(short_key) >= 3:
            entries.setdefault(short_key, condition)  # setdefault: hand-coded map takes priority
    return entries

CATALOG_MEDICINE_MAP = _build_catalog_medicine_map()



# =============================================================================
# 0. AUTH - login for pharmacy staff / head office admin
# =============================================================================
@app.post("/auth/login")
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends()):
    """
    Login with username (pharmacy_id like 'ph001', or 'admin') and password.
    Returns a JWT access token to use as 'Authorization: Bearer <token>'
    on dashboard requests. Records login timestamp + IP for the admin panel.
    """
    client_ip = request.client.host if request.client else None
    user = authenticate_user(form_data.username, form_data.password, client_ip)
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect username or password, or this account has been disabled.")
    token = create_access_token(user)
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user["role"],
        "pharmacy_id": user["pharmacy_id"],
        "pharmacy_name": user["pharmacy_name"],
    }


@app.get("/auth/me")
def read_current_user(current_user: TokenData = Depends(get_current_user)):
    """Returns who's currently logged in - used by frontend to restore session."""
    return current_user


# =============================================================================
# 0b. ADMIN PANEL - manage pharmacy/admin accounts (head office only)
# =============================================================================
class ResetPasswordRequest(BaseModel):
    username: str
    new_password: str


class SetActiveRequest(BaseModel):
    username: str
    active: bool


@app.get("/admin/users")
def admin_list_users(current_user: TokenData = Depends(require_admin)):
    """
    List every account: username, role, pharmacy, active/disabled status,
    created_at, and last_login_at/last_login_ip. Password hashes are never
    included in this response. Admin-only (403 for branch logins).
    """
    return list_users_safe()


@app.post("/admin/reset-password")
def admin_reset_password_endpoint(payload: ResetPasswordRequest, current_user: TokenData = Depends(require_admin)):
    """Admin can reset any account's password. New password is bcrypt-hashed before storage."""
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    ok = admin_reset_password(payload.username, payload.new_password)
    if not ok:
        raise HTTPException(status_code=404, detail="No account with that username.")
    return {"message": f"Password reset for {payload.username}."}


@app.post("/admin/set-active")
def admin_set_active_endpoint(payload: SetActiveRequest, current_user: TokenData = Depends(require_admin)):
    """
    Admin can disable an account (e.g. a branch closes down) without deleting
    its history. Disabled accounts can no longer log in.
    """
    if payload.username.lower() == "admin" and not payload.active:
        raise HTTPException(status_code=400, detail="You cannot disable the only admin account.")
    ok = admin_set_active(payload.username, payload.active)
    if not ok:
        raise HTTPException(status_code=404, detail="No account with that username.")
    return {"message": f"{payload.username} is now {'active' if payload.active else 'disabled'}."}


# =============================================================================
# 1. MED LOCATOR
# =============================================================================
def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


@app.get("/locator/search")
def search_medicine(
    drug_name: str = Query(..., description="Medicine name to search, partial match ok"),
    user_lat: float = Query(..., description="User's latitude"),
    user_lon: float = Query(..., description="User's longitude"),
    max_distance_km: float = Query(15.0, description="Search radius in km"),
):
    """Find pharmacies near the user that stock the given medicine."""
    matches = df_stock[df_stock["drug_name"].str.contains(drug_name, case=False, na=False)]
    if matches.empty:
        return {"query": drug_name, "results": [], "message": "No medicine found matching that name."}

    merged = matches.merge(df_pharmacies, on=["pharmacy_id", "pharmacy_name"])
    merged["distance_km"] = merged.apply(
        lambda r: round(haversine_km(user_lat, user_lon, r["latitude"], r["longitude"]), 2), axis=1
    )
    nearby = merged[merged["distance_km"] <= max_distance_km]
    in_stock = nearby[nearby["stock_qty"] > 0].sort_values("distance_km")
    out_of_stock_nearby = nearby[nearby["stock_qty"] == 0]

    # Auto-log unmet demand: if searched drug has no in-stock results nearby,
    # record it as a demand signal for the dashboard
    if len(in_stock) == 0 and not matches.empty:
        for _, row in out_of_stock_nearby.head(3).iterrows():
            _demand_log.append({
                "drug_name": drug_name,
                "pharmacy_id": row["pharmacy_id"],
                "timestamp": pd.Timestamp.now().isoformat(),
            })

    results = in_stock[[
        "pharmacy_name", "area", "address", "distance_km", "drug_name",
        "unit_price_inr", "stock_qty", "pharmacist_name", "contact_number",
        "open_time", "close_time", "otc_or_rx"
    ]].to_dict(orient="records")

    return {"query": drug_name, "count": len(results), "results": results}


# =============================================================================
# 2. AI DOC - lifestyle recommendations only, NEVER medicine names
# =============================================================================
import re
import io
from fastapi import UploadFile, File

try:
    import pytesseract
    from PIL import Image
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False


class SymptomInput(BaseModel):
    condition: str            # e.g. "diabetes", "headache", "eczema"
    age: Optional[int] = None
    activity_level: Optional[str] = "moderate"  # low / moderate / high


# Rule-based knowledge base: lifestyle only, structured exactly as:
# issue -> food dos -> food don'ts -> activity dos -> activity don'ts -> other suggestions
# Free, offline, no API cost, no medicine names anywhere.
LIFESTYLE_RULES = {
    "diabetes": {
        "do_food": ["High-fiber whole grains (oats, brown rice)", "Leafy greens and non-starchy vegetables",
                     "Lean protein (dal, fish, eggs)", "Small frequent meals to keep sugar stable"],
        "dont_food": ["Sugary drinks and desserts", "White rice/refined flour in excess", "Fried snacks"],
        "do_activity": ["30 min brisk walk daily", "Light strength training 2-3x/week", "Post-meal short walks"],
        "dont_activity": ["Long sedentary periods", "Skipping meals then overeating"],
        "other": ["Monitor blood sugar regularly as advised by your doctor", "Keep a food diary to spot patterns"],
    },
    "high blood pressure": {
        "do_food": ["Low-sodium meals", "Bananas, leafy greens (potassium-rich)", "Whole grains"],
        "dont_food": ["Excess salt/pickles/papad", "Processed & packaged foods", "Excess caffeine"],
        "do_activity": ["Daily 30-40 min moderate cardio", "Yoga/breathing exercises for stress"],
        "dont_activity": ["Heavy isometric exertion (e.g. very heavy lifting) without guidance", "High stress without breaks"],
        "other": ["Track blood pressure at home at a consistent time of day", "Limit alcohol intake"],
    },
    "cold": {
        "do_food": ["Warm fluids (soups, herbal tea)", "Vitamin C fruits (orange, amla)", "Ginger-honey warm water"],
        "dont_food": ["Cold drinks/ice cream", "Excess dairy if causing congestion"],
        "do_activity": ["Adequate rest/sleep", "Steam inhalation", "Light stretching if energy allows"],
        "dont_activity": ["Intense workouts until recovered", "Exposure to cold/AC drafts"],
        "other": ["Use a humidifier if air is dry", "See a doctor if fever lasts beyond 3 days"],
    },
    "acidity": {
        "do_food": ["Smaller, frequent meals", "Bananas, melons, oats", "Coconut water"],
        "dont_food": ["Spicy/oily food", "Citrus on empty stomach", "Late-night heavy meals"],
        "do_activity": ["Walk after meals (don't lie down immediately)", "Stress-reduction practices"],
        "dont_activity": ["Lying down right after eating", "Skipping meals then bingeing"],
        "other": ["Eat your last meal at least 2-3 hours before bed", "Elevate your head slightly while sleeping if symptoms persist at night"],
    },
    "obesity": {
        "do_food": ["Portion-controlled balanced meals", "High-protein, high-fiber foods", "Plenty of water before meals"],
        "dont_food": ["Sugary beverages", "Deep-fried and high-calorie snacks", "Late-night eating"],
        "do_activity": ["150+ min/week moderate cardio", "Strength training 2x/week", "Daily step goal (8-10k steps)"],
        "dont_activity": ["Prolonged sitting", "Crash dieting"],
        "other": ["Track progress with measurements, not just weight", "Aim for gradual, sustainable change rather than rapid loss"],
    },
    "headache": {
        "do_food": ["Stay well hydrated through the day", "Regular small meals (avoid long gaps)", "Magnesium-rich foods (nuts, leafy greens)"],
        "dont_food": ["Skipping meals", "Excess caffeine or sudden caffeine withdrawal", "Heavily processed/MSG-rich food if it's a known trigger"],
        "do_activity": ["Rest in a quiet, dim room during an episode", "Gentle neck and shoulder stretches", "Consistent sleep schedule"],
        "dont_activity": ["Staring at screens for long periods without breaks", "Irregular or insufficient sleep"],
        "other": ["Note triggers in a headache diary (foods, stress, sleep, screen time)", "See a doctor if headaches are frequent, severe, or sudden in onset"],
    },
    "eczema": {
        "do_food": ["Omega-3 rich foods (flaxseed, walnuts)", "Stay hydrated", "Foods rich in vitamin E"],
        "dont_food": ["Common trigger foods if you've noticed a personal pattern (e.g. dairy, gluten - varies by person)", "Excess sugar, which can worsen inflammation for some people"],
        "do_activity": ["Moisturize skin right after bathing", "Use lukewarm (not hot) water for baths/showers", "Wear soft, breathable cotton fabrics"],
        "dont_activity": ["Hot showers/baths", "Scratching affected areas", "Wearing rough or synthetic fabrics against irritated skin"],
        "other": ["Identify and avoid personal triggers (soaps, detergents, stress)", "See a dermatologist if flare-ups are frequent or severe"],
    },
    "common cough": {
        "do_food": ["Warm fluids and soups", "Honey in warm water (if not diabetic)", "Steamed or soft foods that are easy to swallow"],
        "dont_food": ["Cold drinks and ice cream", "Fried and oily food"],
        "do_activity": ["Rest your voice if hoarse", "Steam inhalation", "Sleep with head slightly elevated"],
        "dont_activity": ["Smoking or exposure to smoke/dust", "Talking loudly or for long periods if throat is irritated"],
        "other": ["See a doctor if cough persists beyond 2 weeks or includes blood"],
    },
    "back pain": {
        "do_food": ["Anti-inflammatory foods (turmeric, leafy greens, berries)", "Adequate calcium and vitamin D rich foods"],
        "dont_food": ["Excess processed/sugary food that can promote inflammation"],
        "do_activity": ["Gentle stretching and core-strengthening exercises", "Maintain good posture while sitting/standing", "Short walks instead of long sedentary periods"],
        "dont_activity": ["Heavy lifting with poor form", "Prolonged sitting without breaks", "Sudden twisting movements"],
        "other": ["Use a supportive mattress and ergonomic chair", "See a doctor/physiotherapist if pain radiates down the leg or persists"],
    },
    "anxiety": {
        "do_food": ["Balanced meals at regular times", "Foods rich in omega-3s and magnesium", "Limit excess caffeine"],
        "dont_food": ["Excess caffeine or energy drinks", "Skipping meals (blood sugar dips can worsen anxious feelings)"],
        "do_activity": ["Regular moderate exercise", "Breathing exercises / meditation", "Consistent sleep schedule"],
        "dont_activity": ["Excessive screen time, especially before bed", "Isolating for long periods"],
        "other": ["Talk to a mental health professional if anxiety interferes with daily life", "Journaling can help identify patterns and triggers"],
    },
    "common cold allergy": {
        "do_food": ["Vitamin C rich fruits", "Warm fluids", "Local honey (anecdotally helpful for some, if not diabetic)"],
        "dont_food": ["Known personal allergen foods", "Excess dairy if it worsens congestion for you"],
        "do_activity": ["Keep windows closed during high-pollen periods", "Shower after being outdoors during allergy season"],
        "dont_activity": ["Outdoor activity during high pollen-count hours", "Rubbing eyes if itchy"],
        "other": ["Use a HEPA air filter indoors if allergies are frequent", "See a doctor for persistent allergy symptoms"],
    },
    "insomnia": {
        "do_food": ["Light dinner, finished a few hours before bed", "Warm milk or herbal tea (chamomile) if tolerated"],
        "dont_food": ["Caffeine in the afternoon/evening", "Heavy or spicy meals close to bedtime", "Alcohol close to bedtime"],
        "do_activity": ["Consistent sleep/wake schedule, even on weekends", "Wind-down routine (reading, dim lights) before bed", "Regular daytime exercise (not close to bedtime)"],
        "dont_activity": ["Screen use right before bed", "Long daytime naps", "Working from bed"],
        "other": ["Keep the bedroom cool, dark, and quiet", "See a doctor if insomnia persists beyond a few weeks"],
    },
    "hypothyroidism": {
        "do_food": ["Selenium-rich foods (Brazil nuts, sunflower seeds, eggs)", "Zinc-rich foods (pumpkin seeds, lentils, chickpeas)",
                    "Iodine-rich foods if recommended by your doctor (saltwater fish, dairy)", "Plenty of vegetables and whole grains"],
        "dont_food": ["Raw cruciferous vegetables in very large amounts on an empty stomach (cabbage, broccoli, cauliflower — cooking reduces the effect)",
                      "Soy products in excess if taken close to thyroid medication", "Highly processed and high-sugar foods"],
        "do_activity": ["Low-to-moderate intensity exercise (walking, yoga, swimming) — helps counter fatigue and weight gain",
                        "Strength training 2-3x/week to support metabolism", "Consistent daily routine — thyroid conditions respond well to regular schedules"],
        "dont_activity": ["Overexertion when fatigued — rest is important during flare-ups", "Skipping physical activity entirely — gentle movement is beneficial"],
        "other": ["Take thyroid medication on an empty stomach, at the same time every day, as advised by your doctor",
                  "Avoid taking calcium, iron supplements, or antacids within 4 hours of thyroid medication — they interfere with absorption",
                  "Get thyroid levels (TSH) checked regularly as per your doctor's schedule",
                  "Fatigue and weight changes are common — be patient, medication takes weeks to stabilize"],
    },
}

GENERIC_ADVICE = {
    "do_food": ["Balanced diet with vegetables, fruits, whole grains", "Stay hydrated (8+ glasses water/day)"],
    "dont_food": ["Excess processed/ultra-sugary food", "Skipping meals regularly"],
    "do_activity": ["At least 30 min of daily movement", "Adequate 7-8 hr sleep"],
    "dont_activity": ["Prolonged inactivity", "Irregular sleep schedule"],
    "other": ["Consult a doctor for guidance specific to your condition"],
}

# ---------------------------------------------------------------------------
# Medicine name -> condition resolver
# Maps both common Indian brand names AND generic/active ingredient names
# to our 12 known lifestyle conditions, so users can type what they see on
# their prescription and still get relevant advice.
#
# Important design note: this mapping goes medicine -> condition,
# NEVER condition -> medicine. We are not recommending medicines —
# we're understanding what condition someone might have so we can give
# them lifestyle advice. The medicine name itself never appears in any
# response from the /aidoc/* endpoints.
# ---------------------------------------------------------------------------
MEDICINE_TO_CONDITION = {
    # ---- Analgesics / Pain / Fever / Headache ----
    "paracetamol": "headache", "crocin": "headache", "dolo": "headache",
    "calpol": "headache", "panadol": "headache", "combiflam": "headache",
    "ibuprofen": "headache", "brufen": "headache", "advil": "headache",
    "aspirin": "headache", "disprin": "headache",
    "sumo": "headache", "nimesulide": "headache",
    "diclofenac": "back pain", "voveran": "back pain",
    "aceclofenac": "back pain", "zerodol": "back pain",
    "mefenamic": "headache", "meftal": "headache",
    "tramadol": "back pain", "ultracet": "back pain",
    "naproxen": "back pain",

    # ---- Antidiabetics ----
    "metformin": "diabetes", "glycomet": "diabetes", "glucophage": "diabetes",
    "glimepiride": "diabetes", "amaryl": "diabetes",
    "glipizide": "diabetes", "glucotrol": "diabetes",
    "sitagliptin": "diabetes", "januvia": "diabetes",
    "vildagliptin": "diabetes", "galvus": "diabetes",
    "insulin": "diabetes", "lantus": "diabetes", "mixtard": "diabetes",
    "voglibose": "diabetes", "voglib": "diabetes",
    "dapagliflozin": "diabetes", "forxiga": "diabetes",
    "empagliflozin": "diabetes", "jardiance": "diabetes",

    # ---- Antihypertensives / Cardiovascular ----
    "amlodipine": "high blood pressure", "norvasc": "high blood pressure",
    "stamlo": "high blood pressure", "amlong": "high blood pressure",
    "losartan": "high blood pressure", "losar": "high blood pressure",
    "telmisartan": "high blood pressure", "telma": "high blood pressure",
    "olmesartan": "high blood pressure", "olsar": "high blood pressure",
    "ramipril": "high blood pressure", "cardace": "high blood pressure",
    "enalapril": "high blood pressure", "envas": "high blood pressure",
    "metoprolol": "high blood pressure", "betaloc": "high blood pressure",
    "atenolol": "high blood pressure", "tenormin": "high blood pressure",
    "atorvastatin": "high blood pressure", "lipitor": "high blood pressure",
    "rosuvastatin": "high blood pressure", "rozat": "high blood pressure",
    "clopidogrel": "high blood pressure", "clopilet": "high blood pressure",
    "ctd": "high blood pressure", "chlorthalidone": "high blood pressure",
    "hydrochlorothiazide": "high blood pressure", "hctz": "high blood pressure",

    # ---- Antihistamines / Allergy ----
    "cetirizine": "common cold allergy", "cetzine": "common cold allergy",
    "alerid": "common cold allergy", "zyrtec": "common cold allergy",
    "levocetirizine": "common cold allergy", "levocet": "common cold allergy",
    "fexofenadine": "common cold allergy", "allegra": "common cold allergy",
    "loratadine": "common cold allergy", "lorfast": "common cold allergy",
    "montelukast": "common cold allergy", "montek": "common cold allergy",
    "desloratadine": "common cold allergy",
    "chlorpheniramine": "common cold allergy", "piriton": "common cold allergy",

    # ---- Antibiotics (mapped to cold/infection) ----
    "amoxicillin": "cold", "amoxycillin": "cold", "mox": "cold",
    "azithromycin": "cold", "azithral": "cold", "zithromax": "cold",
    "ciprofloxacin": "cold", "ciplox": "cold",
    "doxycycline": "cold", "doxt": "cold",
    "cefixime": "cold", "taxim": "cold",
    "ceftriaxone": "cold",
    "levofloxacin": "cold", "levoflox": "cold",
    "amoxiclav": "cold", "augmentin": "cold",
    "clindamycin": "cold",

    # ---- Gastrointestinal / Acidity ----
    "omeprazole": "acidity", "omez": "acidity", "prilosec": "acidity",
    "pantoprazole": "acidity", "pan": "acidity", "pantodac": "acidity",
    "rabeprazole": "acidity", "razo": "acidity",
    "esomeprazole": "acidity", "nexium": "acidity",
    "ranitidine": "acidity", "rantac": "acidity",
    "domperidone": "acidity", "domstal": "acidity",
    "ondansetron": "acidity", "emeset": "acidity",
    "metoclopramide": "acidity",

    # ---- Respiratory / Cough ----
    "salbutamol": "common cough", "asthalin": "common cough",
    "albuterol": "common cough", "ventolin": "common cough",
    "budesonide": "common cough", "budecort": "common cough",
    "theophylline": "common cough",
    "ambroxol": "common cough", "mucolite": "common cough",
    "bromhexine": "common cough",
    "dextromethorphan": "common cough", "benadryl": "common cough",
    "guaifenesin": "common cough",
    "codeine": "common cough",

    # ---- Neurological / Anxiety / Sleep ----
    "sertraline": "anxiety", "zoloft": "anxiety", "serta": "anxiety",
    "escitalopram": "anxiety", "nexito": "anxiety",
    "fluoxetine": "anxiety", "prozac": "anxiety",
    "clonazepam": "anxiety", "rivotril": "anxiety",
    "alprazolam": "anxiety", "alprax": "anxiety",
    "diazepam": "anxiety", "valium": "anxiety",
    "lorazepam": "anxiety", "ativan": "anxiety",
    "gabapentin": "back pain", "gabantin": "back pain",
    "pregabalin": "back pain", "lyrica": "back pain",
    "amitriptyline": "anxiety",
    "melatonin": "insomnia", "dormicum": "insomnia",
    "zolpidem": "insomnia", "stilnox": "insomnia",
    "nitrazepam": "insomnia",

    # ---- Hormonal / Thyroid ----
    "levothyroxine": "hypothyroidism", "thyrox": "hypothyroidism",
    "eltroxin": "hypothyroidism", "thyroban": "hypothyroidism",
    "thyroprime": "hypothyroidism", "synthroid": "hypothyroidism",

    # ---- Dermatological / Eczema ----
    "clobetasol": "eczema", "dermovate": "eczema",
    "mometasone": "eczema", "elocon": "eczema",
    "betamethasone": "eczema", "betnovate": "eczema",
    "tacrolimus": "eczema", "protopic": "eczema",
    "ketoconazole": "eczema", "nizoral": "eczema",
    "clotrimazole": "eczema", "canesten": "eczema",
    "hydrocortisone": "eczema", "cortisone": "eczema",
    "calamine": "eczema",

    # ---- Supplements (mapped to relevant conditions) ----
    "vitamin d": "back pain", "cholecalciferol": "back pain",
    "calcium": "back pain",
    "vitamin c": "cold", "ascorbic acid": "cold",
    "zinc": "cold",
    "vitamin b12": "anxiety", "cobalamin": "anxiety",
    "folic acid": "diabetes",
    "iron": "cold", "ferrous": "cold",
    "omega 3": "anxiety", "fish oil": "anxiety",
}


def resolve_medicine_to_condition(user_input: str):
    """
    Checks if the user's input is a medicine name (brand or generic).
    Resolution order:
    1. Direct condition match (e.g. "diabetes" -> "diabetes")
    2. Diagnosis keyword match (e.g. "hypertension" -> "high blood pressure")
    3. Hand-coded medicine map (well-known brands: Crocin, Augmentin, etc.)
    4. Catalog-derived medicine map (every drug in our real A-Z dataset,
       e.g. "Lombard", "Pansoft", "Thyroprime")
    5. Partial match on hand-coded map (handles "crocin 500mg" etc.)
    6. Partial match on catalog map
    7. Falls back to original input unchanged (generic advice shown)
    """
    key = user_input.strip().lower()

    # 1. Already a known condition
    if key in LIFESTYLE_RULES:
        return key, False

    # 2. Diagnosis keyword
    for condition, patterns in DIAGNOSIS_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, key):
                return condition, False

    # 3. Hand-coded exact match (well-known brands/generics)
    if key in MEDICINE_TO_CONDITION:
        return MEDICINE_TO_CONDITION[key], True

    # 4. Catalog-derived exact match (all 439 real drugs in our dataset)
    if key in CATALOG_MEDICINE_MAP:
        return CATALOG_MEDICINE_MAP[key], True

    # 5. Partial match on hand-coded map (e.g. "crocin 500mg" contains "crocin")
    for med_name, condition in MEDICINE_TO_CONDITION.items():
        if med_name in key or key in med_name:
            return condition, True

    # 6. Partial match on catalog map (e.g. "lombard 250mg tablet" contains "lombard")
    for med_name, condition in CATALOG_MEDICINE_MAP.items():
        if med_name in key or key in med_name:
            return condition, True

    # 7. No match — return as-is for generic advice
    return key, False


@app.post("/aidoc/advice")
def get_lifestyle_advice(payload: SymptomInput):
    """
    Returns lifestyle dos/don'ts for food & activity based on condition, plus
    other general suggestions. IMPORTANT: This endpoint never returns medicine
    names or dosages by design - only lifestyle guidance.
    """
    key = payload.condition.strip().lower()

    # Step 1: Try to resolve medicine name -> condition first.
    # This lets users type "Crocin", "Metformin", "Paracetamol" etc.
    # and still get relevant advice for their actual condition.
    resolved_condition, resolved_from_medicine = resolve_medicine_to_condition(key)

    rules = LIFESTYLE_RULES.get(resolved_condition, GENERIC_ADVICE)
    matched = resolved_condition in LIFESTYLE_RULES

    disclaimer = (
        "This is general lifestyle guidance only, not a medical diagnosis or treatment. "
        "Please consult a licensed doctor for any medicine or treatment decisions."
    )

    return {
        "condition": resolved_condition,
        "original_input": payload.condition,
        "resolved_from_medicine": resolved_from_medicine,
        "matched_known_condition": matched,
        "disclaimer": disclaimer,
        "food_dos": rules["do_food"],
        "food_donts": rules["dont_food"],
        "activity_dos": rules["do_activity"],
        "activity_donts": rules["dont_activity"],
        "other_suggestions": rules["other"],
    }


@app.get("/aidoc/conditions")
def list_supported_conditions():
    """List conditions with curated lifestyle advice (others get generic advice)."""
    return {"supported_conditions": list(LIFESTYLE_RULES.keys())}


# ---------------------------------------------------------------------------
# Prescription upload -> OCR -> auto-detect diagnosis (NOT medicine names)
# ---------------------------------------------------------------------------

# Common diagnosis phrasing doctors write, mapped to our condition keys.
# We deliberately do NOT scan for medicine names here - only diagnosis-style
# phrases - so this can never accidentally drive a "medicine recommendation."
DIAGNOSIS_PATTERNS = {
    "diabetes": [r"diabetes", r"diabetic", r"\bt2dm\b", r"\bdm\b"],
    "high blood pressure": [r"hypertension", r"high blood pressure", r"\bhtn\b"],
    "cold": [r"common cold", r"\bcoryza\b", r"viral fever"],
    "acidity": [r"acidity", r"gastritis", r"\bgerd\b", r"acid reflux"],
    "obesity": [r"obesity", r"overweight"],
    "headache": [r"headache", r"migraine", r"cephalgia"],
    "eczema": [r"eczema", r"dermatitis", r"atopic dermatitis"],
    "common cough": [r"\bcough\b", r"bronchitis", r"pharyngitis"],
    "back pain": [r"back pain", r"lumbago", r"\blbp\b", r"sciatica"],
    "anxiety": [r"anxiety", r"panic disorder", r"\bgad\b"],
    "common cold allergy": [r"allerg", r"rhinitis", r"hay fever"],
    "insomnia": [r"insomnia", r"sleep disorder", r"sleeplessness"],
    "hypothyroidism": [r"hypothyroid", r"thyroid", r"\bhypo\b"],
}


def detect_condition_from_text(text: str):
    """Scans OCR text for diagnosis-style phrases only. Returns the matched
    condition key, or None if nothing recognizable was found (caller should
    fall back to asking the user to type it manually)."""
    lowered = text.lower()
    for condition, patterns in DIAGNOSIS_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, lowered):
                return condition
    return None


@app.post("/aidoc/upload-prescription")
async def upload_prescription(file: UploadFile = File(...)):
    """
    Accepts a prescription image, runs OCR (Tesseract) to extract text, then
    tries to auto-detect a diagnosis from known diagnosis phrasing.

    IMPORTANT SAFETY DESIGN: this endpoint only ever returns a detected
    CONDITION (e.g. "headache"), never medicine names, even though the OCR
    text itself may contain them. The raw OCR text is also returned so the
    user can see what was read and correct it if needed - but the frontend
    must never auto-fill medicine names anywhere in AI Doc.

    If OCR is unavailable (Tesseract not installed) or no diagnosis pattern
    is found, detected_condition will be null and the frontend should fall
    back to manual entry.
    """
    if not OCR_AVAILABLE:
        return {
            "ocr_available": False,
            "raw_text": None,
            "detected_condition": None,
            "message": "OCR engine not installed on this server. Please type your condition manually.",
        }

    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        raw_text = pytesseract.image_to_string(image)
    except Exception as e:
        return {
            "ocr_available": True,
            "raw_text": None,
            "detected_condition": None,
            "message": f"Could not read this image ({str(e)}). Please type your condition manually.",
        }

    detected = detect_condition_from_text(raw_text)

    # If diagnosis patterns didn't match, try scanning OCR text word-by-word
    # for medicine names — useful when doctor writes only medicine names
    # without a clear diagnosis line (very common in Indian prescriptions).
    # We resolve medicine -> condition but NEVER return the medicine name itself
    # in the response — only the resolved condition goes back to the frontend.
    if not detected:
        for word in re.split(r'[\s,.\n]+', raw_text.lower()):
            word = word.strip()
            if len(word) < 3:
                continue
            resolved, was_medicine = resolve_medicine_to_condition(word)
            if was_medicine:
                detected = resolved
                break

    return {
        "ocr_available": True,
        "raw_text": raw_text.strip(),
        "detected_condition": detected,
        "message": (
            f"Detected condition: {detected}." if detected
            else "Could not confidently detect a diagnosis from this image. Please type your condition manually."
        ),
    }


# =============================================================================
# 3. PHARMACY DASHBOARD - analytics endpoints (PROTECTED - login required)
# =============================================================================
def scope_sales(df: pd.DataFrame, user: TokenData) -> pd.DataFrame:
    """Admin sees all branches. Pharmacy role sees only their own pharmacy_id."""
    if user.role == "admin":
        return df
    return df[df["pharmacy_id"] == user.pharmacy_id]


def scope_stock(df: pd.DataFrame, user: TokenData) -> pd.DataFrame:
    if user.role == "admin":
        return df
    return df[df["pharmacy_id"] == user.pharmacy_id]


@app.get("/dashboard/summary")
def dashboard_summary(current_user: TokenData = Depends(get_current_user)):
    sales = scope_sales(df_sales, current_user)
    stock = scope_stock(df_stock, current_user)

    total_revenue = float(sales["total_inr"].sum())
    total_transactions = int(len(sales))
    avg_order_value = float(sales["total_inr"].mean()) if total_transactions else 0.0
    total_units_sold = int(sales["quantity"].sum())
    low_stock_count = int((stock["stock_qty"] < 20).sum())
    branch_count = 1 if current_user.role == "pharmacy" else int(df_pharmacies.shape[0])

    return {
        "scope": "branch" if current_user.role == "pharmacy" else "network",
        "pharmacy_name": current_user.pharmacy_name,
        "total_revenue_inr": round(total_revenue, 2),
        "total_transactions": total_transactions,
        "avg_order_value_inr": round(avg_order_value, 2),
        "total_units_sold": total_units_sold,
        "low_stock_alerts": low_stock_count,
        "active_pharmacies": branch_count,
    }


@app.get("/dashboard/sales-trend")
def sales_trend(
    granularity: str = Query("monthly", enum=["daily", "monthly"]),
    current_user: TokenData = Depends(get_current_user),
):
    df = scope_sales(df_sales, current_user).copy()
    if granularity == "monthly":
        df["period"] = df["date"].dt.strftime("%Y-%m")
    else:
        df["period"] = df["date"].dt.strftime("%Y-%m-%d")
    trend = df.groupby("period")["total_inr"].sum().reset_index()
    trend.columns = ["period", "revenue_inr"]
    return trend.to_dict(orient="records")


@app.get("/dashboard/category-breakdown")
def category_breakdown(current_user: TokenData = Depends(get_current_user)):
    sales = scope_sales(df_sales, current_user)
    cat = sales.groupby("category").agg(
        revenue_inr=("total_inr", "sum"),
        units_sold=("quantity", "sum"),
        transactions=("transaction_id", "count"),
    ).reset_index().sort_values("revenue_inr", ascending=False)
    return cat.to_dict(orient="records")


@app.get("/dashboard/top-drugs")
def top_drugs(limit: int = 10, current_user: TokenData = Depends(get_current_user)):
    sales = scope_sales(df_sales, current_user)
    top = sales.groupby("drug_name").agg(
        revenue_inr=("total_inr", "sum"),
        units_sold=("quantity", "sum"),
    ).reset_index().sort_values("revenue_inr", ascending=False).head(limit)
    return top.to_dict(orient="records")


@app.get("/dashboard/branch-performance")
def branch_performance(current_user: TokenData = Depends(get_current_user)):
    """
    Admin only - comparing branches doesn't make sense for a single-branch login.
    A pharmacy user gets a 403 here (frontend won't even show this chart to them).
    """
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Branch comparison is only available to head office accounts.")
    perf = df_sales.groupby(["pharmacy_name", "area"]).agg(
        revenue_inr=("total_inr", "sum"),
        transactions=("transaction_id", "count"),
    ).reset_index().sort_values("revenue_inr", ascending=False)
    return perf.to_dict(orient="records")


@app.get("/dashboard/low-stock")
def low_stock(threshold: int = 20, current_user: TokenData = Depends(get_current_user)):
    stock = scope_stock(df_stock, current_user)
    low = stock[stock["stock_qty"] < threshold][[
        "pharmacy_name", "drug_name", "category", "stock_qty", "unit_price_inr"
    ]].sort_values("stock_qty")
    return low.to_dict(orient="records")


@app.get("/dashboard/otc-vs-rx")
def otc_vs_rx(current_user: TokenData = Depends(get_current_user)):
    sales = scope_sales(df_sales, current_user)
    split = sales.groupby("otc_or_rx").agg(
        revenue_inr=("total_inr", "sum"),
        transactions=("transaction_id", "count"),
    ).reset_index()
    return split.to_dict(orient="records")


@app.get("/dashboard/quarterly-sales")
def quarterly_sales(current_user: TokenData = Depends(get_current_user)):
    """Revenue and units sold grouped by quarter (Q1/Q2/Q3/Q4)."""
    df = scope_sales(df_sales, current_user).copy()
    df["quarter"] = df["date"].dt.to_period("Q").astype(str)
    result = df.groupby("quarter").agg(
        revenue_inr=("total_inr", "sum"),
        units_sold=("quantity", "sum"),
        transactions=("transaction_id", "count"),
    ).reset_index().sort_values("quarter")
    return result.to_dict(orient="records")


@app.get("/dashboard/seasonal-heatmap")
def seasonal_heatmap(current_user: TokenData = Depends(get_current_user)):
    """
    Monthly sales units per category — reveals seasonal patterns.
    e.g. Respiratory spikes in monsoon months (Jul-Sep),
    Antihistamine spikes during pollen seasons, etc.
    Returned as a list of {category, month, units_sold} for the frontend
    to render as a heatmap or grouped bar chart.
    """
    df = scope_sales(df_sales, current_user).copy()
    df["month_num"] = df["date"].dt.month
    df["month_name"] = df["date"].dt.strftime("%b")  # Jan, Feb, etc.

    result = df.groupby(["category", "month_num", "month_name"]).agg(
        units_sold=("quantity", "sum"),
    ).reset_index().sort_values(["category", "month_num"])

    return result.drop(columns=["month_num"]).to_dict(orient="records")


@app.get("/dashboard/forecast")
def forecast_orders(
    months_ahead: int = Query(1, ge=1, le=3),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Forecasts how many units of each medicine to order for the next N months.

    Method: 3-month trailing moving average × seasonal multiplier.
    - 3-month average: smooths out noise, uses recent actual sales data.
    - Seasonal multiplier: applies known demand boosts per category per month
      (e.g. Respiratory +70% in July-August for monsoon).
    - Safety buffer: adds 20% on top to avoid stockouts.
    - Compares forecast vs current stock to give a "units to order" number.

    This is the same logic used by small pharmacy inventory systems —
    no ML needed, explainable, and works well on a year of data.
    """
    sales = scope_sales(df_sales, current_user).copy()
    stock = scope_stock(df_stock, current_user).copy()

    # Seasonal multipliers per category per month
    # (same ones used in data generation, now surfaced for forecasting)
    SEASONAL = {
        "Respiratory":    {7: 1.6, 8: 1.7, 9: 1.4, 10: 1.2},
        "Antihistamine":  {7: 1.5, 8: 1.6, 3: 1.3, 4: 1.4},
        "Antibiotic":     {7: 1.3, 8: 1.3, 1: 1.2},
        "Gastrointestinal": {4: 1.3, 5: 1.4, 6: 1.3},
    }

    # Get last 3 months of data for moving average
    latest_date = sales["date"].max()
    three_months_ago = latest_date - pd.DateOffset(months=3)
    recent = sales[sales["date"] >= three_months_ago]
    monthly_avg = recent.groupby("drug_name")["quantity"].sum() / 3

    # Get category for each drug
    drug_category = sales.drop_duplicates("drug_name").set_index("drug_name")["category"]

    forecast_rows = []
    for drug, avg_monthly in monthly_avg.items():
        category = drug_category.get(drug, "Other")
        # Compute average seasonal multiplier for the forecast period
        seasonal_mult = 1.0
        for m in range(1, months_ahead + 1):
            target_month = (latest_date + pd.DateOffset(months=m)).month
            multiplier = SEASONAL.get(category, {}).get(target_month, 1.0)
            seasonal_mult = max(seasonal_mult, multiplier)

        forecast_qty = round(avg_monthly * seasonal_mult * months_ahead * 1.2)  # 20% safety buffer

        # Get current stock for this drug at this pharmacy
        drug_stock = stock[stock["drug_name"] == drug]["stock_qty"].sum()
        units_to_order = max(0, forecast_qty - drug_stock)

        forecast_rows.append({
            "drug_name": drug,
            "category": category,
            "avg_monthly_sales": round(avg_monthly, 1),
            "seasonal_multiplier": round(seasonal_mult, 2),
            "forecast_qty": int(forecast_qty),
            "current_stock": int(drug_stock),
            "units_to_order": int(units_to_order),
            "priority": "HIGH" if units_to_order > forecast_qty * 0.5 else
                        "MEDIUM" if units_to_order > 0 else "OK",
        })

    # Sort by priority: HIGH first, then MEDIUM, then OK
    priority_order = {"HIGH": 0, "MEDIUM": 1, "OK": 2}
    forecast_rows.sort(key=lambda x: (priority_order[x["priority"]], -x["units_to_order"]))
    return forecast_rows[:50]  # Top 50 most actionable


# In-memory demand log: tracks when a patient searched for a medicine
# that was either out of stock locally or not found at all.
# In a production system this would be a database table.
_demand_log: list[dict] = []


@app.post("/locator/log-demand")
async def log_unmet_demand(request: Request):
    """
    Called by the frontend when a Med Locator search returns zero results
    (or only out-of-stock results) for the user's location.
    Logs the drug name + timestamp as an unmet demand signal.
    No auth required — this is customer-facing.
    """
    body = await request.json()
    drug_name = body.get("drug_name", "").strip()
    pharmacy_id = body.get("pharmacy_id")  # which pharmacy the customer was near
    if drug_name:
        _demand_log.append({
            "drug_name": drug_name,
            "pharmacy_id": pharmacy_id,
            "timestamp": pd.Timestamp.now().isoformat(),
        })
    return {"logged": True}


@app.get("/dashboard/unmet-demand")
def unmet_demand(current_user: TokenData = Depends(get_current_user)):
    """
    Shows medicines that patients searched for but weren't available
    at this pharmacy (or nearby). Ranked by how often they were searched.
    This tells the pharmacy: 'you're losing customers for these medicines —
    consider stocking them.'
    Also cross-references with other pharmacies that DO have it in stock,
    so this branch can refer patients or place an inter-pharmacy order.
    """
    if not _demand_log:
        return {"unmet_demands": [], "message": "No unmet demand logged yet. Data builds up as customers use the Med Locator."}

    # Filter to this pharmacy's unmet demands (or all for admin)
    logs = _demand_log
    if current_user.role == "pharmacy":
        logs = [d for d in _demand_log if d.get("pharmacy_id") == current_user.pharmacy_id]

    if not logs:
        return {"unmet_demands": [], "message": "No unmet demand for your branch yet."}

    # Count frequency per drug
    from collections import Counter
    drug_counts = Counter(d["drug_name"] for d in logs)

    result = []
    for drug, count in drug_counts.most_common(20):
        # Check which other pharmacies have this drug in stock
        available_elsewhere = df_stock[
            (df_stock["drug_name"].str.contains(drug, case=False, na=False)) &
            (df_stock["stock_qty"] > 0)
        ][["pharmacy_name", "area", "stock_qty", "unit_price_inr"]].head(3).to_dict(orient="records")

        # Check if this pharmacy has it
        if current_user.role == "pharmacy":
            local_stock = df_stock[
                (df_stock["pharmacy_id"] == current_user.pharmacy_id) &
                (df_stock["drug_name"].str.contains(drug, case=False, na=False))
            ]["stock_qty"].sum()
        else:
            local_stock = None

        result.append({
            "drug_name": drug,
            "times_searched": count,
            "local_stock": int(local_stock) if local_stock is not None else None,
            "available_at_other_pharmacies": available_elsewhere,
        })

    return {"unmet_demands": result}


@app.get("/")
def root():
    return {"message": "Pharmalink AI API is running.", "docs": "/docs"}

