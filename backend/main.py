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

from database import get_dataframe_from_mongo, db, db_load_users, db_save_user

df_pharmacies = get_dataframe_from_mongo("pharmacies")


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
    cat = get_dataframe_from_mongo("real_medicine_catalog")
    if cat.empty:
        return {}
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


class RegisterRequest(BaseModel):
    username: str
    password: str
    role: str
    pharmacy_id: Optional[str] = None
    pharmacy_name: Optional[str] = None
    area: Optional[str] = None
    address: Optional[str] = None
    contact_number: Optional[str] = None
    open_time: Optional[str] = "08:00"
    close_time: Optional[str] = "22:00"
    latitude: Optional[float] = None
    longitude: Optional[float] = None


@app.post("/auth/register")
def register_user(payload: RegisterRequest):
    """
    Registers a new user (admin or pharmacy manager).
    Hashes the password and saves the account in MongoDB.
    If the role is pharmacy, also inserts a default branch record
    in the pharmacies collection if the pharmacy_id doesn't exist yet.
    """
    import datetime
    import bcrypt

    uname = payload.username.lower().strip()
    if not uname:
        raise HTTPException(status_code=400, detail="Username cannot be empty.")
    
    users = db_load_users()
    if uname in users:
        raise HTTPException(status_code=400, detail=f"Username '{uname}' already exists.")
        
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
        
    if payload.role not in ("admin", "pharmacy"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'pharmacy'.")
        
    if payload.role == "pharmacy":
        if not payload.pharmacy_id:
            raise HTTPException(status_code=400, detail="Pharmacy ID is required for pharmacy registration.")
        if not payload.pharmacy_name:
            raise HTTPException(status_code=400, detail="Pharmacy Name is required for pharmacy registration.")

    def hash_pw(plain):
        return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()
        
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    new_user = {
        "username": uname,
        "password_hash": hash_pw(payload.password),
        "role": payload.role,
        "pharmacy_id": payload.pharmacy_id if payload.role == "pharmacy" else None,
        "pharmacy_name": payload.pharmacy_name if payload.role == "pharmacy" else "Head Office",
        "created_at": now,
        "last_login_at": None,
        "last_login_ip": None,
        "active": True,
    }
    
    db_save_user(uname, new_user)
    
    if payload.role == "pharmacy":
        pharm_id = payload.pharmacy_id.strip()
        exists = db.pharmacies.find_one({"pharmacy_id": pharm_id})
        if not exists:
            db.pharmacies.insert_one({
                "pharmacy_id": pharm_id,
                "pharmacy_name": payload.pharmacy_name.strip(),
                "area": payload.area.strip() if payload.area else "Unknown Area",
                "latitude": payload.latitude if payload.latitude is not None else 0.0,
                "longitude": payload.longitude if payload.longitude is not None else 0.0,
                "address": payload.address.strip() if payload.address else "Address not provided",
                "pharmacist_name": uname,
                "contact_number": payload.contact_number.strip() if payload.contact_number else "No contact provided",
                "open_time": payload.open_time,
                "close_time": payload.close_time
            })

    return {"message": f"Successfully registered user '{uname}'."}



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


class BulkUserItem(BaseModel):
    username: str
    role: str
    pharmacy_id: Optional[str] = None
    pharmacy_name: str
    password: str
    area: Optional[str] = None
    address: Optional[str] = None
    contact_number: Optional[str] = None
    open_time: Optional[str] = "08:00"
    close_time: Optional[str] = "22:00"
    latitude: Optional[float] = None
    longitude: Optional[float] = None


@app.post("/admin/bulk-upload")
def admin_bulk_upload(payload: List[BulkUserItem], current_user: TokenData = Depends(require_admin)):
    """
    Bulk uploads multiple user accounts.
    Performs validation on password length, roles, and checks for database
    or intra-payload username duplicates. Hashed credentials are saved to MongoDB.
    """
    import datetime
    import bcrypt

    users = db_load_users()
    new_users = []
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    def hash_pw(plain):
        return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()

    # Step 1: Pre-validation of all rows before writing any data (atomicity check)
    seen_in_payload = set()
    for index, item in enumerate(payload):
        uname = item.username.lower().strip()
        if not uname:
            raise HTTPException(
                status_code=400,
                detail=f"Row {index + 1}: Username cannot be empty."
            )
        if uname in users or uname in seen_in_payload:
            raise HTTPException(
                status_code=400,
                detail=f"Row {index + 1}: Username '{uname}' already exists."
            )
        if item.role not in ("admin", "pharmacy"):
            raise HTTPException(
                status_code=400,
                detail=f"Row {index + 1}: Role must be 'admin' or 'pharmacy'."
            )
        if len(item.password) < 6:
            raise HTTPException(
                status_code=400,
                detail=f"Row {index + 1}: Password must be at least 6 characters."
            )
        
        seen_in_payload.add(uname)
        new_users.append({
            "username": uname,
            "password_hash": hash_pw(item.password),
            "role": item.role,
            "pharmacy_id": item.pharmacy_id if item.role == "pharmacy" else None,
            "pharmacy_name": item.pharmacy_name if item.role == "pharmacy" else "Head Office",
            "created_at": now,
            "last_login_at": None,
            "last_login_ip": None,
            "active": True,
        })
        
        # Optionally track bulk payloads to insert pharmacies
        if item.role == "pharmacy" and item.pharmacy_id:
            item.pharm_id = item.pharmacy_id

    # Step 2: Save valid hashed users to database
    for nu in new_users:
        db_save_user(nu["username"], nu)
        
    # Step 3: Insert pharmacy records
    for item in payload:
        if item.role == "pharmacy" and item.pharmacy_id:
            pharm_id = item.pharmacy_id.strip()
            exists = db.pharmacies.find_one({"pharmacy_id": pharm_id})
            if not exists:
                db.pharmacies.insert_one({
                    "pharmacy_id": pharm_id,
                    "pharmacy_name": item.pharmacy_name.strip(),
                    "area": item.area.strip() if item.area else "Unknown Area",
                    "latitude": item.latitude if item.latitude is not None else 0.0,
                    "longitude": item.longitude if item.longitude is not None else 0.0,
                    "address": item.address.strip() if item.address else "Address not provided",
                    "pharmacist_name": item.username,
                    "contact_number": item.contact_number.strip() if item.contact_number else "No contact provided",
                    "open_time": item.open_time if item.open_time else "08:00",
                    "close_time": item.close_time if item.close_time else "22:00"
                })

    # Sync global df_pharmacies
    global df_pharmacies
    df_pharmacies = get_dataframe_from_mongo("pharmacies")

    return {"message": f"Successfully imported {len(new_users)} user accounts."}



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
    import datetime

    # 1. Find all stock matching drug_name
    query = {"drug_name": {"$regex": drug_name.strip(), "$options": "i"}}
    stock_matches = list(db.stock.find(query, {"_id": 0}))
    
    if not stock_matches:
        return {"query": drug_name, "count": 0, "results": [], "message": "No medicine found matching that name."}
        
    # 2. Get unique pharmacy IDs from matches
    pharmacy_ids = list(set(s["pharmacy_id"] for s in stock_matches))
    
    # 3. Fetch those pharmacies
    pharmacies = list(db.pharmacies.find({"pharmacy_id": {"$in": pharmacy_ids}}, {"_id": 0}))
    pharm_dict = {p["pharmacy_id"]: p for p in pharmacies}
    
    results = []
    out_of_stock_nearby = []
    
    for s in stock_matches:
        pharm = pharm_dict.get(s["pharmacy_id"])
        if not pharm:
            continue
            
        lat = pharm.get("latitude")
        lon = pharm.get("longitude")
        if lat is None or lon is None:
            continue
            
        dist = round(haversine_km(user_lat, user_lon, float(lat), float(lon)), 2)
        
        if dist <= max_distance_km:
            if s.get("stock_qty", 0) > 0:
                results.append({
                    "pharmacy_name": pharm.get("pharmacy_name", "Unknown"),
                    "area": pharm.get("area", "Unknown Area"),
                    "address": pharm.get("address", "Unknown Address"),
                    "distance_km": dist,
                    "drug_name": s["drug_name"],
                    "unit_price_inr": s.get("unit_price_inr", 0),
                    "stock_qty": s["stock_qty"],
                    "pharmacist_name": pharm.get("pharmacist_name", "Pharmacist"),
                    "contact_number": pharm.get("contact_number", "N/A"),
                    "open_time": pharm.get("open_time", "08:00 AM"),
                    "close_time": pharm.get("close_time", "10:00 PM"),
                    "otc_or_rx": s.get("otc_or_rx", "OTC")
                })
            else:
                out_of_stock_nearby.append({"pharmacy_id": s["pharmacy_id"]})
                
    results.sort(key=lambda x: x["distance_km"])
    
    # Auto-log unmet demand if everything nearby is out of stock
    if len(results) == 0 and len(out_of_stock_nearby) > 0:
        for row in out_of_stock_nearby[:3]:
            try:
                db.unmet_demand.insert_one({
                    "drug_name": drug_name,
                    "pharmacy_id": row["pharmacy_id"],
                    "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
                })
            except Exception as ex:
                print(f"Error logging unmet demand: {ex}")

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
def get_sales_df(user: TokenData) -> pd.DataFrame:
    query = {} if user.role == "admin" else {"pharmacy_id": user.pharmacy_id}
    docs = list(db.sales_transactions.find(query, {"_id": 0}))
    if not docs:
        return pd.DataFrame(columns=[
            "transaction_id", "date", "timestamp", "pharmacy_id", "pharmacy_name",
            "area", "drug_name", "category", "quantity", "unit_price_inr", "total_inr", "otc_or_rx"
        ])
    df = pd.DataFrame(docs)
    df["date"] = pd.to_datetime(df["date"])
    return df

def get_stock_df(user: TokenData) -> pd.DataFrame:
    query = {} if user.role == "admin" else {"pharmacy_id": user.pharmacy_id}
    docs = list(db.stock.find(query, {"_id": 0}))
    if not docs:
        return pd.DataFrame(columns=[
            "pharmacy_id", "pharmacy_name", "drug_name", "category", "manufacturer",
            "unit_price_inr", "stock_qty", "otc_or_rx"
        ])
    return pd.DataFrame(docs)


@app.get("/dashboard/summary")
def dashboard_summary(current_user: TokenData = Depends(get_current_user)):
    sales = get_sales_df(current_user)
    stock = get_stock_df(current_user)

    total_revenue = float(sales["total_inr"].sum()) if not sales.empty else 0.0
    total_transactions = int(len(sales))
    avg_order_value = float(sales["total_inr"].mean()) if total_transactions else 0.0
    total_units_sold = int(sales["quantity"].sum()) if not sales.empty else 0
    low_stock_count = int((stock["stock_qty"] < 20).sum()) if not stock.empty else 0
    branch_count = 1 if current_user.role == "pharmacy" else db.pharmacies.count_documents({})

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
    df = get_sales_df(current_user)
    if df.empty:
        return []
    if granularity == "monthly":
        df["period"] = df["date"].dt.strftime("%Y-%m")
    else:
        df["period"] = df["date"].dt.strftime("%Y-%m-%d")
    trend = df.groupby("period")["total_inr"].sum().reset_index()
    trend.columns = ["period", "revenue_inr"]
    return trend.to_dict(orient="records")


@app.get("/dashboard/category-breakdown")
def category_breakdown(current_user: TokenData = Depends(get_current_user)):
    sales = get_sales_df(current_user)
    if sales.empty:
        return []
    cat = sales.groupby("category").agg(
        revenue_inr=("total_inr", "sum"),
        units_sold=("quantity", "sum"),
        transactions=("transaction_id", "count"),
    ).reset_index().sort_values("revenue_inr", ascending=False)
    return cat.to_dict(orient="records")


@app.get("/dashboard/top-drugs")
def top_drugs(limit: int = 10, current_user: TokenData = Depends(get_current_user)):
    sales = get_sales_df(current_user)
    if sales.empty:
        return []
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
        raise HTTPException(status_code=403, detail="Branch comparison is admin-only.")
    sales = get_sales_df(current_user)
    if sales.empty:
        return []
    perf = sales.groupby(["pharmacy_id", "pharmacy_name"]).agg(
        revenue_inr=("total_inr", "sum"),
        transactions=("transaction_id", "count"),
    ).reset_index().sort_values("revenue_inr", ascending=False)
    return perf.to_dict(orient="records")


@app.get("/dashboard/low-stock")
def low_stock(threshold: int = 20, current_user: TokenData = Depends(get_current_user)):
    stock = get_stock_df(current_user)
    if stock.empty:
        return []
    ls = stock[stock["stock_qty"] < threshold].copy()[[
        "pharmacy_name", "drug_name", "category", "stock_qty", "unit_price_inr"
    ]].sort_values("stock_qty")
    return ls.to_dict(orient="records")


@app.get("/dashboard/otc-vs-rx")
def otc_vs_rx(current_user: TokenData = Depends(get_current_user)):
    sales = get_sales_df(current_user)
    if sales.empty:
        return []
    split = sales.groupby("otc_or_rx").agg(
        revenue_inr=("total_inr", "sum"),
        transactions=("transaction_id", "count"),
    ).reset_index()
    return split.to_dict(orient="records")


@app.get("/dashboard/quarterly-sales")
def quarterly_sales(current_user: TokenData = Depends(get_current_user)):
    """Revenue and units sold grouped by quarter (Q1/Q2/Q3/Q4)."""
    df = get_sales_df(current_user).copy()
    if df.empty:
        return []
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
    df = get_sales_df(current_user).copy()
    if df.empty:
        return []
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
    sales = get_sales_df(current_user).copy()
    stock = get_stock_df(current_user).copy()
    
    if sales.empty:
        return []

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


# In-memory demand log is no longer used. We now log to MongoDB 'unmet_demand' collection.


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
        try:
            db.unmet_demand.insert_one({
                "drug_name": drug_name,
                "pharmacy_id": pharmacy_id,
                "timestamp": pd.Timestamp.now().isoformat(),
            })
        except Exception as ex:
            print(f"Error logging unmet demand: {ex}")
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
    try:
        cursor = db.unmet_demand.find()
        logs = list(cursor)
    except Exception as ex:
        logs = []
        print(f"Error loading unmet demand: {ex}")

    if not logs:
        return {"unmet_demands": [], "message": "No unmet demand logged yet. Data builds up as customers use the Med Locator."}

    # Filter to this pharmacy's unmet demands (or all for admin)
    if current_user.role == "pharmacy":
        logs = [d for d in logs if d.get("pharmacy_id") == current_user.pharmacy_id]

    if not logs:
        return {"unmet_demands": [], "message": "No unmet demand for your branch yet."}

    # Count frequency per drug
    from collections import Counter
    drug_counts = Counter(d["drug_name"] for d in logs)

    result = []
    for drug, count in drug_counts.most_common(20):
        # Check which other pharmacies have this drug in stock (live from DB)
        available_elsewhere_docs = list(db.stock.find(
            {"drug_name": {"$regex": drug, "$options": "i"}, "stock_qty": {"$gt": 0}},
            {"_id": 0, "pharmacy_name": 1, "area": 1, "stock_qty": 1, "unit_price_inr": 1}
        ).limit(3))

        # Check if this pharmacy has it
        if current_user.role == "pharmacy":
            local_doc = db.stock.find_one(
                {"pharmacy_id": current_user.pharmacy_id, "drug_name": {"$regex": drug, "$options": "i"}},
                {"_id": 0, "stock_qty": 1}
            )
            local_stock = local_doc["stock_qty"] if local_doc else 0
        else:
            local_stock = None

        result.append({
            "drug_name": drug,
            "times_searched": count,
            "local_stock": int(local_stock) if local_stock is not None else None,
            "available_at_other_pharmacies": available_elsewhere_docs,
        })

    return {"unmet_demands": result}


class StockUploadItem(BaseModel):
    drug_name: str
    category: str
    manufacturer: str
    unit_price_inr: float
    stock_qty: int
    otc_or_rx: str  # 'OTC' or 'Rx'


@app.post("/dashboard/bulk-upload-stock")
def bulk_upload_stock(payload: List[StockUploadItem], current_user: TokenData = Depends(get_current_user)):
    """
    Overwrites the inventory stock list for the logged-in pharmacy manager's store.
    Validates numbers and constraints before updating MongoDB.
    """
    if current_user.role != "pharmacy":
        raise HTTPException(status_code=403, detail="Only pharmacy branch managers can upload stock data.")
        
    pharm_id = current_user.pharmacy_id
    pharm_name = current_user.pharmacy_name
    
    new_stock = []
    for index, item in enumerate(payload):
        dname = item.drug_name.strip()
        if not dname:
            raise HTTPException(status_code=400, detail=f"Row {index+1}: Drug Name cannot be empty.")
        if item.unit_price_inr < 0:
            raise HTTPException(status_code=400, detail=f"Row {index+1}: Unit Price cannot be negative.")
        if item.stock_qty < 0:
            raise HTTPException(status_code=400, detail=f"Row {index+1}: Stock Quantity cannot be negative.")
        if item.otc_or_rx not in ("OTC", "Rx"):
            raise HTTPException(status_code=400, detail=f"Row {index+1}: otc_or_rx must be 'OTC' or 'Rx'.")
            
        new_stock.append({
            "pharmacy_id": pharm_id,
            "pharmacy_name": pharm_name,
            "drug_name": dname,
            "category": item.category.strip() or "Other",
            "manufacturer": item.manufacturer.strip() or "Unknown",
            "unit_price_inr": round(item.unit_price_inr, 2),
            "stock_qty": item.stock_qty,
            "otc_or_rx": item.otc_or_rx
        })
        
    db.stock.delete_many({"pharmacy_id": pharm_id})
    
    if new_stock:
        db.stock.insert_many(new_stock)
        
    global df_stock
    df_stock = get_dataframe_from_mongo("stock")
    
    return {"message": f"Successfully updated stock list with {len(new_stock)} items for branch '{pharm_name}'."}


# =============================================================================
# 4. ADMIN — MEDICINE CATALOG MANAGEMENT (Upload Kaggle CSV + full CRUD)
# =============================================================================

CATEGORY_KEYWORDS_CATALOG = {
    "Analgesic":       ["paracetamol", "ibuprofen", "aceclofenac", "diclofenac",
                         "aspirin", "naproxen", "tramadol", "mefenamic"],
    "Antibiotic":       ["amoxycillin", "amoxicillin", "azithromycin", "ciprofloxacin",
                         "doxycycline", "cefixime", "ceftriaxone", "levofloxacin",
                         "ofloxacin", "clindamycin", "cefuroxime"],
    "Antihistamine":    ["cetirizine", "levocetirizine", "fexofenadine", "loratadine",
                         "montelukast", "chlorpheniramine"],
    "Antidiabetic":     ["metformin", "glimepiride", "glipizide", "sitagliptin",
                         "insulin", "vildagliptin", "voglibose"],
    "Cardiovascular":   ["amlodipine", "atorvastatin", "losartan", "telmisartan",
                         "atenolol", "metoprolol", "rosuvastatin", "clopidogrel",
                         "ramipril", "enalapril"],
    "Gastrointestinal": ["omeprazole", "pantoprazole", "ranitidine", "domperidone",
                         "rabeprazole", "esomeprazole", "ondansetron"],
    "Neurological":     ["gabapentin", "sertraline", "escitalopram", "amitriptyline",
                         "clonazepam", "pregabalin", "fluoxetine"],
    "Hormonal":         ["levothyroxine", "thyroxine"],
    "Respiratory":      ["salbutamol", "budesonide", "montelukast", "theophylline",
                         "formoterol", "ipratropium"],
    "Supplement":       ["vitamin", "calcium", "folic acid", "iron", "zinc",
                         "multivitamin", "cholecalciferol"],
    "Dermatological":   ["clobetasol", "mometasone", "betamethasone", "ketoconazole",
                         "fusidic", "tacrolimus", "clotrimazole"],
}


def _assign_category_from_composition(composition: str) -> str:
    if not composition or str(composition).lower() in ("nan", ""):
        return "Other"
    text = str(composition).lower()
    for cat, keywords in CATEGORY_KEYWORDS_CATALOG.items():
        for kw in keywords:
            if kw in text:
                return cat
    return "Other"


def _extract_pack_count(label: str) -> int:
    import re as _re
    if not label or str(label).lower() == "nan":
        return 1
    match = _re.search(r"of\s+(\d+)", str(label))
    if match:
        return max(int(match.group(1)), 1)
    return 1


def _guess_otc_rx(pack_size_label: str, category: str) -> str:
    if "injection" in str(pack_size_label).lower():
        return "Rx"
    if category in ("Antibiotic", "Cardiovascular", "Antidiabetic", "Neurological", "Hormonal"):
        return "Rx"
    return "OTC"


class MedicineUpdateRequest(BaseModel):
    name: Optional[str] = None
    manufacturer_name: Optional[str] = None
    price: Optional[float] = None
    pack_size_label: Optional[str] = None
    short_composition1: Optional[str] = None
    short_composition2: Optional[str] = None
    type: Optional[str] = None
    Is_discontinued: Optional[bool] = None
    category: Optional[str] = None
    otc_or_rx: Optional[str] = None


class BulkDeleteRequest(BaseModel):
    ids: List[str]


@app.post("/admin/medicines/upload-csv")
async def upload_medicine_csv(
    file: UploadFile = File(...),
    current_user: TokenData = Depends(require_admin),
):
    """
    Upload the Kaggle A_Z_medicines_dataset_of_India.csv (or any CSV with same columns).
    Parses, auto-assigns category from composition, computes unit price, and stores in MongoDB.
    Old medicine catalog is replaced on every upload.
    """
    from bson import ObjectId

    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are accepted.")

    contents = await file.read()
    try:
        import io as _io
        df_raw = pd.read_csv(_io.BytesIO(contents), low_memory=False)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {str(e)}")

    # Normalize column names (strip whitespace, handle special chars)
    df_raw.columns = [c.strip() for c in df_raw.columns]

    # Detect which column has the price — handles "price(₹)" and "price"
    price_col = None
    for col in df_raw.columns:
        if "price" in col.lower():
            price_col = col
            break
    if price_col is None:
        raise HTTPException(status_code=400, detail="Could not find a 'price' column in the CSV.")

    required_cols = ["name", price_col]
    missing = [c for c in required_cols if c not in df_raw.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required columns: {missing}")

    # Drop completely empty rows
    df_raw = df_raw.dropna(subset=["name"])
    df_raw = df_raw[df_raw["name"].str.strip() != ""]

    # Convert price to numeric
    df_raw[price_col] = pd.to_numeric(df_raw[price_col], errors="coerce")

    # Assign category
    comp_col = "short_composition1" if "short_composition1" in df_raw.columns else None
    if comp_col:
        df_raw["category"] = df_raw[comp_col].apply(_assign_category_from_composition)
    else:
        df_raw["category"] = "Other"

    # Compute unit price
    pack_col = "pack_size_label" if "pack_size_label" in df_raw.columns else None
    if pack_col:
        df_raw["pack_count"] = df_raw[pack_col].apply(_extract_pack_count)
    else:
        df_raw["pack_count"] = 1
    df_raw["unit_price_inr"] = (df_raw[price_col] / df_raw["pack_count"]).round(2)

    # OTC/Rx
    df_raw["otc_or_rx"] = df_raw.apply(
        lambda r: _guess_otc_rx(
            r.get(pack_col, "") if pack_col else "",
            r.get("category", "Other")
        ), axis=1
    )

    # Handle Is_discontinued
    if "Is_discontinued" in df_raw.columns:
        df_raw["Is_discontinued"] = df_raw["Is_discontinued"].apply(
            lambda x: True if str(x).strip().upper() in ("TRUE", "1", "YES") else False
        )
    else:
        df_raw["Is_discontinued"] = False

    # Build records
    keep_cols = ["name", price_col, "Is_discontinued", "category", "unit_price_inr", "otc_or_rx"]
    optional_cols = ["manufacturer_name", "type", "pack_size_label",
                     "short_composition1", "short_composition2"]
    for oc in optional_cols:
        if oc in df_raw.columns:
            keep_cols.append(oc)

    df_clean = df_raw[keep_cols].copy()
    # Rename price column for consistency
    if price_col != "price":
        df_clean = df_clean.rename(columns={price_col: "price"})

    # Replace NaN with None for MongoDB
    df_clean = df_clean.where(pd.notnull(df_clean), None)

    records = df_clean.to_dict(orient="records")

    # Drop old catalog + insert new
    db.medicines.drop()
    if records:
        db.medicines.insert_many(records)

    # Create index for fast search
    try:
        db.medicines.create_index("name")
        db.medicines.create_index("category")
    except Exception:
        pass

    preview = []
    for r in records[:5]:
        preview.append({
            "name": r.get("name"),
            "category": r.get("category"),
            "price": r.get("price"),
            "unit_price_inr": r.get("unit_price_inr"),
            "otc_or_rx": r.get("otc_or_rx"),
        })

    return {
        "message": f"Successfully uploaded {len(records):,} medicines.",
        "total_rows": len(records),
        "preview": preview,
    }


@app.get("/admin/medicines")
def list_medicines(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=5, le=100),
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    otc_or_rx: Optional[str] = Query(None),
    discontinued: Optional[bool] = Query(None),
    current_user: TokenData = Depends(require_admin),
):
    """
    Returns paginated medicine catalog with optional search/filter.
    search      : partial match on medicine name (case-insensitive)
    category    : exact match on category (Analgesic, Antibiotic, etc.)
    otc_or_rx   : 'OTC' or 'Rx'
    discontinued: true / false
    """
    from bson import ObjectId

    query: dict = {}
    if search:
        query["name"] = {"$regex": search, "$options": "i"}
    if category:
        query["category"] = category
    if otc_or_rx:
        query["otc_or_rx"] = otc_or_rx
    if discontinued is not None:
        query["Is_discontinued"] = discontinued

    total = db.medicines.count_documents(query)
    skip = (page - 1) * page_size

    cursor = db.medicines.find(query).skip(skip).limit(page_size)
    rows = []
    for doc in cursor:
        doc["_id"] = str(doc["_id"])
        rows.append(doc)

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": math.ceil(total / page_size) if total > 0 else 1,
        "data": rows,
    }


