"""Backend regression tests for Shelfie API.

Runs against public preview URL (EXPO_BACKEND_URL). Covers health, catalog fuzzy,
library CRUD, scan happy/error paths.
"""
import io
import os
import time
import pytest
import requests
from PIL import Image, ImageDraw

# Backend URL from frontend .env
def _load_base():
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL") or line.startswith("EXPO_BACKEND_URL"):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    return (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or "").rstrip("/")

BASE_URL = _load_base()
assert BASE_URL, "EXPO_BACKEND_URL not set"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    return s


# ---------- Health & Catalog ----------
class TestHealth:
    def test_root_health(self, api):
        r = api.get(f"{BASE_URL}/api/", timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j.get("service") == "shelfie"
        assert j.get("status") == "ok"


class TestCatalog:
    def test_catalog_default(self, api):
        r = api.get(f"{BASE_URL}/api/catalog", timeout=15)
        assert r.status_code == 200
        results = r.json().get("results", [])
        assert isinstance(results, list)
        assert len(results) > 0, "Catalog should be seeded"

    def test_fuzzy_hobbit(self, api):
        r = api.get(f"{BASE_URL}/api/catalog", params={"q": "hobbit"}, timeout=15)
        assert r.status_code == 200
        titles = [x["title"].lower() for x in r.json()["results"]]
        assert any("hobbit" in t for t in titles), f"Expected Hobbit match, got {titles}"

    def test_fuzzy_philosopher_stone(self, api):
        r = api.get(f"{BASE_URL}/api/catalog", params={"q": "Philosopher Stone"}, timeout=15)
        assert r.status_code == 200
        results = r.json()["results"]
        assert results, "Should match Harry Potter"
        top = results[0]["title"].lower()
        assert "philosopher" in top or "harry potter" in top, f"Top match wrong: {top}"

    def test_fuzzy_children_of_dune(self, api):
        r = api.get(f"{BASE_URL}/api/catalog", params={"q": "children of dune"}, timeout=15)
        assert r.status_code == 200
        results = r.json()["results"]
        assert results, "Should match Children of Dune"
        top = results[0]["title"].lower()
        assert "children of dune" in top, f"Expected 'Children of Dune' as top, got: {top}"

    def test_fuzzy_tolkien_author(self, api):
        r = api.get(f"{BASE_URL}/api/catalog", params={"q": "Tolkien"}, timeout=15)
        assert r.status_code == 200
        results = r.json()["results"]
        assert results, "Should match Tolkien books"
        # Ensure at least one result has Tolkien as author
        assert any("tolkien" in x["author"].lower() for x in results), \
            f"No Tolkien author results: {results[:3]}"


# ---------- Library CRUD ----------
class TestLibraryCRUD:
    created_id = None

    def test_library_list_initial(self, api):
        r = api.get(f"{BASE_URL}/api/library", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_confirm_manual_book(self, api):
        payload = {
            "title": "TEST_The Manual Book",
            "author": "TEST_Author",
            "cover_url": None,
            "confidence": 1.0,
        }
        r = api.post(f"{BASE_URL}/api/library/confirm", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["title"] == payload["title"]
        assert body["author"] == payload["author"]
        assert body["id"]
        assert body["confirmed_at"]
        TestLibraryCRUD.created_id = body["id"]

    def test_library_contains_created(self, api):
        assert TestLibraryCRUD.created_id
        r = api.get(f"{BASE_URL}/api/library", timeout=15)
        assert r.status_code == 200
        ids = [b["id"] for b in r.json()]
        assert TestLibraryCRUD.created_id in ids

    def test_get_single_book(self, api):
        bid = TestLibraryCRUD.created_id
        r = api.get(f"{BASE_URL}/api/library/{bid}", timeout=15)
        assert r.status_code == 200
        assert r.json()["id"] == bid
        assert r.json()["title"] == "TEST_The Manual Book"

    def test_confirm_with_catalog_id(self, api):
        payload = {
            "catalog_id": 1,
            "title": "TEST_Catalog Book",
            "author": "TEST_Cat Author",
            "confidence": 0.95,
        }
        r = api.post(f"{BASE_URL}/api/library/confirm", json=payload, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["catalog_id"] == 1
        # Verify via GET
        r2 = api.get(f"{BASE_URL}/api/library/{body['id']}", timeout=15)
        assert r2.status_code == 200
        assert r2.json()["catalog_id"] == 1
        # cleanup
        api.delete(f"{BASE_URL}/api/library/{body['id']}", timeout=15)

    def test_delete_book(self, api):
        bid = TestLibraryCRUD.created_id
        r = api.delete(f"{BASE_URL}/api/library/{bid}", timeout=15)
        assert r.status_code == 200
        # verify 404 after delete
        r2 = api.get(f"{BASE_URL}/api/library/{bid}", timeout=15)
        assert r2.status_code == 404

    def test_get_nonexistent_book(self, api):
        r = api.get(f"{BASE_URL}/api/library/does-not-exist", timeout=15)
        assert r.status_code == 404


# ---------- Scan Endpoint ----------
def _make_shelf_image(bytes_out=True):
    """Synthesize a bookshelf photo with vertical colored rectangles (spines)."""
    W, H = 800, 600
    img = Image.new("RGB", (W, H), (30, 20, 15))
    draw = ImageDraw.Draw(img)
    colors = [(180, 40, 40), (40, 120, 180), (200, 180, 50), (60, 160, 70),
              (150, 60, 180), (200, 100, 40), (80, 80, 200)]
    x = 20
    spine_w = 100
    gap = 8
    for c in colors:
        draw.rectangle([x, 20, x + spine_w, H - 20], fill=c, outline=(0, 0, 0), width=3)
        x += spine_w + gap
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    buf.seek(0)
    return buf.read() if bytes_out else buf


class TestScan:
    def test_scan_empty_upload(self, api):
        # send empty bytes
        files = {"image": ("blank.jpg", b"", "image/jpeg")}
        r = api.post(f"{BASE_URL}/api/scan", files=files, timeout=60)
        assert r.status_code == 400, f"Expected 400 for empty upload, got {r.status_code}: {r.text}"

    def test_scan_missing_file_field(self, api):
        # No file field at all
        r = api.post(f"{BASE_URL}/api/scan", data={"foo": "bar"}, timeout=30)
        assert r.status_code in (400, 422), f"Expected 400/422, got {r.status_code}: {r.text}"
        # Ensure JSON body (not 500 crash)
        try:
            r.json()
        except Exception:
            pytest.fail("Response is not valid JSON")

    def test_scan_bad_image_bytes(self, api):
        files = {"image": ("junk.jpg", b"this-is-not-a-jpeg", "image/jpeg")}
        r = api.post(f"{BASE_URL}/api/scan", files=files, timeout=60)
        # Should be 400 (BAD_IMAGE) not 500
        assert r.status_code in (400, 422), f"Expected 400/422 got {r.status_code}: {r.text}"

    @pytest.mark.timeout(180)
    def test_scan_synthetic_shelf(self, api):
        """Scan with synthetic shelf image. Gemini may mark unreadable — that's fine.
        We only require the endpoint responds with valid ScanResponse JSON structure
        or 422 ZERO_BOOKS."""
        img_bytes = _make_shelf_image()
        files = {"image": ("shelf.jpg", img_bytes, "image/jpeg")}
        t0 = time.time()
        r = api.post(f"{BASE_URL}/api/scan", files=files, timeout=180)
        elapsed = time.time() - t0
        print(f"Scan took {elapsed:.1f}s status={r.status_code}")
        assert r.status_code in (200, 422), f"Unexpected status {r.status_code}: {r.text[:500]}"
        body = r.json()
        if r.status_code == 422:
            detail = body.get("detail", "")
            assert "ZERO_BOOKS" in detail, f"Expected ZERO_BOOKS detail, got: {detail}"
        else:
            # Validate ScanResponse structure
            for key in ("scan_id", "detected_count", "auto_added_count", "review", "auto_added"):
                assert key in body, f"Missing key {key} in scan response"
            assert isinstance(body["review"], list)
            assert isinstance(body["auto_added"], list)
            # Cleanup any auto_added books to keep DB clean
            for b in body.get("auto_added", []):
                # auto_added books are in library — find and delete by title
                pass
