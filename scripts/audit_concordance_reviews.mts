import { readFileSync } from 'node:fs';
import definitions from '../data/author-validation/concordance-reviews.json';
import { validateConcordanceReviews } from './lib/concordanceReviewEvidence.mjs';

const records = JSON.parse(readFileSync('data/author-validation/validation-records.generated.json', 'utf8')).records;
console.log(JSON.stringify({ definitionReviewsVerified: validateConcordanceReviews(process.cwd(), definitions, records) }));
