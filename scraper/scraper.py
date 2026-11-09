# -*- coding: utf-8 -*-
"""HK grocery price scraper — HKTVmall public search API.

How it works
------------
HKTVmall's own website search runs on Algolia. The search page publishes a
*search-only* API key and the index name in its public HTML, so this scraper
uses the exact same endpoint the site's frontend uses — no login, no secret,
no paid API. The key is re-fetched from the live search page on every run
(it rotates); a last-known key is kept only as a fallback.

The valuable part: HKTVmall records the same product's price at its two big
rivals and publishes it in every product record as ``kaPriceList``:
``PP`` = PARKnSHOP, ``WE`` = Wellcome, each with a ``recordDate``. So one
public API gives a genuine 3-store comparison — no need to scrape the
PARKnSHOP site (it returns 403 to bots) or the Wellcome site (JS-rendered).

Output
------
- ``data/prices.json`` — current snapshot (what the frontend reads)
- ``data/fallback.js`` — same snapshot embedded as ``window.HK_PRICE_FALLBACK``
  so the page also works opened directly from disk (file://, no server)
- ``history/prices-YYYY-MM-DD.json`` — dated snapshot for price history

Usage
-----
    pip install -r requirements.txt   # requests only
    python3 scraper.py                # writes ../data + ../history
    python3 scraper.py --live-test    # one query only, prints raw hit
"""

import json
import os
import re
import sys
import time
from datetime import date

try:
    import requests
except ImportError:  # pragma: no cover
    sys.stderr.write("requests is required: pip install -r requirements.txt\n")
    raise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from products import PRODUCTS, CATEGORIES  # noqa: E402

SEARCH_PAGE = "https://www.hktvmall.com/hktv/en/search_a?keyword=rice"
ALGOLIA_HOST = "https://{app}-dsn.algolia.net/1/indexes/*/queries"
INDEX = "hktvProduct"

# Last-known public search-only key (published in HKTVmall's own search page
# HTML). Only a fallback — the live key is re-fetched on every run.
FALLBACK_APP_ID = "8RN1Y79F02"
FALLBACK_API_KEY = "a4a336abc62ab842842a81de642b484"

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/120.0 Safari/537.36"),
    "Accept": "application/json",
}

# ---------------------------------------------------------------- helpers

def fetch_algolia_key(session):
    """Read the public Algolia search key from HKTVmall's search page."""
    try:
        r = session.get(SEARCH_PAGE, timeout=20)
        r.raise_for_status()
        m = re.search(r"algoliasearch\('([A-Z0-9]+)',\s*'([0-9a-f]+)'", r.text)
        if m:
            return m.group(1), m.group(2)
    except Exception as exc:  # noqa: BLE001 - fall back to known key
        print("  key fetch failed (%s), using fallback key" % exc)
    return FALLBACK_APP_ID, FALLBACK_API_KEY


def search(session, app_id, api_key, queries, hits_per_page=8):
    """One batched Algolia call for many queries. Returns list of hit lists."""
    payload = {"requests": [
        {"indexName": INDEX, "query": q, "hitsPerPage": hits_per_page}
        for q in queries
    ]}
    r = session.post(
        ALGOLIA_HOST.format(app=app_id), json=payload,
        headers=dict(HEADERS, **{
            "X-Algolia-API-Key": api_key,
            "X-Algolia-Application-Id": app_id,
        }),
        timeout=30,
    )
    r.raise_for_status()
    return [res.get("hits", []) for res in r.json().get("results", [])]


_QTY_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(kg|g|l|ml|lb|oz|pcs|pc|rolls?|pack|packs|bags?)\b",
                     re.I)
_MULT_RE = re.compile(r"[x×]\s*(\d+)\s*(?:\(|$)")


