// Checks corrected proposals against the shapes and enum values already in the ledgers.
const fs = require('fs'), path = require('path');
const A = path.resolve(__dirname, '..');
const led = (f) => JSON.parse(fs.readFileSync(path.join(A, f), 'utf8'));
const manual = led('manual-review.json').records, verif = led('verification-review.json').records;
const comp = led('comparability-review.json').records, specs = led('additional-comparison-specs.json').comparisons;
const values = (recs, key) => new Set(Object.values(recs).map((r) => r[key]).filter((v) => v !== undefined));
const keysOf = (recs) => new Set(Object.values(recs).flatMap((r) => Object.keys(r)));
const enums = {
  manual: Object.fromEntries(['status', 'comparisonLevel', 'sourceComparison', 'auditState', 'paperAccess'].map((k) => [k, values(manual, k)])),
  verif: Object.fromEntries(['resultAvailability', 'comparisonOutcome'].map((k) => [k, values(verif, k)])),
  comp: Object.fromEntries(['target', 'resultScope', 'assessment'].map((k) => [k, values(comp, k)])),
  dim: new Set(Object.values(comp).flatMap((r) => Object.values(r.dimensions || {}).map((d) => d.status))),
};
const mk = keysOf(manual), vk = keysOf(verif), ck = keysOf(comp), sk = new Set(specs.flatMap((s) => Object.keys(s)));
const dir = path.join(__dirname, process.argv[2] || 'corrected');
let bad = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), pr = p.proposed || {}, errs = [];
  const chk = (obj, keys, en, label) => { if (!obj) return;
    for (const k of Object.keys(obj)) if (!keys.has(k)) errs.push(`${label}: unknown key ${k}`);
    for (const [k, set] of Object.entries(en)) if (obj[k] !== undefined && !set.has(obj[k])) errs.push(`${label}.${k}: new value ${JSON.stringify(obj[k])}`); };
  chk(pr.manualReview, mk, enums.manual, 'manualReview');
  chk(pr.verificationReview, vk, enums.verif, 'verificationReview');
  chk(pr.comparabilityReview, ck, enums.comp, 'comparabilityReview');
  for (const [d, v] of Object.entries(pr.comparabilityReview?.dimensions || {})) if (!enums.dim.has(v.status)) errs.push(`dimension ${d}: new status ${v.status}`);
  if (pr.additionalComparisonSpec) for (const k of Object.keys(pr.additionalComparisonSpec)) if (!sk.has(k)) errs.push(`spec: unknown key ${k}`);
  if (p.datasetId + '.json' !== f) errs.push('datasetId does not match file name');
  if (!verif[p.datasetId] && !manual[p.datasetId]) errs.push('dataset not in ledgers');
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${f} closure=${p.closure} keys=${Object.keys(pr).join(',')}`);
  errs.forEach((e) => console.log('     ' + e)); bad += errs.length ? 1 : 0;
}
process.exitCode = bad ? 1 : 0;
