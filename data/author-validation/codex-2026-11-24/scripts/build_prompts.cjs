// Derives this pass's worker and refuter prompts from the 2026-11-21 ones. Fails if an expected passage is missing.
const fs = require('fs'), path = require('path');
const here = path.resolve(__dirname, '..'), old = path.resolve(here, '../codex-2026-11-21');
const sub = (t, a, b) => { if (!t.includes(a)) throw new Error('missing passage: ' + a.slice(0, 60)); return t.split(a).join(b); };
let w = fs.readFileSync(path.join(old, 'WORKER_PROMPT.md'), 'utf8').replace(/\r\n/g, '\n');
let r = fs.readFileSync(path.join(old, 'REFUTER_PROMPT.md'), 'utf8').replace(/\r\n/g, '\n');
w = sub(w, '2026-11-21', '2026-11-24'); r = sub(r, '2026-11-21', '2026-11-24');
w = sub(w, '## Closure states', `- \`not_comparable\`: the current record says the available author result answers a different question
  from the registered contrast. Its \`reason\` may be generic, so treat it as a claim to check.
  1. Name the author analysis and the registered contrast precisely: cohort, libraries, replication unit,
     baseline and direction, time point, sex handling, model and estimand. State which of these differ.
  2. Search again for an author result that does answer the registered contrast, in every source listed
     under \`not_located\` above, including figure source data, archives named in \`nextStep\`, code outputs
     and labelled figure panels.
  3. If one exists, compare it within its stated scope. If none exists, close as \`no_valid_comparison\` with
     the specific difference, the sources checked and what would reopen it.
  A pooled effect, a subgroup effect, an interaction, a time-course effect and a different replication unit
  are different questions: never present one as the registered contrast to obtain a comparison. An
  author-method reconstruction stays a separate result and does not validate the registered output.

## Closure states`);
w = sub(w, '   not as established fact.', '   not as established fact.\n6. Do not read other checkouts of this repository or other datasets\' proposals from this pass.');
r = sub(r, '## Write', `7. For a \`compared\` proposal, confirm the author analysis answers the registered contrast (same cohort or a
   justified compatible one, replication unit, baseline, time point and sex handling). If it answers a
   different question, the verdict is \`refuted\`. For \`no_valid_comparison\`, try to find a matching author
   result the worker missed.

## Write`);
fs.writeFileSync(path.join(here, 'WORKER_PROMPT.md'), w); fs.writeFileSync(path.join(here, 'REFUTER_PROMPT.md'), r);