@app.get("/admin/medicines/categories")
def get_medicine_categories(current_user: TokenData = Depends(require_admin)):
    """Returns distinct categories present in the uploaded catalog."""
    cats = db.medicines.distinct("category")
    return {"categories": sorted([c for c in cats if c])}


@app.get("/admin/medicines/{medicine_id}")
def get_medicine(medicine_id: str, current_user: TokenData = Depends(require_admin)):
    """Get a single medicine by MongoDB _id."""
    from bson import ObjectId
    try:
        oid = ObjectId(medicine_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid medicine ID format.")
    doc = db.medicines.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Medicine not found.")
    doc["_id"] = str(doc["_id"])
    return doc


@app.put("/admin/medicines/{medicine_id}")
def update_medicine(
    medicine_id: str,
    payload: MedicineUpdateRequest,
    current_user: TokenData = Depends(require_admin),
):
    """Edit an existing medicine record. Only provided fields are updated."""
    from bson import ObjectId
    try:
        oid = ObjectId(medicine_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid medicine ID format.")

    update_fields = {k: v for k, v in payload.dict().items() if v is not None}
    if not update_fields:
        raise HTTPException(status_code=400, detail="No fields provided to update.")

    # Recompute category if composition changed
    if "short_composition1" in update_fields and "category" not in update_fields:
        update_fields["category"] = _assign_category_from_composition(
            update_fields["short_composition1"]
        )

    result = db.medicines.update_one({"_id": oid}, {"$set": update_fields})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Medicine not found.")
    return {"message": "Medicine updated successfully."}


@app.delete("/admin/medicines/bulk")
def bulk_delete_medicines(
    payload: BulkDeleteRequest,
    current_user: TokenData = Depends(require_admin),
):
    """Delete multiple medicines by a list of _id strings."""
    from bson import ObjectId
    oids = []
    for id_str in payload.ids:
        try:
            oids.append(ObjectId(id_str))
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid ID: {id_str}")
    result = db.medicines.delete_many({"_id": {"$in": oids}})
    return {"message": f"Deleted {result.deleted_count} medicine(s)."}


@app.delete("/admin/medicines/{medicine_id}")
def delete_medicine(medicine_id: str, current_user: TokenData = Depends(require_admin)):
    """Delete a single medicine by _id."""
    from bson import ObjectId
    try:
        oid = ObjectId(medicine_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid medicine ID format.")
    result = db.medicines.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Medicine not found.")
    return {"message": "Medicine deleted successfully."}


# =============================================================================
# REAL-TIME PHARMACY PROFILE
# =============================================================================

class PharmacyProfileUpdate(BaseModel):
    pharmacy_name: Optional[str] = None
    area: Optional[str] = None
    address: Optional[str] = None
    contact_number: Optional[str] = None
    open_time: Optional[str] = None
    close_time: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

@app.get("/pharmacy/profile")
def get_pharmacy_profile(current_user: TokenData = Depends(get_current_user)):
    if current_user.role != "pharmacy":
        raise HTTPException(status_code=403, detail="Only pharmacies have a profile.")
    
    pharm_id = current_user.pharmacy_id
    profile = db.pharmacies.find_one({"pharmacy_id": pharm_id}, {"_id": 0})
    if not profile:
        raise HTTPException(status_code=404, detail="Pharmacy profile not found.")
    return {"profile": profile}

@app.put("/pharmacy/profile")
def update_pharmacy_profile(payload: PharmacyProfileUpdate, current_user: TokenData = Depends(get_current_user)):
    if current_user.role != "pharmacy":
        raise HTTPException(status_code=403, detail="Only pharmacies can update their profile.")
    
    pharm_id = current_user.pharmacy_id
    update_data = {k: v for k, v in payload.dict().items() if v is not None}
    
    if not update_data:
        return {"message": "No fields provided to update."}
        
    db.pharmacies.update_one({"pharmacy_id": pharm_id}, {"$set": update_data})
    
    return {"message": "Profile updated successfully."}


# =============================================================================
# REAL-TIME STOCK MANAGEMENT
# =============================================================================

class StockItem(BaseModel):
    drug_name: str
    category: Optional[str] = "Unknown"
    manufacturer: Optional[str] = "Unknown"
    unit_price_inr: float
    stock_qty: int
    otc_or_rx: Optional[str] = "OTC"

@app.get("/pharmacy/stock")
def get_pharmacy_stock(current_user: TokenData = Depends(get_current_user)):
    """Get the current stock for the logged in pharmacy."""
    if current_user.role != "pharmacy":
        raise HTTPException(status_code=403, detail="Only pharmacies can view their stock.")
    
    pharm_id = current_user.pharmacy_id
    if not pharm_id:
        raise HTTPException(status_code=400, detail="No pharmacy ID found for this user.")
        
    cursor = db.stock.find({"pharmacy_id": pharm_id}, {"_id": 0})
    return {"stock": list(cursor)}

@app.get("/pharmacy/medicines/search")
def search_global_medicines(q: str = "", current_user: TokenData = Depends(get_current_user)):
    """Search the global medicine catalog to add to stock."""
    if current_user.role != "pharmacy":
        raise HTTPException(status_code=403, detail="Only pharmacies can use this endpoint.")
    
    if not q or len(q.strip()) < 2:
        return {"results": []}
        
    query = {"name": {"$regex": q.strip(), "$options": "i"}}
    cursor = db.medicines.find(query, {"_id": 0}).limit(20)
    
    # Map the Kaggle CSV fields to what Inventory.jsx expects
    mapped_results = []
    for doc in cursor:
        mapped_results.append({
            "drug_name": doc.get("name"),
            "category": doc.get("category", "Other"),
            "manufacturer": doc.get("manufacturer_name", "Unknown"),
            "unit_price_inr": doc.get("unit_price_inr", 0),
            "otc_or_rx": doc.get("otc_or_rx", "OTC")
        })
        
    return {"results": mapped_results}



@app.post("/pharmacy/stock")
def add_update_pharmacy_stock(payload: StockItem, current_user: TokenData = Depends(get_current_user)):
    """Add or update a specific medicine in the pharmacy's stock."""
    if current_user.role != "pharmacy":
        raise HTTPException(status_code=403, detail="Only pharmacies can update their stock.")
    
    pharm_id = current_user.pharmacy_id
    if not pharm_id:
        raise HTTPException(status_code=400, detail="No pharmacy ID found for this user.")

    # Find the pharmacy name
    pharm_record = db.pharmacies.find_one({"pharmacy_id": pharm_id})
    pharm_name = pharm_record["pharmacy_name"] if pharm_record else "Unknown Pharmacy"

    result = db.stock.update_one(
        {"pharmacy_id": pharm_id, "drug_name": payload.drug_name},
        {"$set": {
            "pharmacy_name": pharm_name,
            "category": payload.category,
            "manufacturer": payload.manufacturer,
            "unit_price_inr": payload.unit_price_inr,
            "stock_qty": payload.stock_qty,
            "otc_or_rx": payload.otc_or_rx
        }},
        upsert=True
    )
    
    return {"message": "Stock updated successfully."}


# =============================================================================
# REAL-TIME POINT OF SALE
# =============================================================================

class SaleItem(BaseModel):
    drug_name: str
    quantity: int
    unit_price_inr: float
    category: Optional[str] = "Unknown"
    otc_or_rx: Optional[str] = "OTC"

class POSRequest(BaseModel):
    items: List[SaleItem]

@app.post("/pharmacy/sales")
def record_sale(payload: POSRequest, current_user: TokenData = Depends(get_current_user)):
    """Record a real-time sale and deduct from stock."""
    import datetime
    import uuid
    if current_user.role != "pharmacy":
        raise HTTPException(status_code=403, detail="Only pharmacies can record sales.")
    
    pharm_id = current_user.pharmacy_id
    
    pharm_record = db.pharmacies.find_one({"pharmacy_id": pharm_id})
    pharm_name = pharm_record["pharmacy_name"] if pharm_record else "Unknown Pharmacy"
    area = pharm_record.get("area", "Unknown Area") if pharm_record else "Unknown Area"
    
    transaction_id = str(uuid.uuid4())[:8].upper()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    now_date = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    
    sales_to_insert = []
    
    for item in payload.items:
        if item.quantity <= 0:
            continue
            
        # Deduct from stock
        stock_res = db.stock.update_one(
            {"pharmacy_id": pharm_id, "drug_name": item.drug_name, "stock_qty": {"$gte": item.quantity}},
            {"$inc": {"stock_qty": -item.quantity}}
        )
        
        if stock_res.modified_count == 0:
            existing = db.stock.find_one({"pharmacy_id": pharm_id, "drug_name": item.drug_name})
            if existing:
                raise HTTPException(status_code=400, detail=f"Not enough stock for {item.drug_name}. Current: {existing.get('stock_qty', 0)}")
            else:
                raise HTTPException(status_code=400, detail=f"Item {item.drug_name} not found in stock.")
                
        total_inr = round(item.quantity * item.unit_price_inr, 2)
        sales_to_insert.append({
            "transaction_id": f"TRX-{transaction_id}",
            "date": now_date,
            "timestamp": now_iso,
            "pharmacy_id": pharm_id,
            "pharmacy_name": pharm_name,
            "area": area,
            "drug_name": item.drug_name,
            "category": item.category,
            "quantity": item.quantity,
            "unit_price_inr": item.unit_price_inr,
            "total_inr": total_inr,
            "otc_or_rx": item.otc_or_rx
        })
        
    if sales_to_insert:
        db.sales_transactions.insert_many(sales_to_insert)
        
    return {"message": "Sale recorded successfully.", "transaction_id": f"TRX-{transaction_id}"}

@app.get("/")
def root():
    return {"message": "Pharmalink AI API is running.", "docs": "/docs"}

