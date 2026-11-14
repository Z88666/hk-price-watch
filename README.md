# HK Price Watch 香港超市比價

**Which Hong Kong supermarket is cheapest — HKTVmall vs PARKnSHOP vs Wellcome, in one table. Free, no login, no ads. Prices are a dated snapshot (currently 2026-11-14), not live prices; the snapshot date is shown on the page.**

**邊間超市最平,一次過睇晒:HKTVmall、百佳、惠康三間價錢對比,免費、免登入。價錢係有日期嘅快照 (而家係 2026-11-14),唔係即日價。**

## Live demo

Enable GitHub Pages on this repo (Settings → Pages → Deploy from branch `main`, folder `/ (root)`), then open:

**https://z88666.github.io/hk-price-watch/**

Until Pages is enabled, open `index.html` directly in any browser — it works
from disk too (the snapshot is embedded as a fallback).

## What it does

- **66 everyday items** (rice, eggs, milk, bread, noodles, canned food, drinks, household, personal care) — see `scraper/products.py`
- **Side-by-side prices** for HKTVmall / PARKnSHOP / Wellcome, cheapest store highlighted green
- **Savings in HK$ and %** vs the dearest store, plus a Top 10 biggest-savings list
- **Unit prices** (per kg / L / piece) on 53 of 66 items, so different pack sizes are comparable
- **Price change vs the previous snapshot** — each item shows ▲/▼ against
  the last run (HKTVmall price only), with a summary line (how many went up /
  down / stayed), and a "加價最多先" sort. A change is only shown when the
  same HKTVmall listing is compared (identical URL); if the scraper picked a
  different listing, no change is shown rather than a bogus jump.
- **Search** in Chinese or English, category filter, sort by saving / price / name
- **Watchlist** — star items, saved in your browser (localStorage), nothing uploaded
- **Price history** — every daily run is kept under `history/prices-YYYY-MM-DD.json`

## Where the prices come from (honest version)

The scraper (`scraper/scraper.py`) uses **HKTVmall's public product-search
API** — the same Algolia endpoint HKTVmall's own website search uses. The
search page publishes a search-only API key in its public HTML; the scraper
re-fetches it on every run. No login, no secret, no paid API.

The key point: HKTVmall records the **same product's price at PARKnSHOP and
Wellcome** and publishes it in each product record (`kaPriceList`: `PP` =
PARKnSHOP, `WE` = Wellcome, each with a `recordDate`). So one public API
gives a genuine 3-store comparison.

What did **not** work, and why this approach was chosen:

- **PARKnSHOP's own site returns 403** to automated requests (verified 2026-11-09).
- **Wellcome's site is JS-rendered** with no public product API found.
- Scraping either directly would be fragile and rude. Using HKTVmall's own
  published competitor prices is stable, legal to read (public data, same as
  a browser would see), and polite (about 7 requests per run).

Caveats, stated plainly on the site too:

- HKTVmall's price is the price on the snapshot date and often includes a promotion; the
  rival prices are HKTVmall's recorded prices with a record date. If a
  saving looks unusually large, check the store — pack sizes can differ.
- Only 29 of 66 items currently carry all three stores; the rest show
  HKTVmall plus whichever rivals HKTVmall recorded. Coverage grows as
  HKTVmall records more.
- Prices change daily. Always verify before ordering. The data date is
  shown on the page and in `data/prices.json`.

## Use it from an AI agent (no setup)

`skills/hk-price-watch/SKILL.md` is a drop-in agent skill: copy the
`skills/hk-price-watch/` folder into your agent's skills directory and ask
"邊間買雞蛋最平?" — the agent reads `data/prices.json` and answers with
the date. No API key, no server.

## Run it yourself

```bash
pip install -r scraper/requirements.txt   # requests only
python3 scraper/scraper.py                # rewrites data/prices.json
python3 -m unittest discover -s tests     # scraper tests
node tests/test_frontend.js               # frontend render test
python3 -m http.server 8000               # open http://localhost:8000
```

Daily refresh is automated by `.github/workflows/daily-scrape.yml`
(09:00 HKT, commits the new snapshot). The snapshot checked into this repo
is currently 2026-11-14 — if the workflow has not run since, the page says
so plainly ("N 日前嘅快照") instead of pretending the prices are today's.
Full instructions: [`docs/DEMO.md`](docs/DEMO.md).

## Project layout

```
index.html                  static site (pure HTML/CSS/ES5, white bg, iOS 16 safe)
data/prices.json            current snapshot (generated 2026-11-14, real data)
data/fallback.js            same snapshot, embedded for file:// use
history/prices-YYYY-MM-DD.json   daily snapshots
scraper/scraper.py          the scraper (requests only)
scraper/products.py         the 66-item staple list
skills/hk-price-watch/SKILL.md   agent skill (markdown only)
tests/                      unit tests + frontend render test
.github/workflows/          daily scrape automation
```

## Licence

MIT — see [LICENSE](LICENSE). Prices are factual data from a public source;
the code is yours to reuse.

---

## 中文版

### 呢個係咩?

香港超市價錢比較:一次過睇 HKTVmall、百佳、惠康三間價,邊間最平即刻知。
免費、免登入、無廣告。價錢以快照日期為準 (而家係 2026-11-14),唔係即日價。

### 點解有用?

香港買餸,三間超市同款貨可以差成十蚊八蚊。以前要逐間開 app 逐樣查,
而家一頁睇晒,仲有每公斤/每公升單價,唔同包裝都比得到。慳最多嗰 10 樣
一開頁就見到。

### 數據點嚟?

全部價錢來自 HKTVmall 公開搜尋 API(佢自己網站搜尋用緊同一個接口)。
HKTVmall 會記錄同一件貨喺百佳同惠康嘅價錢(`kaPriceList`,附記錄日期),
所以一個 API 已經做到三間比較,唔使逐間爬。百佳網站擋 bot(403),
惠康要 JS 渲染,直接爬又唔穩定又唔禮貌。

### 有咩限制?

- HKTVmall 價係快照當日價,好多時含推廣;百佳/惠康價係 HKTVmall 記錄價,
  附記錄日期,包裝可能有出入,買之前請核實。
- 66 樣入面有 29 樣齊三間價,其餘得 HKTVmall 加其中一間。
- 價錢每日變,頁面有寫明數據日期。

### 點用?

開上面個網址就得,唔使裝嘢唔使登入。想自己跑爬蟲 / 每日自動更新,
睇上面英文 "Run it yourself" 一節,得幾行命令。

## What's new — 2026-11-10 polish

- **Sort by unit price and by saving %** — compare different pack sizes fairly, or find the biggest percentage wins first. 每單位價錢同慳最多 % 排序,唔同包裝都比到。
- **Shopping basket** — tick items and see the total if you buy everything at the cheapest store vs the dearest, plus what the same basket costs at each store — and which single store is cheapest for the whole basket. 剔起要買嘅嘢,即刻睇到買晒最平同最貴差幾多,同埋喺每間店各要幾多錢,仲會話你知成籃去邊間買最平。
- **Discount badges** — HKTVmall items on sale show the real % off the original price (from the data's `original_price` field, nothing invented). 有折扣嘅貨會顯示真實減價 %。
- **Filters** — only items with all 3 store prices, or only discounted items. 新增篩選:齊三間價 / 有折扣。
- **Cheapest-store tally** — the stats bar now shows how often each store is cheapest (HKTVmall is cheapest on most items in this snapshot — the data says so, honestly). 統計列加咗每間店最平次數。
