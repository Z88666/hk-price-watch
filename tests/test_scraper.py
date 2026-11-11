# -*- coding: utf-8 -*-
"""Unit tests for the scraper. No network access — pure functions only.

Run:  python3 -m unittest discover -s tests -v
Live test (hits the real HKTVmall API once):
       HK_PRICE_LIVE=1 python3 -m unittest tests.test_scraper.LiveTest -v
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scraper"))
import scraper  # noqa: E402
from products import PRODUCTS  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class ParsePackTest(unittest.TestCase):
    def test_kg(self):
        self.assertEqual(scraper.parse_pack("5kg"), (5.0, "kg"))
        self.assertEqual(scraper.parse_pack("2.5kg"), (2.5, "kg"))

    def test_grams_to_kg(self):
        self.assertEqual(scraper.parse_pack("500g"), (0.5, "kg"))

    def test_ml_to_litres(self):
        self.assertEqual(scraper.parse_pack("250ml x 6"), (1.5, "L"))
        self.assertEqual(scraper.parse_pack("1L"), (1.0, "L"))

    def test_pieces(self):
        self.assertEqual(scraper.parse_pack("10pcs"), (10.0, "pcs"))

    def test_multiplier_forms(self):
        self.assertEqual(scraper.parse_pack("900ml x 4"), (3.6, "L"))
        self.assertEqual(scraper.parse_pack("225g x 2"), (0.45, "kg"))

    def test_chained_multiplier(self):
        # "330ml x 8 x 3" is 24 cans, not 8: old code read 2.64L, true 7.92L.
        self.assertEqual(scraper.parse_pack("330ml x 8 x 3"), (7.92, "L"))

    def test_leading_count(self):
        # "2 x 500ml" is 2 bottles: old code read the size (500) as the
        # multiplier and returned 250 litres.
        self.assertEqual(scraper.parse_pack("2 x 500ml"), (1.0, "L"))
        self.assertEqual(scraper.parse_pack("6 x 250ml"), (1.5, "L"))

    def test_glued_multiplier(self):
        # No space between unit and x: "400mlx2pc" must still read 0.8L
        # (the \b in _QTY_RE used to miss "400ml" entirely here).
        self.assertEqual(scraper.parse_pack("400mlx2pc"), (0.8, "L"))
        self.assertEqual(scraper.parse_pack("310ml x 6can"), (1.86, "L"))
        self.assertEqual(scraper.parse_pack("10pcs x 2"), (20.0, "pcs"))

    def test_imperial(self):
        qty, unit = scraper.parse_pack("1lb (16oz)")
        self.assertEqual(unit, "kg")
        self.assertAlmostEqual(qty, 0.454, places=2)

    def test_junk_returns_none(self):
        self.assertEqual(scraper.parse_pack("Authorized Dealer"), (None, None))
        self.assertEqual(scraper.parse_pack(""), (None, None))
        self.assertEqual(scraper.parse_pack("1 Set"), (None, None))


class UnitPriceTest(unittest.TestCase):
    def test_per_kg(self):
        price, unit = scraper.unit_price(72.8, "5kg")
        self.assertEqual((price, unit), (14.56, "per kg"))

    def test_unparsable(self):
        self.assertEqual(scraper.unit_price(10.0, "nonsense"), (None, None))


class CompetitorPricesTest(unittest.TestCase):
    def test_pp_we_mapping(self):
        hit = {"kaPriceList": [
            {"code": "PP", "priceValue": 52.0, "recordDate": "09/11/2026"},
            {"code": "WE", "priceValue": 66.0, "recordDate": "09/11/2026"},
            {"code": "XX", "priceValue": 1.0, "recordDate": "09/11/2026"},
        ]}
        out = scraper.competitor_prices(hit)
        self.assertEqual(out["parknshop"]["price"], 52.0)
        self.assertEqual(out["wellcome"]["record_date"], "09/11/2026")
        self.assertNotIn("XX", out)

    def test_missing(self):
        self.assertEqual(scraper.competitor_prices({}), {})


class PickHitTest(unittest.TestCase):
    def test_prefers_rival_prices(self):
        a = {"hasStock": True, "sellingPrice": 10.0, "salesVolume": 999}
        b = {"hasStock": True, "sellingPrice": 11.0, "salesVolume": 1,
             "kaPriceList": [{"code": "PP", "priceValue": 12.0}]}
        self.assertIs(scraper.pick_hit([a, b], "x"), b)

    def test_skips_out_of_stock(self):
        a = {"hasStock": False, "sellingPrice": 1.0}
        b = {"hasStock": True, "sellingPrice": 2.0}
        self.assertIs(scraper.pick_hit([a, b], "x"), b)

    def test_empty(self):
        self.assertIsNone(scraper.pick_hit([], "x"))


class BuildItemTest(unittest.TestCase):
    def test_schema_and_cheapest(self):
        product = {"id": "test-rice", "zh": "香米", "en": "Rice",
                   "query": "Rice", "category": "rice-oil"}
        hit = {
            "sellingPrice": 50.0, "hasStock": True,
            "priceList": [{"priceType": "BUY", "value": 60.0}],
            "packingSpecEn": "5kg", "nameZh": "香米 5kg",
            "nameEn": "Rice 5kg", "brandEn": "Test",
            "storeNameEn": "Test Store", "urlEn": "hktv/en/p/1",
            "kaPriceList": [
                {"code": "PP", "priceValue": 55.0, "recordDate": "09/11/2026"},
                {"code": "WE", "priceValue": 52.0, "recordDate": "09/11/2026"},
            ],
        }
        item = scraper.build_item(product, hit)
        self.assertEqual(item["cheapest"], "hktvmall")
        self.assertEqual(item["saving_vs_dearest"], 5.0)
        self.assertEqual(item["unit_price"], 10.0)
        self.assertTrue(item["has_3_stores"])
        self.assertEqual(item["original_price"], 60.0)
        for key in ("id", "name_zh", "name_en", "category", "prices",
                    "cheapest", "saving_vs_dearest", "saving_pct"):
            self.assertIn(key, item)


class SnapshotTest(unittest.TestCase):
    """Validate the checked-in data snapshot (generated by the live run)."""

    def test_snapshot_schema(self):
        path = os.path.join(ROOT, "data", "prices.json")
        with open(path, encoding="utf-8") as f:
            snap = json.load(f)
        self.assertEqual(snap["currency"], "HKD")
        self.assertIn("generated_at", snap)
        self.assertGreaterEqual(len(snap["items"]), 50)
        self.assertEqual(len(snap["items"]), len(PRODUCTS))
        for item in snap["items"]:
            self.assertIn("hktvmall", item["prices"])
            self.assertIsInstance(item["prices"]["hktvmall"]["price"], float)
            self.assertIn(item["cheapest"], item["prices"])
            if item["has_3_stores"]:
                self.assertEqual(set(item["prices"]),
                                 {"hktvmall", "parknshop", "wellcome"})
            self.assertTrue(item["in_stock"])
        self.assertEqual(snap["stats"]["tracked"], len(snap["items"]))

    def test_no_invented_prices(self):
        # Every price must trace to a real product listing (name + url).
        path = os.path.join(ROOT, "data", "prices.json")
        with open(path, encoding="utf-8") as f:
            snap = json.load(f)
        for item in snap["items"]:
            self.assertTrue(item["product_name_en"] or item["product_name_zh"])
            self.assertTrue(item["url"].startswith("https://www.hktvmall.com/"))

    def test_unit_prices_match_pack(self):
        # Every stored unit price must be reproducible from the item's own
        # displayed pack + HKTVmall price. Catches parser bugs that silently
        # inflate a per-unit price (e.g. "330ml x 8 x 3" once read as 2.64L,
        # "400mlx2pc" once read as 2pcs). Items with no parsable pack skip.
        path = os.path.join(ROOT, "data", "prices.json")
        with open(path, encoding="utf-8") as f:
            snap = json.load(f)
        for item in snap["items"]:
            if not item.get("pack") or item.get("unit_price") is None:
                continue
            up, uu = scraper.unit_price(item["prices"]["hktvmall"]["price"],
                                        item["pack"])
            if up is None:
                continue
            self.assertEqual(uu, item["unit_price_unit"], item["id"])
            self.assertAlmostEqual(up, item["unit_price"], delta=0.02,
                                   msg=item["id"])


@unittest.skipUnless(os.environ.get("HK_PRICE_LIVE") == "1",
                     "live test: set HK_PRICE_LIVE=1")
class LiveTest(unittest.TestCase):
    def test_live_api_returns_rival_prices(self):
        import requests
        session = requests.Session()
        app_id, api_key = scraper.fetch_algolia_key(session)
        self.assertEqual(len(api_key), 32)
        hits = scraper.search(session, app_id, api_key,
                              ["Vitasoy Soya Bean Milk"], 3)[0]
        self.assertTrue(hits)
        with_rivals = [h for h in hits if h.get("kaPriceList")]
        self.assertTrue(with_rivals, "no hit carried kaPriceList")


if __name__ == "__main__":
    unittest.main()
