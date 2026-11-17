// Housing section tests for hk-price-watch (node, no deps).
// Checks data/housing.json values against the published RVD figures,
// the rent-vs-buy / mortgage / stamp-duty calculator maths, and that
// index.html wires the section up.
// Run: node tests/test_housing.js
var fs = require("fs");
var path = require("path");
var root = path.join(__dirname, "..");
var failures = 0;
function check(name, ok, extra) {
  if (ok) console.log("PASS " + name);
  else { failures++; console.log("FAIL " + name + (extra ? " -- " + extra : "")); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function near(a, b) { return a != null && Math.abs(a - b) < 0.001; }

// --- 1. housing.json: real published values (RVD, 2026-09 release) ---
var H = JSON.parse(fs.readFileSync(path.join(root, "data", "housing.json"), "utf8"));
check("asOf is 2026-09", H.asOf === "2026-09", H.asOf);
check("price latest 320.8", H.priceIndex.latest.value === 320.8);
check("price MoM 0.19%", near(H.priceIndex.latest.momPct, 0.19), String(H.priceIndex.latest.momPct));
check("price YoY 9.34%", near(H.priceIndex.latest.yoyPct, 9.34), String(H.priceIndex.latest.yoyPct));
check("rent latest 212.2", H.rentalIndex.latest.value === 212.2);
check("rent MoM 0.47%", near(H.rentalIndex.latest.momPct, 0.47), String(H.rentalIndex.latest.momPct));
check("rent YoY 6.15%", near(H.rentalIndex.latest.yoyPct, 6.15), String(H.rentalIndex.latest.yoyPct));
check("price byClass A 340.4 / rent byClass A 229.3",
  H.priceIndex.byClass.A.value === 340.4 && H.rentalIndex.byClass.A.value === 229.3);
check("yields A/B/C/D/E 3.5/3.1/2.8/2.6/2.3",
  H.yields.latest.A.value === 3.5 && H.yields.latest.B.value === 3.1 &&
  H.yields.latest.C.value === 2.8 && H.yields.latest.D.value === 2.6 &&
  H.yields.latest.E.value === 2.3, JSON.stringify(H.yields.latest));
check("CCI 158.61 on 2026-11-13", H.cci.value === 158.61 && H.cci.date === "2026-11-13");
check("monthly series 24 months, last 2026-09, no nulls in all/rent",
  H.priceIndex.monthly.all.length === 24 &&
  H.priceIndex.monthly.all[23][0] === "2026-09" &&
  H.priceIndex.monthly.all.every(function (p) { return p[1] != null; }) &&
  H.rentalIndex.monthly.all.every(function (p) { return p[1] != null; }));
check("no byArea (RVD monthly tables have none)", H.priceIndex.byArea === undefined);
check("sources cite RVD + data.gov.hk",
  H.sources.rvd.indexOf("rvd.gov.hk") !== -1 && H.sources.datagovhk.indexOf("data.gov.hk") !== -1);

// --- 2. housing-data.js embeds the same object ---
var js = fs.readFileSync(path.join(root, "data", "housing-data.js"), "utf8");
var m = js.match(/var HOUSING_DATA = (\{[\s\S]*\});\s*$/);
check("housing-data.js parses", !!m);
if (m) {
  var embedded = JSON.parse(m[1]);
  check("embedded data equals housing.json", eq(embedded, H));
}

// --- 3. calculator maths (extract pure functions from index.html) ---
var html = fs.readFileSync(path.join(root, "index.html"), "utf8");
function extract(name) {
  var re = new RegExp("function " + name + "\\([\\s\\S]*?\\n\\}");
  var mm = html.match(re);
  if (!mm) throw new Error("function not found: " + name);
  return mm[0];
}
eval(extract("monthlyPayment"));
eval(extract("grossYield"));
eval(extract("pctChange"));
eval(extract("fmtHK"));
eval(extract("mortgageBreakdown"));
eval(extract("stampDutyAvd"));
// round-trip identity: pay * annuity factor == loan (validates the PMT formula)
(function () {
  var loan = 4200000, rate = 3.5, years = 30;
  var pay = monthlyPayment(loan, rate, years);
  var r = rate / 100 / 12, n = years * 12;
  var back = pay * (1 - Math.pow(1 + r, -n)) / r;
  check("monthlyPayment round-trips to loan", Math.abs(back - loan) / loan < 0.001,
    "pay=" + pay + " back=" + back);
  check("monthlyPayment sane range 18000-19500", pay > 18000 && pay < 19500, "pay=" + pay);
})();
check("monthlyPayment zero rate = loan/n", monthlyPayment(120000, 0, 10) === 1000);
check("monthlyPayment rejects bad input",
  monthlyPayment(null, 3.5, 30) === null && monthlyPayment(0, 3.5, 30) === null &&
  monthlyPayment(100000, 3.5, 0) === null);
check("grossYield 15000/6000000 = 3.0%", grossYield(6000000, 15000) === 3);
check("grossYield rejects bad input", grossYield(0, 15000) === null && grossYield(6000000, -1) === null);
check("pctChange 320.5 vs 320.3 = 0.1", pctChange(320.5, 320.3) === 0.1, String(pctChange(320.5, 320.3)));
check("pctChange null-safe", pctChange(null, 5) === null && pctChange(5, 0) === null);
check("fmtHK adds commas", fmtHK(4200000) === "$4,200,000", fmtHK(4200000));
check("fmtHK negative", fmtHK(-500) === "-$500", fmtHK(-500));
// mortgage breakdown: same PMT, plus totals that must reconcile
(function () {
  var b = mortgageBreakdown(4200000, 3.5, 30);
  check("mortgageBreakdown monthly sane range", b && b.monthly > 18000 && b.monthly < 19500, b && String(b.monthly));
  check("mortgageBreakdown totals reconcile",
    b && Math.abs(b.totalPaid - b.monthly * 360) < 1 &&
    Math.abs(b.totalInterest - (b.totalPaid - 4200000)) < 1);
  check("mortgageBreakdown total interest 2.5-2.7M",
    b && b.totalInterest > 2500000 && b.totalInterest < 2700000, b && String(b.totalInterest));
  var z = mortgageBreakdown(120000, 0, 10);
  check("mortgageBreakdown zero rate = loan/n", z && z.monthly === 1000 && z.totalInterest === 0);
  check("mortgageBreakdown rejects bad input",
    mortgageBreakdown(null, 3.5, 30) === null && mortgageBreakdown(0, 3.5, 30) === null &&
    mortgageBreakdown(100000, 3.5, 0) === null);
})();
// stamp duty: AVD Scale 2 (IRD, from 26 Feb 2026). Spot-check every band edge.
check("stampDuty 3,000,000 = $100", stampDutyAvd(3000000).duty === 100);
check("stampDuty 4,000,000 = $100", stampDutyAvd(4000000).duty === 100);
check("stampDuty 4,000,001 rounds up to $101", stampDutyAvd(4000001).duty === 101, String(stampDutyAvd(4000001).duty));
check("stampDuty 4,500,000 = $67,500", stampDutyAvd(4500000).duty === 67500);
check("stampDuty 6,000,000 = $135,000 (2.25%)", stampDutyAvd(6000000).duty === 135000 && stampDutyAvd(6000000).rate === "2.25%");
check("stampDuty 8,000,000 = $240,000 (3%)", stampDutyAvd(8000000).duty === 240000);
check("stampDuty 10,000,000 = $370,000 (marginal band)", stampDutyAvd(10000000).duty === 370000, String(stampDutyAvd(10000000).duty));
check("stampDuty 11,000,000 = $412,500 (3.75%)", stampDutyAvd(11000000).duty === 412500);
check("stampDuty 25,000,000 = $1,062,500 (4.25%)", stampDutyAvd(25000000).duty === 1062500);
check("stampDuty rejects bad input",
  stampDutyAvd(0) === null && stampDutyAvd(-5) === null && stampDutyAvd(null) === null);

// --- 4. index.html wiring + ES5 ---
["housingStats", "housingTrend", "housingClass", "housingNote", "housingClassHead",
 "calcBtn", "calcPrice", "calcRent", "calcDown", "calcRate", "calcYears", "calcOut",
 "mgPrice", "mgDown", "mgRate", "mgYears", "mgBtn", "mgOut",
 "sdPrice", "sdBtn", "sdOut",
 "renderHousing", "monthlyPayment", "grossYield",
 "mortgageBreakdown", "stampDutyAvd", "syncHousing"].forEach(function (id) {
  check("index.html contains " + id, html.indexOf(id) !== -1);
});
check("housing-data.js script tag present", html.indexOf('src="data/housing-data.js"') !== -1);
check("no fabricated prices note present", html.indexOf("绝不编造价格") !== -1);
check("sync fetches committed housing.json", html.indexOf('fetch("data/housing.json")') !== -1);
check("no hardcoded 2026-08 left in housing stats", html.indexOf("2026-08") === -1);
var hStart = html.indexOf("/* ---------- Housing");
var hEnd = html.indexOf("function start(data)");
var hBlock = (hStart !== -1 && hEnd !== -1) ? html.slice(hStart, hEnd) : "";
check("housing JS block found", hBlock.length > 500);
check("housing JS is ES5 (no =>, const, let, backticks)",
  hBlock.indexOf("=>") === -1 && !/\bconst\b|\blet\b/.test(hBlock) && hBlock.indexOf("`") === -1);
check("housing HTML has no external script", (html.match(/<script src=/g) || []).length === 2);

console.log(failures === 0 ? "\nALL HOUSING TESTS PASSED" : "\n" + failures + " HOUSING TEST(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