def parse_pack(spec_en, spec_zh=""):
    """Parse a pack spec like '250ml x 6' / '2.5kg' / '10pcs'.

    Returns (quantity, unit) normalised to kg / L / pcs, or (None, None).
    """
    text = " ".join([spec_en or "", spec_zh or ""]).lower()
    if not text.strip():
        return None, None
    # multiplier: "250ml x 6" / "250ml x6"
    mult = 1
    m = re.search(r"[x×]\s*(\d+)", text)
    if m:
        mult = int(m.group(1))
    amounts = []
    for num, unit in _QTY_RE.findall(text):
        val = float(num)
        u = unit.lower()
        if u in ("g",):
            amounts.append((val / 1000.0, "kg"))
        elif u == "kg":
            amounts.append((val, "kg"))
        elif u == "ml":
            amounts.append((val / 1000.0, "L"))
        elif u == "l":
            amounts.append((val, "L"))
        elif u == "lb":
            amounts.append((val * 0.453592, "kg"))
        elif u == "oz":
            amounts.append((val * 0.0283495, "kg"))
        elif u in ("pcs", "pc"):
            amounts.append((val, "pcs"))
        else:  # rolls / packs / bags — count only, unit stays generic
            amounts.append((val, u.rstrip("s")))
    if not amounts:
        return None, None
    # Prefer a weight/volume amount over a bare count when both exist.
    for qty, unit in amounts:
        if unit in ("kg", "L"):
            return round(qty * mult, 3), unit
    qty, unit = amounts[0]
    return round(qty * mult, 3), unit


def clean_pack(spec_en, spec_zh=""):
    """Keep a pack spec only if it actually describes a size.

    Some sellers stuff marketing text ('Authorized Dealer', promo slogans)
    into the pack field — showing that as the pack size would be wrong.
    """
    for spec in (spec_en, spec_zh):
        if spec and parse_pack(spec)[0] is not None:
            return spec.strip()
    for spec in (spec_en, spec_zh):
        if spec and re.search(r"\d", spec):
            return spec.strip()
    return ""


def unit_price(price, spec_en, spec_zh=""):
    """Price per kg / L / piece, or None if the pack size is unparsable."""
    qty, unit = parse_pack(spec_en, spec_zh)
    if not qty or not price:
        return None, None
    return round(price / qty, 2), "per " + unit


def competitor_prices(hit):
    """HKTVmall's own recorded rival prices: {'parknshop': {...}, ...}."""
    out = {}
    code_map = {"PP": "parknshop", "WE": "wellcome"}
    for row in hit.get("kaPriceList") or []:
        name = code_map.get(row.get("code"))
        if name and row.get("priceValue") is not None:
            out[name] = {
                "price": float(row["priceValue"]),
                "record_date": row.get("recordDate"),
            }
    return out


def pick_hit(hits, query):
    """Best in-stock hit for a query.

    Prefers hits that carry rival prices (real comparison), then higher
    sales volume, then first in-stock hit. Skips marketplace listings that
    are out of stock.
    """
    in_stock = [h for h in hits if h.get("hasStock") and h.get("sellingPrice")]
    if not in_stock:
        return None
    with_rivals = [h for h in in_stock if h.get("kaPriceList")]
    pool = with_rivals or in_stock
    pool.sort(key=lambda h: (-(h.get("salesVolume") or 0)))
    return pool[0]


def build_item(product, hit):
    """Normalise one Algolia hit into our prices.json item schema."""
    hktv = float(hit["sellingPrice"])
    original = None
    for row in hit.get("priceList") or []:
        if row.get("priceType") == "BUY":
            original = float(row["value"])
    if original is not None and original <= hktv:
        original = None
    spec_en = (hit.get("packingSpecEn") or "").strip()
    spec_zh = (hit.get("packingSpecZh") or "").strip()
    pack = clean_pack(spec_en, spec_zh)
    up, up_unit = unit_price(hktv, spec_en, spec_zh)
    rivals = competitor_prices(hit)
    prices = {"hktvmall": {"price": hktv}}
    for store in ("parknshop", "wellcome"):
        if store in rivals:
            prices[store] = rivals[store]
    all_prices = [v["price"] for v in prices.values()]
    cheapest = min(prices, key=lambda s: prices[s]["price"])
    dearest = max(all_prices)
    return {
        "id": product["id"],
        "name_zh": product["zh"],
        "name_en": product["en"],
        "product_name_zh": (hit.get("nameZh") or "").strip(),
        "product_name_en": (hit.get("nameEn") or "").strip(),
        "category": product["category"],
        "brand": (hit.get("brandEn") or hit.get("brand") or "").strip(),
        "store": (hit.get("storeNameEn") or "").strip(),
        "pack": pack,
        "unit_price": up,
        "unit_price_unit": up_unit,
        "prices": prices,
        "cheapest": cheapest,
        "saving_vs_dearest": round(dearest - prices[cheapest]["price"], 2),
        "saving_pct": (round(100 * (dearest - prices[cheapest]["price"]) / dearest, 1)
                       if dearest else 0),
        "original_price": original,
        "url": ("https://www.hktvmall.com/hktv/en/" + (hit.get("urlEn") or "")
                .lstrip("/")) if hit.get("urlEn") else "",
        "has_3_stores": len(prices) == 3,
        "in_stock": bool(hit.get("hasStock")),
    }


