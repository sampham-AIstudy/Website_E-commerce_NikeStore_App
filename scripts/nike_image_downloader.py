"""
nike_image_downloader.py
========================
Tai anh san pham Nike va tu dong phan loai vao:
  public/assets/products/men/
  public/assets/products/women/
  public/assets/products/kids/
  public/assets/products/misc/

Cach dung:
  pip install requests beautifulsoup4 pillow tqdm
  python scripts/nike_image_downloader.py
  python scripts/nike_image_downloader.py --category men --limit 30
  python scripts/nike_image_downloader.py --url "https://www.nike.com/vn/w/womens-shoes" --category women
  python scripts/nike_image_downloader.py --rebuild-cache
"""

import os
import sys
import re
import json
import time
import random
import hashlib
import argparse
import urllib.parse
from pathlib import Path
from io import BytesIO

# ─── Cai thu vien neu thieu ────────────────────────────────────────────────────
def ensure_packages():
    required = {
        "requests": "requests",
        "bs4": "beautifulsoup4",
        "PIL": "pillow",
        "tqdm": "tqdm",
    }
    import importlib, subprocess
    for module, pkg in required.items():
        try:
            importlib.import_module(module)
        except ImportError:
            print(f"[INFO] Cai dat {pkg}...")
            subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "-q"])

ensure_packages()

import requests
from bs4 import BeautifulSoup
from PIL import Image
from tqdm import tqdm

# ─── Cau hinh ──────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
ASSETS_DIR   = PROJECT_ROOT / "public" / "assets" / "products"

# [1] File cache luu hash cua anh da tai (nam canh script)
HASH_CACHE_FILE = SCRIPT_DIR / ".downloaded_hashes.json"

# [1b] File cache luu URL da tai thanh cong (tranh tai lai cung URL)
URL_CACHE_FILE  = SCRIPT_DIR / ".downloaded_urls.json"

CATEGORIES = ["men", "women", "kids", "misc"]

# Nike product pages (VN)
NIKE_PAGES = {
    "men":   [
        "https://www.nike.com/vn/w/mens-shoes-nik1zy7ok",
        "https://www.nike.com/vn/w/mens-clothing-6ymx6",
    ],
    "women": [
        "https://www.nike.com/vn/w/womens-shoes-5e1x6",
        "https://www.nike.com/vn/w/womens-clothing-5e1x6z6ymx6",
    ],
    "kids":  [
        "https://www.nike.com/vn/w/kids-shoes-v4dhzy7ok",
        "https://www.nike.com/vn/w/kids-clothing-v4dhz6ymx6",
    ],
}

NIKE_API_URLS = {
    "men": [
        "https://api.nike.com/cic/browse/v2?queryid=products&anonymousId=&country=VN&endpoint=%2Fproduct_feed%2Frollup_threads%2Fv2%3Ffilter%3Dgender(men)%26filter%3DinStock(true)%26count%3D48",
    ],
    "women": [
        "https://api.nike.com/cic/browse/v2?queryid=products&anonymousId=&country=VN&endpoint=%2Fproduct_feed%2Frollup_threads%2Fv2%3Ffilter%3Dgender(women)%26filter%3DinStock(true)%26count%3D48",
    ],
    "kids": [
        "https://api.nike.com/cic/browse/v2?queryid=products&anonymousId=&country=VN&endpoint=%2Fproduct_feed%2Frollup_threads%2Fv2%3Ffilter%3Dgender(boys%2Cgirls)%26filter%3DinStock(true)%26count%3D48",
    ],
}

# ─── User Agents pool ──────────────────────────────────────────────────────────
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
]

# ─── Mau sac terminal ──────────────────────────────────────────────────────────
class C:
    GREEN   = "\033[92m"
    YELLOW  = "\033[93m"
    RED     = "\033[91m"
    CYAN    = "\033[96m"
    MAGENTA = "\033[95m"
    GRAY    = "\033[90m"
    RESET   = "\033[0m"
    BOLD    = "\033[1m"

def ok(msg):   print(f"{C.GREEN}[OK]  {msg}{C.RESET}")
def skip(msg): print(f"{C.GRAY}[--]  {msg}{C.RESET}")
def fail(msg): print(f"{C.RED}[ERR] {msg}{C.RESET}")
def warn(msg): print(f"{C.YELLOW}[!!]  {msg}{C.RESET}")
def info(msg): print(f"{C.CYAN}[>>]  {msg}{C.RESET}")

# ─── Tao thu muc dich ─────────────────────────────────────────────────────────
def ensure_dirs():
    for cat in CATEGORIES:
        (ASSETS_DIR / cat).mkdir(parents=True, exist_ok=True)
    info(f"Thu muc dich: {ASSETS_DIR}")

# =============================================================================
# [1] HASH CACHE — chong trung lap giua cac lan chay
# =============================================================================

def load_hash_cache() -> dict:
    """
    Doc file cache hash tu disk.
    Tra ve dict: { "men": {"md5a", "md5b", ...}, "women": {...}, ... }
    """
    if not HASH_CACHE_FILE.exists():
        return {cat: set() for cat in CATEGORIES}
    try:
        raw = json.loads(HASH_CACHE_FILE.read_text(encoding="utf-8"))
        # JSON luu list, chuyen lai thanh set
        return {cat: set(raw.get(cat, [])) for cat in CATEGORIES}
    except Exception as e:
        warn(f"Khong doc duoc hash cache ({e}), tao moi.")
        return {cat: set() for cat in CATEGORIES}


