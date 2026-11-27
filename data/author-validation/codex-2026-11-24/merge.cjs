// Merges upheld, corrected proposals into the review ledgers. Only the touched records are
// re-serialized; every other record keeps its original bytes. Usage:
//   node merge.cjs [--dry-run] [--hold id,id,...] [--only id,id,...]
//     [--keep-existing-spec | --replace-spec] [--keep-effects-dimension]
// --keep-existing-spec merges the review records but not the proposed comparison spec.
// --replace-spec swaps the dataset's existing spec for the proposed one, in place.
// --keep-effects-dimension leaves comparability dimensions.effects as it is, because an
// active concordance review binds to its status and note.
const fs = require('fs'), path = require('path');
const A = path.resolve(__dirname, '..');
const dry = process.argv.includes('--dry-run');
const holdArg = process.argv[process.argv.indexOf('--hold') + 1];
const hold = new Set(process.argv.includes('--hold') ? holdArg.split(',') : []);
const only = process.argv.includes('--only') ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(',')) : null;

// Returns [start, end) of the value of a record keyed `id` inside the object `"records": {...}`.
function recordSpan(text, id) {
  const key = `\n    ${JSON.stringify(id)}: `;
  const at = text.indexOf(key);
  if (at < 0) return null;
  let i = at + key.length, depth = 0, inString = false;
  const start = i;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inString) { if (ch === '\\') i++; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return [start, i + 1]; }
  }
  throw new Error(`unterminated record ${id}`);
}
const indent = (value) => JSON.stringify(value, null, 2).replace(/\n/g, '\n    ');

function mergeRecords(file, updates) {
  const p = path.join(A, file);
  let text = fs.readFileSync(p, 'utf8');
  const records = JSON.parse(text).records;
  const appended = [];
  for (const [id, proposal] of updates) {
    const merged = { ...(records[id] || {}), ...proposal };
    const span = recordSpan(text, id);
    if (span) text = text.slice(0, span[0]) + indent(merged) + text.slice(span[1]);
    else appended.push([id, merged]);
  }
  if (appended.length) {
    const close = text.lastIndexOf('\n  }\n}');
    if (close < 0) throw new Error(`${file}: unexpected layout`);
    text = text.slice(0, close) + appended.map(([id, rec]) => `,\n    ${JSON.stringify(id)}: ${indent(rec)}`).join('') + text.slice(close);
  }
  JSON.parse(text);
  if (!dry) fs.writeFileSync(p, text);
  return { changed: updates.length - appended.length, added: appended.length };
}

const corrected = path.join(__dirname, 'corrected'), verdicts = path.join(__dirname, 'verdicts');
const proposals = fs.readdirSync(corrected).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(corrected, f), 'utf8')))
  .filter((p) => !hold.has(p.datasetId) && (!only || only.has(p.datasetId)))
  .filter((p) => ['upheld', 'upheld_with_corrections'].includes(JSON.parse(fs.readFileSync(path.join(verdicts, `${p.datasetId}.json`), 'utf8')).verdict));
if (process.argv.includes('--keep-effects-dimension')) {
  const current = JSON.parse(fs.readFileSync(path.join(A, 'comparability-review.json'), 'utf8')).records;
  for (const p of proposals) p.proposed.comparabilityReview.dimensions.effects = current[p.datasetId].dimensions.effects;
}
const pick = (key) => proposals.filter((p) => p.proposed?.[key]).map((p) => [p.datasetId, p.proposed[key]]);
const report = {
  merged: proposals.length, held: [...hold],
  manualReview: mergeRecords('manual-review.json', pick('manualReview')),
  verificationReview: mergeRecords('verification-review.json', pick('verificationReview')),
  comparabilityReview: mergeRecords('comparability-review.json', pick('comparabilityReview')),
};
const specsPath = path.join(A, 'additional-comparison-specs.json');
const specs = JSON.parse(fs.readFileSync(specsPath, 'utf8'));
const newSpecs = process.argv.includes('--keep-existing-spec') ? [] : pick('additionalComparisonSpec').map(([, s]) => s);
const replaced = [];
if (process.argv.includes('--replace-spec')) {
  for (const spec of newSpecs.splice(0)) {
    const at = specs.comparisons.map((o, i) => (o.datasetId === spec.datasetId && o.contrast === spec.contrast ? i : -1)).filter((i) => i >= 0);
    if (at.length !== 1) throw new Error(`${spec.datasetId}: expected one existing spec for ${spec.contrast}, found ${at.length}`);
    specs.comparisons[at[0]] = spec;
    replaced.push(spec.datasetId);
  }
}
const clash = newSpecs.filter((s) => specs.comparisons.some((o) => o.datasetId === s.datasetId));
if (clash.length) throw new Error(`specs would replace existing entries: ${clash.map((s) => s.datasetId).join(', ')}`);
specs.comparisons.push(...newSpecs);
if (!dry) fs.writeFileSync(specsPath, `${JSON.stringify(specs, null, 2)}\n`);
report.additionalComparisonSpecs = { added: newSpecs.length, replaced };
console.log(JSON.stringify(report, null, 2));
