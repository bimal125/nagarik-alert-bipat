import json
import os
import time
import pytest
from fastapi.testclient import TestClient
from src.main import app, DATA_FILE

client = TestClient(app)

def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    json_data = response.json()
    assert json_data["status"] == "ok"
    assert json_data["data_file_exists"] is True

def test_get_disaster_data():
    response = client.get("/api/data")
    assert response.status_code == 200
    data = response.json()
    assert "disaster_info" in data
    assert "overall_summary" in data
    assert "local_governments" in data
    assert len(data["local_governments"]) > 0

def test_local_governments_structure():
    response = client.get("/api/data")
    data = response.json()
    local_govs = data["local_governments"]
    
    # Check that Bidur Municipality exists
    bidur = next((item for item in local_govs if item["id"] == "bidur_mun"), None)
    assert bidur is not None
    assert bidur["name_np"] == "विदुर नगरपालिका"
    assert "wards" in bidur
    assert len(bidur["wards"]) > 0

def test_summary_endpoint():
    response = client.get("/api/summary")
    assert response.status_code == 200
    summary = response.json()
    assert "overall_summary" in summary
    assert summary["overall_summary"]["total_deaths"] >= 0

def test_live_json_update():
    """Test that modifying the disaster_data.json file immediately updates API output."""
    # 1. Read current JSON
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        original_data = json.load(f)
    
    try:
        # 2. Modify value temporarily
        modified_data = json.loads(json.dumps(original_data))
        modified_data["overall_summary"]["rescued_people"] = 9999
        
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(modified_data, f, ensure_ascii=False, indent=2)
            
        # 3. Query API
        response = client.get("/api/data")
        assert response.status_code == 200
        data = response.json()
        assert data["overall_summary"]["rescued_people"] == 9999
        
    finally:
        # 4. Restore original JSON
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(original_data, f, ensure_ascii=False, indent=2)
            
    # Verify restored value
    response = client.get("/api/data")
    assert response.json()["overall_summary"]["rescued_people"] == original_data["overall_summary"]["rescued_people"]

def test_serve_root():
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]

def test_serve_admin_unauthenticated():
    client.cookies.clear()
    response = client.get("/admin")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "प्रशासकीय लगइन" in response.text

def test_admin_login_invalid():
    client.cookies.clear()
    response = client.post("/api/admin/login", json={"email": "wrong@alpas.com", "password": "wrongpassword"})
    assert response.status_code == 401

def test_admin_login_valid():
    client.cookies.clear()
    response = client.post("/api/admin/login", json={"email": "admin@alpas.com", "password": "152207@152207"})
    assert response.status_code == 200
    assert response.json()["status"] == "success"

def test_admin_update_unauthenticated():
    client.cookies.clear()
    response = client.post("/api/admin/update", json={"test": "data"})
    assert response.status_code == 401

def test_admin_update_authenticated():
    client.cookies.clear()
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        original_data = json.load(f)

    try:
        # 1. Login first
        login_res = client.post("/api/admin/login", json={"email": "admin@alpas.com", "password": "152207@152207"})
        assert login_res.status_code == 200

        # 2. Perform authenticated update
        modified_data = json.loads(json.dumps(original_data))
        modified_data["overall_summary"]["total_deaths"] = 8888
        
        response = client.post("/api/admin/update", json=modified_data)
        assert response.status_code == 200
        assert response.json()["status"] == "success"

        # 3. Verify update via GET /api/data
        get_res = client.get("/api/data")
        assert get_res.status_code == 200
        assert get_res.json()["overall_summary"]["total_deaths"] == 8888

    finally:
        # Restore original data
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(original_data, f, ensure_ascii=False, indent=2)



