import json
import os
import hashlib
import hmac
import secrets
from pathlib import Path
from fastapi import FastAPI, HTTPException, Body, Cookie, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_FILE = BASE_DIR / "data" / "disaster_data.json"
PUBLIC_DIR = BASE_DIR / "public"

# Admin Authentication & Encrypted Password Hashing
ADMIN_EMAIL = "admin@alpas.com"
ADMIN_PASSWORD_SALT = "nagarik_alert_admin_salt_2026"
ADMIN_PASSWORD_HASH = "131747aa3602fc92d0b8980487a63740add3ef567d959ace95bbd8d211304b96"

active_sessions = set()

def verify_admin_credentials(email: str, plain_password: str) -> bool:
    if not email or email.strip().lower() != ADMIN_EMAIL:
        return False
    calc_hash = hashlib.pbkdf2_hmac(
        'sha256',
        plain_password.encode('utf-8'),
        ADMIN_PASSWORD_SALT.encode('utf-8'),
        100000
    ).hex()
    return hmac.compare_digest(calc_hash, ADMIN_PASSWORD_HASH)

def is_authenticated(admin_session: str | None) -> bool:
    return bool(admin_session and admin_session in active_sessions)

app = FastAPI(
    title="Bhotekoshi Flood Disaster Dashboard API",
    description="API for real-time Bhotekoshi river flood information, casualties, and local government status.",
    version="1.0.0"
)

def load_disaster_data():
    """Dynamically load disaster data from JSON file on every request."""
    if not DATA_FILE.exists():
        raise HTTPException(status_code=444, detail="Disaster data file not found.")
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            # Add file mtime metadata for live refresh detection
            data["_server_mtime"] = os.path.getmtime(DATA_FILE)
            return data
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Invalid JSON data structure: {str(e)}")

@app.get("/api/data")
def get_disaster_data():
    """Return the entire disaster dataset dynamically."""
    data = load_disaster_data()
    return JSONResponse(
        content=data,
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.get("/api/summary")
def get_disaster_summary():
    """Return overall disaster summary stats."""
    data = load_disaster_data()
    return {
        "disaster_info": data.get("disaster_info", {}),
        "overall_summary": data.get("overall_summary", {}),
        "total_local_governments": len(data.get("local_governments", [])),
        "server_mtime": data.get("_server_mtime")
    }

@app.get("/api/health")
def health_check():
    """Health check endpoint."""
    return {"status": "ok", "data_file_exists": DATA_FILE.exists()}

# Admin Authentication API Endpoints
@app.post("/api/admin/login")
async def admin_login(response: Response, payload: dict = Body(...)):
    email = payload.get("email", "")
    password = payload.get("password", "")
    
    if not verify_admin_credentials(email, password):
        raise HTTPException(status_code=401, detail="इमेल वा पासवर्ड अमान्य छ (Invalid email or password).")
    
    session_token = secrets.token_hex(32)
    active_sessions.add(session_token)
    
    response.set_cookie(
        key="admin_session",
        value=session_token,
        httponly=True,
        samesite="lax",
        max_age=86400  # 24 hours
    )
    return {"status": "success", "message": "Admin authenticated successfully."}

@app.post("/api/admin/logout")
async def admin_logout(response: Response, admin_session: str | None = Cookie(None)):
    if admin_session and admin_session in active_sessions:
        active_sessions.remove(admin_session)
    response.delete_cookie("admin_session")
    return {"status": "success", "message": "Logged out successfully."}

@app.get("/api/admin/check-auth")
async def check_admin_auth(admin_session: str | None = Cookie(None)):
    authenticated = is_authenticated(admin_session)
    return {"authenticated": authenticated, "email": ADMIN_EMAIL if authenticated else None}

# Mount public directory for static assets
app.mount("/static", StaticFiles(directory=PUBLIC_DIR), name="static")

@app.get("/", response_class=HTMLResponse)
def read_root():
    """Serve main index.html dashboard."""
    index_file = PUBLIC_DIR / "index.html"
    if index_file.exists():
        return index_file.read_text(encoding="utf-8")
    return HTMLResponse("<h2>Dashboard index.html file not found.</h2>", status_code=404)

@app.get("/admin", response_class=HTMLResponse)
def read_admin(admin_session: str | None = Cookie(None)):
    """Serve Admin dashboard management portal or login page if unauthenticated."""
    if not is_authenticated(admin_session):
        login_file = PUBLIC_DIR / "admin_login.html"
        if login_file.exists():
            return login_file.read_text(encoding="utf-8")
        return HTMLResponse("<h2>Admin login template missing.</h2>", status_code=404)

    admin_file = PUBLIC_DIR / "admin.html"
    if admin_file.exists():
        return admin_file.read_text(encoding="utf-8")
    return HTMLResponse("<h2>Admin admin.html file not found.</h2>", status_code=404)

@app.post("/api/admin/update")
async def update_disaster_data(payload: dict = Body(...), admin_session: str | None = Cookie(None)):
    """Update disaster_data.json file directly from Admin Panel."""
    if not is_authenticated(admin_session):
        raise HTTPException(status_code=401, detail="Authentication required. Please log in.")
        
    clean_data = {k: v for k, v in payload.items() if not k.startswith("_")}
    
    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(clean_data, f, ensure_ascii=False, indent=2)
        
        return {
            "status": "success",
            "message": "Disaster data updated successfully.",
            "mtime": os.path.getmtime(DATA_FILE)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save data: {str(e)}")
