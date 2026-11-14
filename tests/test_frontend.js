/* Frontend render test — runs index.html's inline script in Node with a
   minimal DOM shim and checks it actually renders rows from prices.json.
   Run:  node tests/test_frontend.js
   Exit 0 = pass. No browser needed.
*/
"use strict";
var fs = require("fs");
var path = require("path");
var ROOT = path.join(__dirname, "..");

var failures = [];
function check(name, ok, extra) {
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? " — " + extra : ""));
  if (!ok) failures.push(name);
}

// --- 1. static checks on index.html ---------------------------------------
var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
check("references data/prices.json", html.indexOf("data/prices.json") !== -1);
check("references data/fallback.js", html.indexOf("data/fallback.js") !== -1);
check("no external http(s) resource",
  !/src="https?:|href="https?:|@import|url\(https?:/.test(html));
check("white background declared", /background:\s*#ffffff/.test(html));
check("no dark-mode CSS", html.indexOf("prefers-color-scheme") === -1);
check("no 'daily update' claim (snapshot is 2026-11-09, not live)",
  html.indexOf("每日更新") === -1 && html.indexOf("價為即時價") === -1 &&
  html.indexOf("價係即時價") === -1);
check("snapshot wording present in page copy",
  html.indexOf("快照日期為準") !== -1);
check("change summary wording present", html.indexOf("較上次") !== -1);
check("viewport meta present", html.indexOf("viewport") !== -1);
var script = html.match(/<script>([\s\S]*?)<\/script>/g);
var inline = script.filter(function (s) { return s.indexOf("src=") === -1; })
  .map(function (s) { return s.replace(/<\/?script>/g, ""); }).join("\n");
check("ES5 only (no const/let/arrow/template literal)",
  !/\b(const|let)\b|=>|`/.test(inline));

// --- 2. data checks --------------------------------------------------------
var snap = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "prices.json"), "utf8"));
check("snapshot has >=50 items", snap.items.length >= 50, snap.items.length + " items");
check("snapshot has 3-store items",
  snap.items.filter(function (i) { return i.has_3_stores; }).length >= 10,
  snap.stats.with_3_stores + " with 3 stores");
var fbSrc = fs.readFileSync(path.join(ROOT, "data", "fallback.js"), "utf8");
check("fallback.js carries same snapshot date",
  fbSrc.indexOf(snap.generated_at) !== -1);
check("every item has HKTVmall price",
  snap.items.every(function (i) { return i.prices.hktvmall && i.prices.hktvmall.price > 0; }));
/* --- price-change fields (scraper compares with the previous snapshot) --- */
check("snapshot carries a prev_date",
  typeof snap.prev_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(snap.prev_date));
var prevSnap = JSON.parse(fs.readFileSync(
  path.join(ROOT, "history", "prices-" + snap.prev_date + ".json"), "utf8"));
check("prev snapshot file matches prev_date", prevSnap.date === snap.prev_date);
var prevById = {};
prevSnap.items.forEach(function (i) { prevById[i.id] = i; });
var changedItems = snap.items.filter(function (i) { return i.change != null && i.change !== 0; });
var unchangedItems = snap.items.filter(function (i) { return i.change === 0; });
var noDeltaItems = snap.items.filter(function (i) { return i.change == null; });
check("change fields cover every item exactly once",
  changedItems.length + unchangedItems.length + noDeltaItems.length === snap.items.length,
  changedItems.length + " changed, " + unchangedItems.length + " same, " + noDeltaItems.length + " no delta");
check("every non-null change matches cur minus prev_price",
  snap.items.every(function (i) {
    if (i.change == null) return true;
    return Math.abs((i.prices.hktvmall.price - i.prev_price) - i.change) < 0.001;
  }));
check("no absurd jump (|change_pct| <= 100)",
  snap.items.every(function (i) { return i.change_pct == null || Math.abs(i.change_pct) <= 100; }));
check("no-delta items are only ones whose HKTVmall listing changed",
  noDeltaItems.every(function (i) {
    var old = prevById[i.id];
    return !old || i.url !== old.url;
  }), noDeltaItems.map(function (i) { return i.id; }).join(","));
check("changed items kept the same listing URL",
  changedItems.every(function (i) { return prevById[i.id] && i.url === prevById[i.id].url; }));
check("no zero/negative prices",
  snap.items.every(function (i) {
    return Object.keys(i.prices).every(function (k) { return i.prices[k].price > 0; });
  }));

// --- 3. execute the page script with a DOM shim ----------------------------
var els = {};
function makeEl(id) {
  return {
    id: id, value: "", innerHTML: "", textContent: "", checked: false,
    className: "", addEventListener: function () {}, // events not needed here
  };
}
["q", "sort", "watchOnly", "cats", "deals", "rows", "count", "stats",
 "sourceNote"].forEach(function (id) { els[id] = makeEl(id); });
els.sort.value = "saving";

var store = {};
global.localStorage = {
  getItem: function (k) { return store[k] || null; },
  setItem: function (k, v) { store[k] = v; },
};
global.window = { fetch: null, HK_PRICE_FALLBACK: snap };
global.document = { getElementById: function (id) { return els[id]; } };
global.fetch = undefined;

try {
  // run the inline script; it takes the fallback branch (no fetch)
  eval(inline);
  var rowsHtml = els.rows.innerHTML;
  var rowCount = (rowsHtml.match(/<tr>/g) || []).length;
  check("render() produced table rows", rowCount === snap.items.length,
    rowCount + " rows for " + snap.items.length + " items");
  check("cheapest cell highlighted", rowsHtml.indexOf("cheapest") !== -1);
  check("stats rendered", els.stats.innerHTML.indexOf(String(snap.items.length)) !== -1);
  check("deals rendered (top 10)", (els.deals.innerHTML.match(/class="deal"/g) || []).length === 10);
  check("source note rendered", els.sourceNote.textContent.indexOf("HKTVmall") !== -1);
  check("source note states snapshot date + that it is not today's price",
    els.sourceNote.textContent.indexOf(snap.date) !== -1 &&
    els.sourceNote.textContent.indexOf("快照") !== -1 &&
    els.sourceNote.textContent.indexOf("即時價") === -1);
  check("a real product name appears", rowsHtml.indexOf("香米") !== -1);
  check("a real price appears",
    rowsHtml.indexOf("$" + snap.items[0].prices.hktvmall.price.toFixed(2)) !== -1);
  check("stats show change vs previous snapshot",
    els.stats.innerHTML.indexOf("較上次") !== -1 &&
    els.stats.innerHTML.indexOf(snap.prev_date) !== -1);
  check("changed items show an arrow in their row",
    changedItems.length === 0 ||
    rowsHtml.indexOf("▲") !== -1 || rowsHtml.indexOf("▼") !== -1);
} catch (e) {
  check("page script runs without error", false, String(e && e.stack || e));
}

// --- 4. pure-function checks (extracted from the inline script) -----------
function extractFn(name) {
  var m = inline.match(new RegExp("function " + name + "\\([\\s\\S]*?\\n\\}"));
  return m ? m[0] : null;
}
var lib = extractFn("discountPct") + "\n" + extractFn("cheapestPrice") + "\n" +
  extractFn("changeText") + "\n" +
  extractFn("sortItems") + "\n" +
  extractFn("basketTotals") + "\n" + extractFn("cheapestBasketStore") + "\n" +
  extractFn("cheapestStoreTally") + "\n" +
  extractFn("snapshotAgeDays") + "\n" + extractFn("snapshotNote") + "\n" +
  extractFn("dearestStore") + "\n" +
  ";global.__hk = { discountPct: discountPct, cheapestPrice: cheapestPrice, changeText: changeText, sortItems: sortItems, " +
  "basketTotals: basketTotals, cheapestBasketStore: cheapestBasketStore, cheapestStoreTally: cheapestStoreTally, " +
  "snapshotAgeDays: snapshotAgeDays, snapshotNote: snapshotNote, dearestStore: dearestStore };\n";
try {
  eval(lib);
  var discountPct = global.__hk.discountPct, cheapestPrice = global.__hk.cheapestPrice,
    changeText = global.__hk.changeText,
    sortItems = global.__hk.sortItems,
    basketTotals = global.__hk.basketTotals,
    cheapestBasketStore = global.__hk.cheapestBasketStore,
    cheapestStoreTally = global.__hk.cheapestStoreTally,
    snapshotAgeDays = global.__hk.snapshotAgeDays,
    snapshotNote = global.__hk.snapshotNote,
    dearestStore = global.__hk.dearestStore;
  /* --- 3rd polish: snapshot honesty helpers --- */
  check("changeText rise shows ▲ with +pct",
    changeText({ change: 5, change_pct: 10, prev_date: "2026-11-13" }) === "較 11-13 ▲ $5.00 (+10%)");
  check("changeText fall shows ▼ without + sign",
    changeText({ change: -15.1, change_pct: -27.5, prev_date: "2026-11-13" }) === "較 11-13 ▼ $15.10 (-27.5%)");
  check("changeText null when price unchanged",
    changeText({ change: 0, change_pct: 0, prev_date: "2026-11-13" }) === null);
  check("changeText null when not comparable",
    changeText({ change: null, prev_date: "2026-11-13" }) === null);
  var changeSample = [
    { id: "x", name_en: "X", change: -5 },
    { id: "y", name_en: "Y", change: 10 },
    { id: "z", name_en: "Z", change: null }
  ];
  var byChg = sortItems(changeSample, "change");
  check("sort change: biggest rise first, nulls last",
    byChg[0].id === "y" && byChg[1].id === "x" && byChg[2].id === "z");
  check("snapshotAgeDays same day = 0", snapshotAgeDays("2026-11-09", "2026-11-09") === 0);
  check("snapshotAgeDays 2 days later = 2", snapshotAgeDays("2026-11-09", "2026-11-11") === 2);
  check("snapshotAgeDays rejects impossible date 2026-02-30",
    snapshotAgeDays("2026-02-30", "2026-11-11") === null);
  check("snapshotAgeDays rejects junk", snapshotAgeDays("2026-11-09", "junk") === null);
  check("snapshotNote today says 今日", snapshotNote({ date: "2026-11-09" }, "2026-11-09").indexOf("今日") !== -1);
  check("snapshotNote 3 days old says 3 日前",
    snapshotNote({ date: "2026-11-09" }, "2026-11-12").indexOf("3 日前") !== -1);
  check("dearestStore picks highest price",
    dearestStore({ hktvmall: { price: 5 }, wellcome: { price: 9 } }) === "wellcome");
  check("dearestStore single store returns it",
    dearestStore({ hktvmall: { price: 5 } }) === "hktvmall");
  check("dearestStore empty returns null", dearestStore({}) === null);
  check("dearestStore null returns null", dearestStore(null) === null);
  var rice = snap.items[0];
  var ricePct = rice.original_price
    ? Math.round(1000 * (rice.original_price - rice.prices.hktvmall.price) / rice.original_price) / 10
    : null;
  check("discountPct rice matches snapshot prices",
    discountPct(rice) === ricePct, "got " + discountPct(rice) + ", expected " + ricePct);
  check("discountPct null when no original price",
    discountPct({ original_price: null, prices: { hktvmall: { price: 10 } } }) === null);
  check("discountPct null when not discounted",
    discountPct({ original_price: 10, prices: { hktvmall: { price: 10 } } }) === null);
  var byUnit = sortItems(snap.items, "unit");
  check("sort unit: cheapest per-unit first, nulls last",
    byUnit[0].unit_price != null && byUnit[byUnit.length - 1].unit_price == null);
  var byPct = sortItems(snap.items, "savingPct");
  check("sort savingPct descending", byPct[0].saving_pct >= byPct[1].saving_pct);
  check("sortItems does not mutate the snapshot",
    snap.items[0].id === "rice-jasmine-5kg");
  var bt = basketTotals(snap.items, { "rice-jasmine-5kg": 1 });
  var riceCheapest = Math.min.apply(null, Object.keys(rice.prices).map(function (k) { return rice.prices[k].price; }));
  var riceDearest = Math.max.apply(null, Object.keys(rice.prices).map(function (k) { return rice.prices[k].price; }));
  check("basketTotals one item matches snapshot rice prices",
    Math.abs(bt.cheapestTotal - riceCheapest) < 0.001 && Math.abs(bt.dearestTotal - riceDearest) < 0.001 &&
    bt.count === 1 && Math.abs(bt.saving - (riceDearest - riceCheapest)) < 0.001);
  check("basketTotals per-store sums include the item",
    Math.abs(bt.perStore.hktvmall - rice.prices.hktvmall.price) < 0.001 && bt.perStoreCount.wellcome === 1);
  check("basketTotals empty basket = 0",
    basketTotals(snap.items, {}).count === 0);
  var tally = cheapestStoreTally(snap.items);
  check("cheapest tally sums to item count",
    tally.hktvmall + tally.parknshop + tally.wellcome === snap.items.length,
    JSON.stringify(tally));
  check("cheapest tally HKTVmall is most often cheapest", tally.hktvmall > 60);
  /* --- 2nd polish: corrupt / missing fields must not crash sorting --- */
  var corrupt = [
    { id: "a", name_en: "A", prices: {}, cheapest: "hktvmall" },
    { id: "b", name_en: "B", prices: { hktvmall: { price: 5 } }, cheapest: "wellcome" },
    { id: "c", name_en: "C", prices: { hktvmall: { price: 9 } }, cheapest: "hktvmall",
      saving_vs_dearest: 2, saving_pct: 18 }
  ];
  check("discountPct null when prices block missing",
    discountPct({ original_price: 20 }) === null);
  check("cheapestPrice falls back to lowest price when cheapest ref is stale",
    cheapestPrice(corrupt[1]) === 5);
  check("cheapestPrice null when no prices at all", cheapestPrice(corrupt[0]) === null);
  var byCheap = sortItems(corrupt, "cheapest");
  check("sort cheapest tolerates missing cheapest refs",
    byCheap[0].id === "b" && byCheap[byCheap.length - 1].id === "a");
  check("sort saving tolerates missing saving fields",
    sortItems(corrupt, "saving")[0].id === "c");
  var bt2 = basketTotals(snap.items, { "rice-jasmine-5kg": 1 });
  check("cheapestBasketStore picks the cheapest whole-basket store",
    cheapestBasketStore(bt2) === "hktvmall");
  check("cheapestBasketStore null for empty basket",
    cheapestBasketStore(basketTotals(snap.items, {})) === null);
} catch (e) {
  check("pure functions extract + run", false, String(e && e.stack || e));
}
check("sort options include unit + savingPct + change",
  html.indexOf('value="unit"') !== -1 && html.indexOf('value="savingPct"') !== -1 &&
  html.indexOf('value="change"') !== -1);
check("basket checkbox + basket bar present",
  html.indexOf('class="basket"') !== -1 && html.indexOf('id="basketBar"') !== -1);
check("3-store + discount filters present",
  html.indexOf('id="f3"') !== -1 && html.indexOf('id="fDisc"') !== -1);

console.log(failures.length === 0 ? "\nALL FRONTEND CHECKS PASSED"
  : "\n" + failures.length + " CHECK(S) FAILED");
process.exit(failures.length === 0 ? 0 : 1);
