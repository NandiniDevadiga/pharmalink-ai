"""
Generates users.json - login credentials for each pharmacy branch + 1 admin account.
Passwords are bcrypt-hashed, never stored in plain text.

Default password for every demo pharmacy account: "pharma123"
Default admin password: "admin123"

CHANGE THESE before any real deployment. This is fine for a course/demo project.
"""
import bcrypt
import json
import pandas as pd
import os

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
df_pharmacies = pd.read_csv(os.path.join(DATA_DIR, "pharmacies.csv"))


def hash_pw(plain):
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


users = {}

# One login per pharmacy branch -> role "pharmacy", scoped to their own pharmacy_id
for _, row in df_pharmacies.iterrows():
    username = row["pharmacy_id"].lower()  # e.g. ph001
    users[username] = {
        "username": username,
        "password_hash": hash_pw("pharma123"),
        "role": "pharmacy",
        "pharmacy_id": row["pharmacy_id"],
        "pharmacy_name": row["pharmacy_name"],
        "created_at": None,       # filled in by main.py on first save, or now
        "last_login_at": None,    # updated every successful login
        "last_login_ip": None,
        "active": True,           # admin can disable an account without deleting it
    }

# One head-office admin login -> role "admin", sees all branches
users["admin"] = {
    "username": "admin",
    "password_hash": hash_pw("admin123"),
    "role": "admin",
    "pharmacy_id": None,
    "pharmacy_name": "Head Office",
    "created_at": None,
    "last_login_at": None,
    "last_login_ip": None,
    "active": True,
}

import datetime
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
for u in users.values():
    u["created_at"] = now

with open(os.path.join(os.path.dirname(__file__), "users.json"), "w") as f:
    json.dump(users, f, indent=2)

print(f"Created {len(users)} accounts in users.json")
print("\nDemo logins (for your report / viva):")
for u, info in users.items():
    pw = "admin123" if info["role"] == "admin" else "pharma123"
    print(f"  {u:10s} / {pw:12s} -> {info['role']:8s} ({info['pharmacy_name']})")

