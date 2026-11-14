# Scraper

## Run

```bash
pip install -r requirements.txt   # requests only
python3 scraper.py                # writes ../data + ../history
python3 scraper.py --live-test    # one query, prints the raw Algolia hit
```

## How it works

1. `GET https://www.hktvmall.com/hktv/en/search_a?keyword=rice` and extract
   the public Algolia search-only key from the page HTML
   (`algoliasearch('APP_ID', 'API_KEY')`). The key is published by HKTVmall
   for its own frontend search; it is re-fetched on every run, with a
   last-known key as fallback.
2. One batched Algolia query per 10 products (`hktvProduct` index,
   8 hits each) — about 7 HTTP requests for the whole 66-item list.
3. For each product, pick the best in-stock hit, preferring hits that carry
   `kaPriceList` (HKTVmall's own recorded PARKnSHOP `PP` / Wellcome `WE`
   prices with record dates).
4. Compute unit prices from the pack spec (`250ml x 6` → 1.5 L, `5kg`,
   `10pcs`, `1lb` …). Pack specs that are marketing text, not sizes, are
   dropped, not displayed.
5. Write `data/prices.json`, `data/fallback.js` (embedded snapshot for
   file:// use) and `history/prices-YYYY-MM-DD.json`.
6. Price change: before overwriting `data/prices.json`, the previous
   snapshot is read and each item gets `prev_price` / `prev_date` /
   `change` / `change_pct` (HKTVmall price only) — but only when the
   same HKTVmall listing is compared (identical URL). If the scraper
   picked a different listing for the same query, the change fields
   stay null: a missing change is honest, a wrong one is not. The
   snapshot also carries top-level `prev_date`.

## Add / change items

Edit `products.py` (id, Chinese name, English name, search query,
category) and re-run. A product with no in-stock hit is reported as a
miss and left out of the snapshot — never filled with a made-up price.
