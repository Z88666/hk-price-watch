// Structural check for a rebuilt data/housing.json (month-agnostic).
// Run in the monthly GitHub Action after build_housing.py: verifies the
// rebuild is sane without hardcoding the current month's values, so the
// Action keeps working after every RVD release.
// Run: node tests/check_housing_json.js
var fs = require("fs");
var path = require("path");
var H = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "housing.json"), "utf8"));
var failures = 0;
function check(name, ok, extra) {
  if (ok) console.log("PASS " + name);
  else { failures++; console.log("FAIL " + name + (extra ? " -- " + extra : "")); }
}
function near(a, b, tol) { return a != null && Math.abs(a - b) <= (tol || 0.011); }
function pct(a, b) { return Math.round((a / b - 1) * 100 * 100) / 100; }

check("asOf is YYYY-MM", /^\d{4}-\d{2}$/.test(H.asOf || ""), H.asOf);
check("asOf is recent (this month or up to 3 months back)", (function () {
  var d = new Date(), m = d.getFullYear() * 12 + (d.getMonth() + 1);
  var p = (H.asOf || "0-0").split("-");
  var am = parseInt(p[0], 10) * 12 + parseInt(p[1], 10);
  return am <= m && m - am <= 3;
})(), H.asOf);
["priceIndex", "rentalIndex"].forEach(function (sec) {
  var s = H[sec];
  check(sec + " latest positive", s && s.latest && s.latest.value > 0, JSON.stringify(s && s.latest));
  check(sec + " latest month == asOf", s && s.latest && s.latest.month === H.asOf);
  check(sec + " monthly 24 months ending asOf",
    s && s.monthly && s.monthly.all && s.monthly.all.length === 24 &&
    s.monthly.all[23][0] === H.asOf);
  check(sec + " monthly all-class has no nulls",
    s && s.monthly && s.monthly.all.every(function (pt) { return pt[1] != null; }));
  check(sec + " MoM recomputes from series",
    s && near(s.latest.momPct, pct(s.monthly.all[23][1], s.monthly.all[22][1])),
    String(s && s.latest.momPct));
  check(sec + " YoY recomputes from series",
    s && near(s.latest.yoyPct, pct(s.monthly.all[23][1], s.monthly.all[11][1])),
    String(s && s.latest.yoyPct));
  ["A", "B", "C", "D", "E"].forEach(function (k) {
    check(sec + " byClass " + k + " positive",
      s && s.byClass && s.byClass[k] && s.byClass[k].value > 0);
  });
});
check("yields A-E between 0 and 10",
  ["A", "B", "C", "D", "E"].every(function (k) {
    return H.yields && H.yields.latest[k] && H.yields.latest[k].value > 0 && H.yields.latest[k].value < 10;
  }), JSON.stringify(H.yields && H.yields.latest));
check("yields monthly 24 months", H.yields && H.yields.monthly && H.yields.monthly.A.length === 24);
check("CCI present with value and date", H.cci && H.cci.value > 0 && !!H.cci.date);
check("sources cite RVD + data.gov.hk",
  H.sources && H.sources.rvd.indexOf("rvd.gov.hk") !== -1 &&
  H.sources.datagovhk.indexOf("data.gov.hk") !== -1);

console.log(failures === 0 ? "\nHOUSING JSON CHECK PASSED" : "\n" + failures + " HOUSING JSON CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
