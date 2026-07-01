"""
Pharmalink AI - Auth module
=============================
Simple but real JWT-based auth:
- Pharmacy staff log in with their pharmacy_id (e.g. "ph001") + password.
- Head office logs in with "admin" + password.
- On login, a JWT token is issued containing role + pharmacy_id.
- Dashboard endpoints read this token and filter data accordingly:
    role == "pharmacy" -> only that branch's data
    role == "admin"    -> all branches (network-wide view)

This is intentionally simple (JSON file instead of a real database) since
it's a one-week course project, but the security mechanics (bcrypt hashing,
JWT signing/expiry) are the same ones used in production systems.
"""

import json
import os
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config - in a real deployment, SECRET_KEY must come from an environment
# variable, never hardcoded. Fine for a local student demo.
# ---------------------------------------------------------------------------
SECRET_KEY = "pharmalink-ai-demo-secret-change-this-in-production"
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 8  # 8 hour session

USERS_FILE = os.path.join(os.path.dirname(__file__), "users.json")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def load_users():
    with open(USERS_FILE) as f:
        return json.load(f)


def save_users(users: dict):
    with open(USERS_FILE, "w") as f:
        json.dump(users, f, indent=2)


class TokenData(BaseModel):
    username: str
    role: str
    pharmacy_id: str | None
    pharmacy_name: str


def verify_password(plain_password: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain_password.encode(), hashed.encode())


def authenticate_user(username: str, password: str, client_ip: str | None = None):
    """
    Authenticates a user. On success, also records the login timestamp + IP
    into users.json, so the admin panel can show "last login" per account.
    Returns None on failure (wrong username, wrong password, or disabled account).
    """
    users = load_users()
    user = users.get(username.lower())
    if not user:
        return None
    if not user.get("active", True):
        return None  # account disabled by admin
    if not verify_password(password, user["password_hash"]):
        return None

    # Record this successful login
    user["last_login_at"] = datetime.now(timezone.utc).isoformat()
    user["last_login_ip"] = client_ip
    users[username.lower()] = user
    save_users(users)

    return user


def create_access_token(user: dict) -> str:
    payload = {
        "sub": user["username"],
        "role": user["role"],
        "pharmacy_id": user["pharmacy_id"],
        "pharmacy_name": user["pharmacy_name"],
        "exp": datetime.now(timezone.utc) + timedelta(minutes=TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme)) -> TokenData:
    """Dependency: decode JWT, return user info. Used to protect routes."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials. Please log in again.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if username is None:
            raise credentials_exception
        return TokenData(
            username=username,
            role=payload.get("role"),
            pharmacy_id=payload.get("pharmacy_id"),
            pharmacy_name=payload.get("pharmacy_name"),
        )
    except JWTError:
        raise credentials_exception


def require_admin(current_user: TokenData = Depends(get_current_user)) -> TokenData:
    """Dependency: like get_current_user, but also blocks non-admins (403)."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action requires head office (admin) access.",
        )
    return current_user


# ---------------------------------------------------------------------------
# Admin user-management helpers
# ---------------------------------------------------------------------------
def list_users_safe():
    """
    Returns all accounts WITHOUT password hashes - safe to send to the
    frontend for the admin panel. Never expose password_hash over the API.
    """
    users = load_users()
    safe = []
    for username, info in users.items():
        safe.append({
            "username": info["username"],
            "role": info["role"],
            "pharmacy_id": info["pharmacy_id"],
            "pharmacy_name": info["pharmacy_name"],
            "active": info.get("active", True),
            "created_at": info.get("created_at"),
            "last_login_at": info.get("last_login_at"),
            "last_login_ip": info.get("last_login_ip"),
        })
    return safe


def admin_reset_password(username: str, new_password: str):
    users = load_users()
    user = users.get(username.lower())
    if not user:
        return False
    user["password_hash"] = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
    users[username.lower()] = user
    save_users(users)
    return True


def admin_set_active(username: str, active: bool):
    users = load_users()
    user = users.get(username.lower())
    if not user:
        return False
    user["active"] = active
    users[username.lower()] = user
    save_users(users)
    return True