# ---------------------------------------------------------------- main

def run(out_dir=None, live_test=False):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = out_dir or root
    data_dir = os.path.join(out_dir, "data")
    hist_dir = os.path.join(out_dir, "history")
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(hist_dir, exist_ok=True)

    session = requests.Session()
    session.headers.update(HEADERS)
    app_id, api_key = fetch_algolia_key(session)
    print("Algolia app %s, key …%s" % (app_id, api_key[-4:]))

    if live_test:
        hits = search(session, app_id, api_key, ["Vitasoy Soya Bean Milk"], 3)[0]
        print(json.dumps(hits[0], ensure_ascii=False, indent=1)[:1200])
        return {"live_test": True}

    items, missed = [], []
    queries = [p["query"] for p in PRODUCTS]
    for start in range(0, len(queries), 10):
        batch = PRODUCTS[start:start + 10]
        try:
            results = search(session, app_id, api_key,
                             [p["query"] for p in batch])
        except Exception as exc:  # noqa: BLE001
            print("  batch %d failed: %s" % (start, exc))
            missed.extend(p["id"] for p in batch)
            continue
        for product, hits in zip(batch, results):
            hit = pick_hit(hits, product["query"])
            if hit is None:
                missed.append(product["id"])
                print("  MISS: %s (%s)" % (product["id"], product["query"]))
                continue
            items.append(build_item(product, hit))
        time.sleep(0.5)

    today = date.today().isoformat()
    three_store = sum(1 for i in items if i["has_3_stores"])
    snapshot = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S+08:00",
                                      time.localtime()),
        "date": today,
        "source": "HKTVmall public search API (Algolia) — prices as listed on "
                  "hktvmall.com; PARKnSHOP / Wellcome prices are HKTVmall's "
                  "own recorded competitor prices (kaPriceList) with record "
                  "dates, not scraped from those stores directly.",
        "currency": "HKD",
        "stores": {"hktvmall": "HKTVmall", "parknshop": "PARKnSHOP",
                   "wellcome": "Wellcome"},
        "items": items,
        "missed": missed,
        "stats": {
            "tracked": len(items),
            "with_3_stores": three_store,
            "with_unit_price": sum(1 for i in items if i["unit_price"]),
            "missed_count": len(missed),
        },
    }
    with open(os.path.join(data_dir, "prices.json"), "w",
              encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)
    with open(os.path.join(hist_dir, "prices-%s.json" % today), "w",
              encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)
    with open(os.path.join(data_dir, "fallback.js"), "w",
              encoding="utf-8") as f:
        f.write("/* Auto-generated by scraper.py — same snapshot as "
                "prices.json, so index.html also works opened from disk. */\n")
        f.write("window.HK_PRICE_FALLBACK = ")
        json.dump(snapshot, f, ensure_ascii=False)
        f.write(";\n")

    print("OK: %d items, %d with 3 stores, %d missed"
          % (len(items), three_store, len(missed)))
    if missed:
        print("missed: %s" % ", ".join(missed))
    return snapshot


if __name__ == "__main__":
    run(live_test="--live-test" in sys.argv)
