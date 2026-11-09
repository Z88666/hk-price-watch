# Demo / try it in 2 minutes

## 1. Open the site (no install)

```bash
cd hk-price-watch
python3 -m http.server 8000
# open http://localhost:8000
```

Or double-click `index.html` — it works from disk too (the snapshot is
embedded in `data/fallback.js`).

What to try, in 30 seconds:

1. The green cells are the cheapest store for each item.
2. Type `雞蛋` in the search box — eggs across the three stores.
3. Click a category (e.g. 飲品) and change the sort to 最平價錢先.
4. Star an item (☆ → ★), tick 只睇我的關注 — it stays after reload.
5. Scroll to 慳最多 Top 10: on 2026-11-09 the biggest gap was ketchup
   (Wellcome $6.25 vs HKTVmall $12.30) and frozen dumplings.

## 2. Refresh the data (one command)

```bash
pip install -r scraper/requirements.txt
python3 scraper/scraper.py
```

Expected output: `OK: 66 items, 29 with 3 stores, 0 missed` (numbers vary
by day). Then reload the page.

## 3. Run the tests

```bash
python3 -m unittest discover -s tests -v   # 18 tests, no network
node tests/test_frontend.js               # executes the page script, checks 66 rows render
HK_PRICE_LIVE=1 python3 -m unittest tests.test_scraper.LiveTest -v  # 1 live API call
```

## 4. Use it from an AI agent

Copy `skills/hk-price-watch/` into your agent's skills folder, then ask:
「邊間買雞蛋最平?」 The skill reads `data/prices.json` and answers with
the data date. No key, no server.

## 5. Publish it (Miller, on computer)

```bash
# create repo Z88666/hk-price-watch on github.com (public, no README — files are here)
cd hk-price-watch
git init && git add . && git commit -m "HK Price Watch: 66 items, 3 stores, live data"
git branch -M main
git remote add origin https://github.com/Z88666/hk-price-watch.git
git push -u origin main
# then Settings → Pages → Deploy from branch main, folder / (root)
# live at https://z88666.github.io/hk-price-watch/
```

The daily workflow (`.github/workflows/daily-scrape.yml`) starts working
as soon as the repo exists — no secrets to configure.