def save_hash_cache(cache: dict) -> None:
    """Ghi cache hash ra disk (luu dang list de JSON ho tro)."""
    try:
        raw = {cat: list(hashes) for cat, hashes in cache.items()}
        HASH_CACHE_FILE.write_text(
            json.dumps(raw, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as e:
        warn(f"Khong luu duoc hash cache: {e}")


# =============================================================================
# [1b] URL CACHE — luu URL da tai de skip ngay khong can download
# =============================================================================

def load_url_cache() -> dict:
    """
    Doc file cache URL tu disk.
    Tra ve dict: { "men": {"url1", "url2", ...}, "women": {...}, ... }
    """
    if not URL_CACHE_FILE.exists():
        return {cat: set() for cat in CATEGORIES}
    try:
        raw = json.loads(URL_CACHE_FILE.read_text(encoding="utf-8"))
        return {cat: set(raw.get(cat, [])) for cat in CATEGORIES}
    except Exception as e:
        warn(f"Khong doc duoc URL cache ({e}), tao moi.")
        return {cat: set() for cat in CATEGORIES}


def save_url_cache(cache: dict) -> None:
    """Ghi cache URL ra disk."""
    try:
        raw = {cat: list(urls) for cat, urls in cache.items()}
        URL_CACHE_FILE.write_text(
            json.dumps(raw, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as e:
        warn(f"Khong luu duoc URL cache: {e}")


def build_hash_cache_from_disk(cache: dict) -> dict:
    """
    [2] Quet lai toan bo anh da co tren disk va cap nhat vao cache.
    Dung khi cache file bi mat hoac chay lan dau.
    """
    info("Dang quet hash anh hien co tren disk...")
    for cat in CATEGORIES:
        cat_dir = ASSETS_DIR / cat
        if not cat_dir.exists():
            continue
        for img_path in cat_dir.glob("*.jpg"):
            try:
                data = img_path.read_bytes()
                h = hashlib.md5(data).hexdigest()
                cache[cat].add(h)
            except Exception:
                pass
    summary = {c: len(v) for c, v in cache.items()}
    info(f"  Da lap chi muc: {summary}")
    return cache

# ─── Phat hien danh muc tu ten san pham ───────────────────────────────────────
def detect_category(title: str) -> str:
    t = title.lower()
    if re.search(r'\b(kid|junior|child|baby|boys|girls|youth|little|big kids?)\b', t):
        return "kids"
    if re.search(r'\b(women|woman|female|ladies|womens)\b', t):
        return "women"
    if re.search(r'\b(men|male|mens)\b', t):
        return "men"
    return "misc"

# ─── Ten file an toan ─────────────────────────────────────────────────────────
def safe_filename(title: str, idx: int, ext: str = ".jpg") -> str:
    slug = re.sub(r'[^\w\s-]', '', title.lower())
    slug = re.sub(r'[\s_]+', '-', slug).strip('-')
    slug = slug[:60]
    return f"{slug}-{idx:03d}{ext}"

# ─── Hash anh de kiem tra trung lap ──────────────────────────────────────────
def image_hash(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()

# ─── Tai mot anh voi retry ────────────────────────────────────────────────────
def download_image(url: str, session: requests.Session, retries: int = 3):
    for attempt in range(retries):
        try:
            resp = session.get(url, timeout=15, stream=True)
            if resp.status_code == 200:
                content_type = resp.headers.get("Content-Type", "")
                if "image" in content_type or url.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                    return resp.content
            warn(f"HTTP {resp.status_code} cho {url[:80]}")
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
            else:
                fail(f"Khong tai duoc anh: {e}")
    return None

# ─── Kiem tra & luu anh ──────────────────────────────────────────────────────
def save_image(data: bytes, dest_path: Path, min_size_kb: int = 5) -> bool:
    if len(data) < min_size_kb * 1024:
        return False
    try:
        img = Image.open(BytesIO(data))
        w, h = img.size
        if w < 100 or h < 100:
            return False
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        dest_path = dest_path.with_suffix(".jpg")
        img.save(dest_path, "JPEG", quality=92, optimize=True)
        return True
    except Exception as e:
        fail(f"Loi xu ly anh {dest_path.name}: {e}")
        return False

# ─── Tao session HTTP ─────────────────────────────────────────────────────────
def make_session() -> requests.Session:
    session = requests.Session()
    ua = random.choice(USER_AGENTS)
    session.headers.update({
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Cache-Control": "no-cache",
        "Referer": "https://www.nike.com/vn/",
        "Origin": "https://www.nike.com",
    })
    return session

# ─── Lay anh tu Nike API ─────────────────────────────────────────────────────
def fetch_from_nike_api(category: str, session: requests.Session, limit: int = 48) -> list:
    products = []
    api_endpoints = NIKE_API_URLS.get(category, [])
    for api_url in api_endpoints:
        try:
            info(f"[API] Thu Nike API cho '{category}'...")
            session.headers["Accept"] = "application/json"
            resp = session.get(api_url, timeout=15)
            if resp.status_code != 200:
                warn(f"Nike API tra ve {resp.status_code}")
                continue
            data = resp.json()
            items = (
                data.get("data", {}).get("products", {}).get("products", [])
                or data.get("hits", [])
                or data.get("products", [])
                or []
            )
            for item in items[:limit]:
                title = item.get("title") or item.get("label") or "Nike Product"
                images = item.get("images") or {}
                img_url = (
                    images.get("portraitURL")
                    or images.get("squarishURL")
                    or (item.get("colorways") or [{}])[0].get("images", {}).get("squarishURL", "")
                )
                if img_url:
                    img_url = re.sub(r'_\d+x\d+\.', '_500x500.', img_url)
                    products.append({"title": title, "image": img_url, "source": "api"})
        except Exception as e:
            warn(f"Nike API loi: {e}")
    return products

# ─── Lay anh tu scraping HTML ─────────────────────────────────────────────────
def fetch_from_html_scrape(url: str, session: requests.Session) -> list:
    products = []
    try:
        info(f"[HTML] Scraping: {url[:70]}...")
        session.headers["Accept"] = "text/html,application/xhtml+xml,*/*;q=0.8"
        resp = session.get(url, timeout=20)
        if resp.status_code != 200:
            warn(f"HTTP {resp.status_code} tu {url[:70]}")
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        next_data_tag = soup.find("script", {"id": "__NEXT_DATA__"})
        if next_data_tag:
            try:
                next_data = json.loads(next_data_tag.string)
                def find_products(obj, depth=0):
                    found = []
                    if depth > 10:
                        return found
                    if isinstance(obj, list):
                        for item in obj:
                            found.extend(find_products(item, depth + 1))
                    elif isinstance(obj, dict):
                        if "imageUrl" in obj or "squarishURL" in obj or "portraitURL" in obj:
                            title = obj.get("title") or obj.get("label") or "Nike Product"
                            img = (obj.get("imageUrl") or obj.get("squarishURL")
                                   or obj.get("portraitURL") or "")
                            if img and img.startswith("http"):
                                found.append({"title": title, "image": img, "source": "next_data"})
                        for v in obj.values():
                            found.extend(find_products(v, depth + 1))
                    return found
                products.extend(find_products(next_data))
                info(f"  Tim thay {len(products)} san pham trong __NEXT_DATA__")
            except json.JSONDecodeError:
                pass

        if not products:
            for img_tag in soup.find_all("img"):
                src = img_tag.get("src") or img_tag.get("data-src") or ""
                alt = img_tag.get("alt") or "Nike Product"
                if src and "nike" in src and any(
                    ext in src.lower() for ext in [".jpg", ".jpeg", ".png", ".webp"]
                ):
                    if "logo" in src.lower() or "icon" in src.lower():
                        continue
                    products.append({"title": alt, "image": src, "source": "img_tag"})
            info(f"  Tim thay {len(products)} anh tu <img> tags")

    except Exception as e:
        fail(f"Loi scraping {url[:60]}: {e}")
    return products

# ─── Backup Nike CDN ──────────────────────────────────────────────────────────
BACKUP_NIKE_IMAGES = {
    "men": [
        ("Nike Air Max 90 Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/b1bcbca4-e853-4df7-b329-5be3c61ee057/AIR+MAX+90.png"),
        ("Nike Air Force 1 07 Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/b7d9211c-26e7-431a-ac24-b0540fb3c00f/AIR+FORCE+1+%2707.png"),
        ("Nike Dunk Low Retro Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/d821b1b0-5d43-420a-aa59-eb35f45af5e2/DUNK+LOW+RETRO.png"),
        ("Nike Air Zoom Pegasus 41 Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/4416e5e5-5b91-4cfe-b1f1-e1b89e9e7623/PEGASUS+41.png"),
        ("Nike Air Max Plus Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/9eb8ef9e-b0f0-4d86-ab5e-93e28a6cefcc/AIR+MAX+PLUS.png"),
        ("Nike Blazer Mid 77 Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/b54c4e3e-6f82-4e51-9a40-9f6dab68a90d/BLAZER+MID+%2777+VINTAGE.png"),
        ("Nike React Infinity Run Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/b3e6e55c-2a9c-4c78-adcd-a9f5e60c7a4a/REACT+INFINITY+RUN+FLYKNIT+3.png"),
        ("Nike Air Max 270 Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/5e9e0bc1-6266-4e71-9490-f0b0f4a826fa/AIR+MAX+270.png"),
        ("Nike ZoomX Vaporfly Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/e47eb491-d5a4-4fec-8dc0-69b6e54d0e95/ZOOMX+VAPORFLY+NEXT%25+3.png"),
        ("Nike Metcon 9 Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/5c7a2c1d-1a1e-4b23-8ea0-5b25b0c0e0c1/METCON+9.png"),
        ("Nike Air Huarache Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/6e7ceade-a2fe-43d5-829b-b05a29c4a6dc/AIR+HUARACHE.png"),
        ("Nike Court Vision Low Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/d3a9af51-1ca5-465f-ba38-6ddbb0880498/COURT+VISION+LOW+NEXT+NATURE.png"),
        ("Nike SB Dunk Low Pro Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/8a9f4a1d-5e6f-4d2e-b8c9-9f2a3b4c5d6e/SB+DUNK+LOW+PRO.png"),
        ("Nike Tech Fleece Hoodie Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/i1-4a83e46c-62c3-4cfc-a8d7-2b2a10fc5f6e/TECH+FLEECE+HOODIE.png"),
        ("Nike Dri-FIT Running Shirt Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/i1-5b94f57d-73d4-5df9-b9e8-3c3b21gd6f7f/DRI-FIT+SHIRT.png"),
        ("Nike Air Max 97 Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/b1f1f2a3-c4d5-e6f7-a8b9-c0d1e2f3a4b5/AIR+MAX+97.png"),
        ("Nike Air Jordan 1 Retro Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/c2d3e4f5-a6b7-c8d9-e0f1-a2b3c4d5e6f7/AIR+JORDAN+1+RETRO.png"),
        ("Nike Free RN 5.0 Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/d3e4f5a6-b7c8-d9e0-f1a2-b3c4d5e6f7a8/FREE+RN+5.0.png"),
        ("Nike Club Fleece Pants Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/e4f5a6b7-c8d9-e0f1-a2b3-c4d5e6f7a8b9/CLUB+FLEECE+PANTS.png"),
        ("Nike Windrunner Jacket Men", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/f5a6b7c8-d9e0-f1a2-b3c4-d5e6f7a8b9c0/WINDRUNNER+JACKET.png"),
    ],
    "women": [
        ("Nike Air Force 1 Shadow Women", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6/AIR+FORCE+1+SHADOW.png"),
        ("Nike Air Max 270 Women", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/b2c3d4e5-f6a7-b8c9-d0e1-f2a3b4c5d6e7/AIR+MAX+270.png"),
        ("Nike Dunk Low Women", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/c3d4e5f6-a7b8-c9d0-e1f2-a3b4c5d6e7f8/DUNK+LOW.png"),
        ("Nike Air Max Pulse Women", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/d4e5f6a7-b8c9-d0e1-f2a3-b4c5d6e7f8a9/AIR+MAX+PULSE.png"),
        ("Nike Pegasus Trail Women", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/e5f6a7b8-c9d0-e1f2-a3b4-c5d6e7f8a9b0/PEGASUS+TRAIL.png"),
        ("Nike Air Max 1 Women", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/f6a7b8c9-d0e1-f2a3-b4c5-d6e7f8a9b0c1/AIR+MAX+1.png"),
        ("Nike Blazer Low 77 Women", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/a7b8c9d0-e1f2-a3b4-c5d6-e7f8a9b0c1d2/BLAZER+LOW+77.png"),
        ("Nike Infinity Run Women", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/b8c9d0e1-f2a3-b4c5-d6e7-f8a9b0c1d2e3/INFINITY+RUN.png"),
        ("Nike One Leggings Women", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/c9d0e1f2-a3b4-c5d6-e7f8-a9b0c1d2e3f4/ONE+LEGGINGS.png"),
        ("Nike Tech Fleece Hoodie Women", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/d0e1f2a3-b4c5-d6e7-f8a9-b0c1d2e3f4a5/TECH+FLEECE+HOODIE.png"),
        ("Nike Sportswear Club Fleece Women", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/e1f2a3b4-c5d6-e7f8-a9b0-c1d2e3f4a5b6/CLUB+FLEECE.png"),
        ("Nike Zoom Fly Women", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/f2a3b4c5-d6e7-f8a9-b0c1-d2e3f4a5b6c7/ZOOM+FLY.png"),
        ("Nike Court Vision Low Women", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/a3b4c5d6-e7f8-a9b0-c1d2-e3f4a5b6c7d8/COURT+VISION+LOW.png"),
        ("Nike Free Metcon Women", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/b4c5d6e7-f8a9-b0c1-d2e3-f4a5b6c7d8e9/FREE+METCON.png"),
        ("Nike Indy Bra Women", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/c5d6e7f8-a9b0-c1d2-e3f4-a5b6c7d8e9f0/INDY+BRA.png"),
    ],
    "kids": [
        ("Nike Air Force 1 LE Kids", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/a6b7c8d9-e0f1-a2b3-c4d5-e6f7a8b9c0d1/AIR+FORCE+1+LE+KIDS.png"),
        ("Nike Dunk Low Kids", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/b7c8d9e0-f1a2-b3c4-d5e6-f7a8b9c0d1e2/DUNK+LOW+KIDS.png"),
        ("Nike Air Max 270 GO Kids", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/c8d9e0f1-a2b3-c4d5-e6f7-a8b9c0d1e2f3/AIR+MAX+270+GO.png"),
        ("Nike Revolution 6 Kids", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/d9e0f1a2-b3c4-d5e6-f7a8-b9c0d1e2f3a4/REVOLUTION+6+KIDS.png"),
        ("Nike Star Runner Kids", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/e0f1a2b3-c4d5-e6f7-a8b9-c0d1e2f3a4b5/STAR+RUNNER+KIDS.png"),
        ("Nike Flex Runner Kids", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/f1a2b3c4-d5e6-f7a8-b9c0-d1e2f3a4b5c6/FLEX+RUNNER+KIDS.png"),
        ("Nike Court Borough Low Kids", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/a2b3c4d5-e6f7-a8b9-c0d1-e2f3a4b5c6d7/COURT+BOROUGH+LOW+KIDS.png"),
        ("Nike Dynamo Free Kids", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/b3c4d5e6-f7a8-b9c0-d1e2-f3a4b5c6d7e8/DYNAMO+FREE+KIDS.png"),
        ("Nike Club Fleece Hoodie Kids", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/c4d5e6f7-a8b9-c0d1-e2f3-a4b5c6d7e8f9/CLUB+FLEECE+HOODIE+KIDS.png"),
        ("Nike Dri-FIT Shirt Kids", "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/d5e6f7a8-b9c0-d1e2-f3a4-b5c6d7e8f9a0/DRI-FIT+SHIRT+KIDS.png"),
    ],
}

# ─── Fallback Unsplash ─────────────────────────────────────────────────────────
UNSPLASH_IMAGES = {
    "men": [
        ("Nike Air Max 90 Men", "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=85&fit=crop"),
        ("Nike Air Force 1 Men", "https://images.unsplash.com/photo-1600185365926-3a2ce3cdb9eb?w=800&q=85&fit=crop"),
        ("Nike Dunk Low Men", "https://images.unsplash.com/photo-1608231387042-66d1773d3028?w=800&q=85&fit=crop"),
        ("Nike Pegasus 40 Men", "https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=800&q=85&fit=crop"),
        ("Nike Air Max Plus Men", "https://images.unsplash.com/photo-1556906781-9a412961d28e?w=800&q=85&fit=crop"),
        ("Nike Blazer Mid 77 Men", "https://images.unsplash.com/photo-1539185441755-769473a23570?w=800&q=85&fit=crop"),
        ("Nike Vaporfly Men", "https://images.unsplash.com/photo-1587563871167-1ee9c731aefb?w=800&q=85&fit=crop"),
        ("Nike React Men", "https://images.unsplash.com/photo-1605408499391-6368c628ef42?w=800&q=85&fit=crop"),
        ("Nike Metcon Men", "https://images.unsplash.com/photo-1612966232116-ab8b5a45a2e6?w=800&q=85&fit=crop"),
        ("Nike Air Max 97 Men", "https://images.unsplash.com/photo-1575537302964-96cd47c06b1b?w=800&q=85&fit=crop"),
        ("Nike Air Jordan Men", "https://images.unsplash.com/photo-1514989771522-458c9b6c035a?w=800&q=85&fit=crop"),
        ("Nike Vomero Men", "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=800&q=85&fit=crop"),
        ("Nike Lebron Men", "https://images.unsplash.com/photo-1579338559194-a162d19bf842?w=800&q=85&fit=crop"),
        ("Nike Kyrie Men", "https://images.unsplash.com/photo-1552346154-21d32810aba3?w=800&q=85&fit=crop"),
        ("Nike Tech Fleece Men", "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=85&fit=crop"),
        ("Nike Running Shirt Men", "https://images.unsplash.com/photo-1503944583220-79d8926ad5e2?w=800&q=85&fit=crop"),
        ("Nike Club Hoodie Men", "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=800&q=85&fit=crop"),
        ("Nike Jogger Pants Men", "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=800&q=85&fit=crop"),
        ("Nike Training Shorts Men", "https://images.unsplash.com/photo-1552902865-b72c031ac5ea?w=800&q=85&fit=crop"),
        ("Nike Windrunner Men", "https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=800&q=85&fit=crop"),
        # -- Them anh --
        ("Nike Sneaker Sport Men", "https://images.unsplash.com/photo-1465453869711-7e174808ace9?w=800&q=85&fit=crop"),
        ("Nike Running Shoe Men", "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=800&q=85&fit=crop"),
        ("Nike Shoe White Men", "https://images.unsplash.com/photo-1463100099107-aa0980ccd584?w=800&q=85&fit=crop"),
        ("Nike Sneaker Black Men", "https://images.unsplash.com/photo-1520256862855-398228c41684?w=800&q=85&fit=crop"),
        ("Nike Basketball Shoe Men", "https://images.unsplash.com/photo-1515955656352-a1fa3ffcd111?w=800&q=85&fit=crop"),
        ("Nike Shoe Colorful Men", "https://images.unsplash.com/photo-1542219550-37153d387c27?w=800&q=85&fit=crop"),
        ("Nike Low Top Men", "https://images.unsplash.com/photo-1551107696-a4b0c5a0d9a2?w=800&q=85&fit=crop"),
        ("Nike Running Trail Men", "https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=800&q=85&fit=crop"),
        ("Nike Athlete Men", "https://images.unsplash.com/photo-1483721310020-03333e577078?w=800&q=85&fit=crop"),
        ("Nike Outfit Men", "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&q=85&fit=crop"),
        ("Nike Sport Jacket Men", "https://images.unsplash.com/photo-1547949003-9792a18a2601?w=800&q=85&fit=crop"),
        ("Nike Gym Wear Men", "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=85&fit=crop"),
        ("Nike Tracksuit Men", "https://images.unsplash.com/photo-1530822847156-5df684ec5105?w=800&q=85&fit=crop"),
        ("Nike Sneaker Side Men", "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=800&q=85&fit=crop"),
        ("Nike Shoe Sole Men", "https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=800&q=85&fit=crop"),
        ("Nike Sport Casual Men", "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=800&q=85&fit=crop"),
        ("Nike Training Men", "https://images.unsplash.com/photo-1571731956672-f2b94d7dd0cb?w=800&q=85&fit=crop"),
        ("Nike Sneaker Red Men", "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=85&fit=crop&crop=top"),
        ("Nike Shoe Flat Men", "https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=800&q=85&fit=crop&crop=bottom"),
        ("Nike Classic Shoe Men", "https://images.unsplash.com/photo-1600185365926-3a2ce3cdb9eb?w=800&q=85&fit=crop&crop=left"),
        ("Nike Minimal Men", "https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=800&q=85&fit=crop"),
        ("Nike Air Max Blue Men", "https://images.unsplash.com/photo-1593079831268-3381b0db4a77?w=800&q=85&fit=crop"),
        ("Nike Sport Shirt Men", "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800&q=85&fit=crop"),
        ("Nike Fitness Men", "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800&q=85&fit=crop"),
        ("Nike Cross Training Men", "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=85&fit=crop"),
        ("Nike Road Running Men", "https://images.unsplash.com/photo-1444381756600-43b600e64ce6?w=800&q=85&fit=crop"),
        ("Nike Sneaker Lifestyle Men", "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=800&q=85&fit=crop"),
        ("Nike Shoe Lace Men", "https://images.unsplash.com/photo-1494496195158-c3bc5b9f3edd?w=800&q=85&fit=crop"),
        ("Nike Sport Performance Men", "https://images.unsplash.com/photo-1556906781-9a412961d28e?w=800&q=85&fit=crop&crop=right"),
        ("Nike Retro Style Men", "https://images.unsplash.com/photo-1539185441755-769473a23570?w=800&q=85&fit=crop&crop=top"),
        ("Nike Dri-FIT Top Men", "https://images.unsplash.com/photo-1560243563-062bfc001d68?w=800&q=85&fit=crop"),
    ],
    "women": [
        ("Nike Air Max Women", "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800&q=85&fit=crop"),
        ("Nike Dunk Women", "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800&q=85&fit=crop"),
        ("Nike Blazer Women", "https://images.unsplash.com/photo-1607522370275-f14206abe5d3?w=800&q=85&fit=crop"),
        ("Nike Infinity Run Women", "https://images.unsplash.com/photo-1595341888016-a392ef81b7de?w=800&q=85&fit=crop"),
        ("Nike Zoom Fly Women", "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=800&q=85&fit=crop"),
        ("Nike One Leggings Women", "https://images.unsplash.com/photo-1518611012118-696072aa579a?w=800&q=85&fit=crop"),
        ("Nike Sports Bra Women", "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=85&fit=crop"),
        ("Nike Club Fleece Women", "https://images.unsplash.com/photo-1554568218-0f1715e72254?w=800&q=85&fit=crop"),
        ("Nike Air Force 1 Shadow Women", "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=85&fit=crop"),
        ("Nike Pegasus Trail Women", "https://images.unsplash.com/photo-1556906781-9a412961d28e?w=800&q=85&fit=crop"),
        ("Nike Jacket Women", "https://images.unsplash.com/photo-1534258936925-c58bed479fcb?w=800&q=85&fit=crop"),
        ("Nike Running Shorts Women", "https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=800&q=85&fit=crop"),
        ("Nike Court Vision Women", "https://images.unsplash.com/photo-1600185365926-3a2ce3cdb9eb?w=800&q=85&fit=crop"),
        ("Nike Motiva Women", "https://images.unsplash.com/photo-1608231387042-66d1773d3028?w=800&q=85&fit=crop"),
        ("Nike Yoga Mat Women", "https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=800&q=85&fit=crop"),
        # -- Them anh --
        ("Nike Running Shoe Women", "https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=800&q=85&fit=crop"),
        ("Nike Sneaker Fashion Women", "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=800&q=85&fit=crop"),
        ("Nike Workout Women", "https://images.unsplash.com/photo-1518310383802-640c2de311b2?w=800&q=85&fit=crop"),
        ("Nike Gym Women", "https://images.unsplash.com/photo-1499084732479-de2c02d45fcc?w=800&q=85&fit=crop"),
        ("Nike Training Women", "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=800&q=85&fit=crop"),
        ("Nike Yoga Women", "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=800&q=85&fit=crop"),
        ("Nike Hoodie Women", "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=85&fit=crop"),
        ("Nike Tights Women", "https://images.unsplash.com/photo-1576633587382-13ddf37b1fc1?w=800&q=85&fit=crop"),
        ("Nike Pink Shoe Women", "https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=800&q=85&fit=crop&crop=top"),
        ("Nike White Sneaker Women", "https://images.unsplash.com/photo-1514989771522-458c9b6c035a?w=800&q=85&fit=crop"),
        ("Nike Casual Style Women", "https://images.unsplash.com/photo-1475180098004-ca77a66827be?w=800&q=85&fit=crop"),
        ("Nike Sport Fashion Women", "https://images.unsplash.com/photo-1520256862855-398228c41684?w=800&q=85&fit=crop"),
        ("Nike Athleisure Women", "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=800&q=85&fit=crop"),
        ("Nike Active Wear Women", "https://images.unsplash.com/photo-1515488764276-beab7607c1e6?w=800&q=85&fit=crop"),
        ("Nike Slim Fit Women", "https://images.unsplash.com/photo-1483721310020-03333e577078?w=800&q=85&fit=crop"),
        ("Nike Performance Tee Women", "https://images.unsplash.com/photo-1503944583220-79d8926ad5e2?w=800&q=85&fit=crop"),
        ("Nike Air Shoe Women", "https://images.unsplash.com/photo-1593079831268-3381b0db4a77?w=800&q=85&fit=crop"),
        ("Nike Half Zip Women", "https://images.unsplash.com/photo-1547949003-9792a18a2601?w=800&q=85&fit=crop"),
        ("Nike Crop Top Women", "https://images.unsplash.com/photo-1552902865-b72c031ac5ea?w=800&q=85&fit=crop"),
        ("Nike Runner Women", "https://images.unsplash.com/photo-1612966232116-ab8b5a45a2e6?w=800&q=85&fit=crop"),
        ("Nike Sneaker Colorful Women", "https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=800&q=85&fit=crop"),
        ("Nike Sport Dress Women", "https://images.unsplash.com/photo-1554568218-0f1715e72254?w=800&q=85&fit=crop&crop=top"),
        ("Nike Minimal Women", "https://images.unsplash.com/photo-1515955656352-a1fa3ffcd111?w=800&q=85&fit=crop"),
        ("Nike Dri-FIT Women", "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=800&q=85&fit=crop"),
        ("Nike Air Jordan Women", "https://images.unsplash.com/photo-1579338559194-a162d19bf842?w=800&q=85&fit=crop"),
        ("Nike Windbreaker Women", "https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=800&q=85&fit=crop"),
        ("Nike Tank Top Women", "https://images.unsplash.com/photo-1571731956672-f2b94d7dd0cb?w=800&q=85&fit=crop"),
        ("Nike Sneaker Pastel Women", "https://images.unsplash.com/photo-1560243563-062bfc001d68?w=800&q=85&fit=crop"),
        ("Nike Lifestyle Women", "https://images.unsplash.com/photo-1465453869711-7e174808ace9?w=800&q=85&fit=crop"),
        ("Nike Shorts Active Women", "https://images.unsplash.com/photo-1530822847156-5df684ec5105?w=800&q=85&fit=crop"),
        ("Nike Race Day Women", "https://images.unsplash.com/photo-1444381756600-43b600e64ce6?w=800&q=85&fit=crop"),
        ("Nike Bold Print Women", "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=800&q=85&fit=crop"),
        ("Nike Epic React Women", "https://images.unsplash.com/photo-1494496195158-c3bc5b9f3edd?w=800&q=85&fit=crop"),
        ("Nike Walk Women", "https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=800&q=85&fit=crop"),
        ("Nike Air Zoom Women", "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=85&fit=crop"),
    ],
    "kids": [
        ("Nike Air Force 1 Kids", "https://images.unsplash.com/photo-1575537302964-96cd47c06b1b?w=800&q=85&fit=crop"),
        ("Nike Dunk Low Kids", "https://images.unsplash.com/photo-1514989771522-458c9b6c035a?w=800&q=85&fit=crop"),
        ("Nike Air Max 270 Kids", "https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=800&q=85&fit=crop"),
        ("Nike Revolution Kids", "https://images.unsplash.com/photo-1539185441755-769473a23570?w=800&q=85&fit=crop"),
        ("Nike Star Runner Kids", "https://images.unsplash.com/photo-1605408499391-6368c628ef42?w=800&q=85&fit=crop"),
        ("Nike Flex Runner Kids", "https://images.unsplash.com/photo-1612966232116-ab8b5a45a2e6?w=800&q=85&fit=crop"),
        ("Nike Club Fleece Kids", "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=800&q=85&fit=crop"),
        ("Nike Dri-FIT Kids", "https://images.unsplash.com/photo-1503944583220-79d8926ad5e2?w=800&q=85&fit=crop"),
        ("Nike Court Borough Kids", "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=800&q=85&fit=crop"),
        ("Nike Downshifter Kids", "https://images.unsplash.com/photo-1579338559194-a162d19bf842?w=800&q=85&fit=crop"),
        # -- Them anh --
        ("Kids Sneaker Sport", "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=85&fit=crop&crop=bottom"),
        ("Kids Running Shoe", "https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=800&q=85&fit=crop"),
        ("Kids Athletic Wear", "https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=800&q=85&fit=crop"),
        ("Kids Colorful Shoe", "https://images.unsplash.com/photo-1515955656352-a1fa3ffcd111?w=800&q=85&fit=crop"),
        ("Kids Hoodie Sport", "https://images.unsplash.com/photo-1547949003-9792a18a2601?w=800&q=85&fit=crop"),
        ("Kids Training Shoe", "https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=800&q=85&fit=crop"),
        ("Kids Casual Sneaker", "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=800&q=85&fit=crop"),
        ("Kids Play Shoe", "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=800&q=85&fit=crop"),
        ("Kids White Shoe", "https://images.unsplash.com/photo-1463100099107-aa0980ccd584?w=800&q=85&fit=crop"),
        ("Kids Sports Jersey", "https://images.unsplash.com/photo-1552346154-21d32810aba3?w=800&q=85&fit=crop"),
        ("Kids Outdoor Shoe", "https://images.unsplash.com/photo-1593079831268-3381b0db4a77?w=800&q=85&fit=crop"),
        ("Kids Athletic Top", "https://images.unsplash.com/photo-1530822847156-5df684ec5105?w=800&q=85&fit=crop"),
        ("Kids School Shoe", "https://images.unsplash.com/photo-1556906781-9a412961d28e?w=800&q=85&fit=crop&crop=bottom"),
        ("Kids Low Cut Shoe", "https://images.unsplash.com/photo-1551107696-a4b0c5a0d9a2?w=800&q=85&fit=crop"),
        ("Kids Tracksuit", "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=800&q=85&fit=crop"),
        ("Kids Hi Top Shoe", "https://images.unsplash.com/photo-1520256862855-398228c41684?w=800&q=85&fit=crop"),
        ("Kids Active Shorts", "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800&q=85&fit=crop"),
        ("Kids Velcro Shoe", "https://images.unsplash.com/photo-1600185365926-3a2ce3cdb9eb?w=800&q=85&fit=crop&crop=bottom"),
        ("Kids Jogger Pants", "https://images.unsplash.com/photo-1541840031508-326e7c3d6903?w=800&q=85&fit=crop"),
        ("Kids Tennis Shoe", "https://images.unsplash.com/photo-1542219550-37153d387c27?w=800&q=85&fit=crop"),
        ("Kids Summer Sneaker", "https://images.unsplash.com/photo-1465453869711-7e174808ace9?w=800&q=85&fit=crop"),
        ("Kids Basketball Shoe", "https://images.unsplash.com/photo-1494496195158-c3bc5b9f3edd?w=800&q=85&fit=crop"),
        ("Kids Breathable Shoe", "https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=800&q=85&fit=crop"),
        ("Kids Neon Shoe", "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=85&fit=crop"),
        ("Kids Mesh Shoe", "https://images.unsplash.com/photo-1575537302964-96cd47c06b1b?w=800&q=85&fit=crop&crop=right"),
        ("Kids Slide Sandal", "https://images.unsplash.com/photo-1444381756600-43b600e64ce6?w=800&q=85&fit=crop"),
        ("Kids Knit Shoe", "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=800&q=85&fit=crop"),
        ("Kids Sweatshirt", "https://images.unsplash.com/photo-1560243563-062bfc001d68?w=800&q=85&fit=crop"),
        ("Kids Sport T-Shirt", "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800&q=85&fit=crop"),
        ("Kids Lightweight Shoe", "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=85&fit=crop"),
    ],
}

# =============================================================================
# [2] Ham chinh: tai anh cho mot danh muc — nhan global_hash_cache
# =============================================================================
def download_category(
    category: str,
    session: requests.Session,
    global_hash_cache: dict,          # <── [2] nhan hash cache tu ben ngoai
    global_url_cache: dict,           # <── [1b] nhan URL cache tu ben ngoai
    limit: int = 20,
    custom_url=None,
    use_backup: bool = True,
) -> dict:
    dest_dir = ASSETS_DIR / category
    dest_dir.mkdir(parents=True, exist_ok=True)

    stats = {"downloaded": 0, "skipped": 0, "failed": 0}

    # [2] Load hash da tai tu cache (ben vung giua cac lan chay)
    seen_hashes: set = global_hash_cache.get(category, set())

    # [1b] Load URL cache
    seen_urls_cache: set = global_url_cache.get(category, set())

    # Dem so file hien co de danh so tiep dung
    existing_files = list(dest_dir.glob("*.jpg"))
    existing_count = len(existing_files)

    # Tinh chi so tiep theo dua tren so lon nhat trong ten file (tranh danh so trung)
    max_idx = 0
    import re as _re
    for f in existing_files:
        m = _re.search(r'-(\d+)\.jpg$', f.name)
        if m:
            max_idx = max(max_idx, int(m.group(1)))
    counter = max_idx  # safe_filename dung counter lam idx, se tang len +1 truoc khi luu

    print(f"\n{C.BOLD}{C.CYAN}{'─'*50}{C.RESET}")
    print(f"{C.BOLD}{C.CYAN}  Danh muc: {category.upper()}{C.RESET}")
    print(f"{C.CYAN}  Dich: {dest_dir}{C.RESET}")
    print(f"{C.CYAN}  Da co: {existing_count} anh | Hash cache: {len(seen_hashes)} entries{C.RESET}")
    print(f"{C.CYAN}{'─'*50}{C.RESET}")

    # Neu da du anh thi skip
    if existing_count >= limit:
        skip(f"Danh muc '{category}' da du {existing_count}/{limit} anh, bo qua.")
        stats["skipped"] = existing_count
        return stats

    remaining = limit - existing_count
    info(f"  Can tai them: {remaining} anh (da co {existing_count})")

    # ── Thu thap danh sach URL can tai ────────────────────────────────────────
    product_list: list = []

    urls_to_scrape = [custom_url] if custom_url else NIKE_PAGES.get(category, [])
    for url in urls_to_scrape[:1]:
        items = fetch_from_html_scrape(url, session)
        for item in items:
            product_list.append((item["title"], item["image"]))
        if product_list:
            info(f"  Lay duoc {len(product_list)} san pham tu HTML scraping")
        time.sleep(random.uniform(1.5, 3.0))

    if not product_list:
        items = fetch_from_nike_api(category, session, limit=limit)
        for item in items:
            product_list.append((item["title"], item["image"]))
        if product_list:
            info(f"  Lay duoc {len(product_list)} san pham tu Nike API")

    if not product_list or use_backup:
        backup = BACKUP_NIKE_IMAGES.get(category, [])
        if backup:
            warn(f"  Dung {len(backup)} anh tu Nike CDN backup")
            product_list.extend(backup)

    if not product_list:
        fallback = UNSPLASH_IMAGES.get(category, [])
        warn(f"  Dung {len(fallback)} anh Unsplash lam fallback")
        product_list.extend(fallback)

    # Luon bo sung Unsplash de dam bao du anh
    product_list.extend(UNSPLASH_IMAGES.get(category, []))

    # Loai bo trung URL
    seen_urls: set = set()
    unique_list = []
    for title, url in product_list:
        if url not in seen_urls:
            seen_urls.add(url)
            unique_list.append((title, url))
    product_list = unique_list[:remaining * 3]

    info(f"  Tong URL de thu: {len(product_list)} (can tai: {remaining})")

    # ── Tai anh ───────────────────────────────────────────────────────────────
    pbar = tqdm(product_list, desc=f"  {category}", unit="img", colour="cyan", ncols=80)
    for title, img_url in pbar:
        if stats["downloaded"] >= remaining:
            break

        pbar.set_postfix_str(title[:30])

        if not img_url or not img_url.startswith("http"):
            stats["failed"] += 1
            continue

        # [1b] Skip ngay neu URL nay da duoc tai thanh cong truoc do
        if img_url in seen_urls_cache:
            stats["skipped"] += 1
            skip(f"Da co (URL cache): {img_url[:60]}")
            continue

        data = download_image(img_url, session)
        if not data:
            stats["failed"] += 1
            continue

        # [2] Kiem tra trung lap bang hash (ke ca anh tu lan chay truoc)
        h = image_hash(data)
        if h in seen_hashes:
            stats["skipped"] += 1
            seen_urls_cache.add(img_url)          # ghi nho URL du anh bi skip
            global_url_cache[category] = seen_urls_cache
            skip(f"Da co (hash trung): {img_url[:60]}")
            continue

        counter += 1
        filename = safe_filename(title, counter)
        dest_path = dest_dir / filename

        if save_image(data, dest_path):
            # [1] Cap nhat hash cache ngay sau khi luu thanh cong
            seen_hashes.add(h)
            global_hash_cache[category] = seen_hashes
            # [1b] Luu URL thanh cong vao URL cache
            seen_urls_cache.add(img_url)
            global_url_cache[category] = seen_urls_cache
            stats["downloaded"] += 1
            ok(f"Luu: {category}/{dest_path.name}")
        else:
            counter -= 1  # hoan lai neu luu that bai
            stats["failed"] += 1
            fail(f"Anh qua nho hoac loi: {img_url[:60]}")

        time.sleep(random.uniform(0.3, 0.8))

    return stats

# ─── CLI ──────────────────────────────────────────────────────────────────────
def parse_args():
    parser = argparse.ArgumentParser(
        description="Nike Image Downloader — Tai & phan loai anh Nike vao public/assets/products/",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Vi du:
  python scripts/nike_image_downloader.py
  python scripts/nike_image_downloader.py --category men --limit 20
  python scripts/nike_image_downloader.py --rebuild-cache
        """
    )
    parser.add_argument("--category", choices=CATEGORIES,
                        help="Tai anh cho mot danh muc cu the")
    parser.add_argument("--url", help="URL trang Nike tuy chinh de scrape")
    parser.add_argument("--limit", type=int, default=50,
                        help="So luong anh toi da moi danh muc (mac dinh: 50)")
    parser.add_argument("--all", action="store_true",
                        help="Tai tat ca danh muc (men, women, kids)")
    parser.add_argument("--no-backup", action="store_true",
                        help="Khong dung anh backup neu scraping that bai")
    parser.add_argument("--rebuild-cache", action="store_true",
                        help="Quet lai hash cua tat ca anh da co tren disk va luu cache")
    return parser.parse_args()

# ─── Entrypoint ───────────────────────────────────────────────────────────────
def main():
    args = parse_args()
    ensure_dirs()

    print(f"\n{C.BOLD}{C.CYAN}{'='*54}{C.RESET}")
    print(f"{C.BOLD}{C.CYAN}  Nike Image Downloader{C.RESET}")
    print(f"{C.CYAN}  Thu muc goc  : {PROJECT_ROOT}{C.RESET}")
    print(f"{C.CYAN}  Thu muc dich : {ASSETS_DIR}{C.RESET}")
    print(f"{C.CYAN}  Hash cache   : {HASH_CACHE_FILE}{C.RESET}")
    print(f"{C.CYAN}  URL cache    : {URL_CACHE_FILE}{C.RESET}")
    print(f"{C.CYAN}{'='*54}{C.RESET}\n")

    # [1] Load hash cache tu disk
    hash_cache = load_hash_cache()
    total_cached = sum(len(v) for v in hash_cache.values())
    info(f"Da load hash cache: {total_cached} entries tu {HASH_CACHE_FILE.name}")

    # [1b] Load URL cache tu disk
    url_cache = load_url_cache()
    total_url_cached = sum(len(v) for v in url_cache.values())
    info(f"Da load URL cache : {total_url_cached} URLs tu {URL_CACHE_FILE.name}")

    if args.rebuild_cache:
        # Rebuild tu disk (dung khi cache bi mat hoac muon dong bo lai)
        hash_cache = build_hash_cache_from_disk(hash_cache)
        save_hash_cache(hash_cache)
        ok(f"Cache da rebuild va luu tai: {HASH_CACHE_FILE}")
        return

    # Neu cache file chua ton tai → tu dong rebuild tu anh da co tren disk
    if not HASH_CACHE_FILE.exists() and total_cached == 0:
        warn("Chua co hash cache, dang quet anh hien co tren disk...")
        hash_cache = build_hash_cache_from_disk(hash_cache)
        save_hash_cache(hash_cache)

    session = make_session()
    use_backup = not args.no_backup
    total_stats = {"downloaded": 0, "skipped": 0, "failed": 0}

    if args.url and args.category:
        categories_to_run = [args.category]
    elif args.category:
        categories_to_run = [args.category]
    elif args.all:
        categories_to_run = ["men", "women", "kids"]
    else:
        categories_to_run = ["men", "women", "kids"]

    for cat in categories_to_run:
        custom_url = args.url if args.category == cat else None
        stats = download_category(
            category=cat,
            session=session,
            global_hash_cache=hash_cache,    # [2] truyen hash cache vao
            global_url_cache=url_cache,      # [1b] truyen URL cache vao
            limit=args.limit,
            custom_url=custom_url,
            use_backup=use_backup,
        )
        for k in total_stats:
            total_stats[k] += stats[k]

        # [1] Luu cache sau moi danh muc (an toan neu bi ngat giua chung)
        save_hash_cache(hash_cache)
        save_url_cache(url_cache)
        total_now = sum(len(v) for v in hash_cache.values())
        total_url_now = sum(len(v) for v in url_cache.values())
        info(f"Hash cache: {total_now} entries | URL cache: {total_url_now} URLs da luu")

        if cat != categories_to_run[-1]:
            delay = random.uniform(2.0, 4.0)
            info(f"Tam dung {delay:.1f}s truoc danh muc tiep theo...")
            time.sleep(delay)

    # ── Ket qua ───────────────────────────────────────────────────────────────
    print(f"\n{C.BOLD}{C.CYAN}{'='*54}{C.RESET}")
    print(f"{C.BOLD}{C.CYAN}  KET QUA TONG HOP{C.RESET}")
    print(f"{C.CYAN}{'='*54}{C.RESET}")
    print(f"{C.GREEN}  [OK]  Da tai  : {total_stats['downloaded']} anh{C.RESET}")
    print(f"{C.GRAY}  [--]  Bo qua  : {total_stats['skipped']} anh{C.RESET}")
    print(f"{C.RED}  [ERR] That bai : {total_stats['failed']} anh{C.RESET}")

    print(f"\n{C.CYAN}  File da luu:{C.RESET}")
    for cat in categories_to_run:
        dir_path = ASSETS_DIR / cat
        files = list(dir_path.glob("*.jpg"))
        print(f"{C.GRAY}     {cat}/: {len(files)} anh{C.RESET}")
        for f in files[-3:]:
            size_kb = f.stat().st_size // 1024
            print(f"{C.GRAY}       -> {f.name} ({size_kb}KB){C.RESET}")

    print(f"{C.CYAN}{'='*54}{C.RESET}\n")

if __name__ == "__main__":
    main()
