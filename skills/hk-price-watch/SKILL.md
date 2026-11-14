---
name: hk-price-watch
description: Check the cheapest Hong Kong supermarket price for everyday groceries across HKTVmall, PARKnSHOP and Wellcome. Use when the user asks which Hong Kong store is cheapest for a grocery item, what something costs in Hong Kong, or wants a grocery price comparison. Reads the project's prices.json (a dated snapshot — always state its date) or re-runs the scraper for fresh data. No login, no paid API.
---

# HK Price Watch — Hong Kong supermarket price check

## What this is

A price table for everyday Hong Kong groceries, comparing
**HKTVmall, PARKnSHOP (百佳) and Wellcome (惠康)** side by side. The data is
a dated snapshot (currently 2026-11-14) refreshed by a daily scraper run —
always state the snapshot date, never present the prices as today's. Data lives
in `data/prices.json` in this repo and on the static site (`index.html`).

## How to answer a price question

1. Read `data/prices.json` (or fetch the raw file from the repo:
   `https://raw.githubusercontent.com/Z88666/hk-price-watch/main/data/prices.json`).
2. Find the item by Chinese or English name (`name_zh` / `name_en`).
3. Answer with:
   - the cheapest store and its price,
   - the other stores' prices for comparison,
   - how much is saved vs the dearest store (`saving_vs_dearest`, `saving_pct`),
   - the unit price if present (`unit_price` + `unit_price_unit`),
   - the data date (`date` / `generated_at`) — **always state the date**.
4. If the item is not in the list, say so plainly. **Never invent a price.**

## Answer format

> 香米 5公斤 — 最平 HKTVmall $72.80,百佳 $72.90,惠康 $72.90。
> 每公斤 $14.56。價錢截至 2026-11-14,落單前請到店家核實。

## Fresh data

Prices go stale. If the user wants today's price, or the snapshot is more
than 2 days old, re-run the scraper before answering:

```bash
pip install -r scraper/requirements.txt   # requests only
python3 scraper/scraper.py                # rewrites data/prices.json
```

Then answer from the new `data/prices.json`. The scraper uses HKTVmall's
public search API — the same endpoint its own website uses — no login, no
key to manage. PARKnSHOP / Wellcome prices in the data are HKTVmall's own
recorded competitor prices (with record dates), not scraped from those
stores directly; say that if asked where the rival prices come from.

## Rules

- Never invent, estimate, or round a price to a "typical" value. If it is
  not in `prices.json`, say it is not tracked.
- Always give the data date. A price without a date is not an answer.
- HKTVmall's price is the price on the snapshot date and often includes a promotion; the
  rival prices are HKTVmall's recorded prices with a record date. If the
  saving looks unusually large, flag it ("惠康記錄價,日期 X,包裝可能有出入").
- Prices are in HKD. Unit prices are per kg / L / piece as stated.
- Do not claim the data is live unless the scraper was just run.
