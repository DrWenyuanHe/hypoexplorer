"""Adversarial tests for source accounting, independent of generated pass counts."""
import unittest
import copy
from audit_count_conservation import compare_rows, compare_unique_rows, evidence_matches, index, value


class SourceAccountingTests(unittest.TestCase):
    def test_balanced_but_wrong_gene_values_cannot_pass(self):
        rows, _ = compare_rows(['A', 'B'], [[10], [20]], ['A', 'B'], [[11], [19]], ['s'])
        self.assertEqual(rows[0]['count_conservation_delta'], 0)
        self.assertEqual(rows[0]['mismatching_retained_cells'], 2)
        self.assertEqual(rows[0]['status'], 'review')

    def test_one_count_discrepancy_in_large_library_stays_visible(self):
        rows, _ = compare_rows(['A'], [[1e12]], ['A'], [[1e12 + 1]], ['s'])
        self.assertEqual(rows[0]['status'], 'review')

    def test_unexplained_source_gene_removal_cannot_pass(self):
        with self.assertRaisesRegex(ValueError, 'feature coverage'):
            compare_rows(['A', 'B'], [[10], [0]], ['A'], [[10]], ['s'])

    def test_declared_technical_rows_are_separately_accounted(self):
        rows, _ = compare_rows(['A', '__no_feature'], [[10], [7]], ['A'], [[10]], ['s'], {'__no_feature'})
        self.assertEqual(rows[0]['source_library_size'], 17)
        self.assertEqual(rows[0]['excluded_count_sum'], 7)
        self.assertEqual(rows[0]['status'], 'pass')

    def test_missing_declared_exclusion_is_an_error(self):
        with self.assertRaises(ValueError):
            compare_rows(['A', 'B'], [[10], [0]], ['A'], [[10]], ['s'], {'other'})

    def test_unique_feature_reordering_is_supported(self):
        rows, _ = compare_rows(['A', 'B'], [[10], [20]], ['B', 'A'], [[20], [10]], ['s'])
        self.assertEqual(rows[0]['status'], 'pass')

    def test_duplicate_feature_reordering_is_ambiguous(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            compare_rows(['A', 'A', 'B'], [[1], [2], [3]], ['B', 'A', 'A'], [[3], [1], [2]], ['s'])

    def test_duplicate_ids_only_pass_with_complete_sequence_and_values(self):
        rows, _ = compare_rows(['A', 'A'], [[1], [2]], ['A', 'A'], [[1], [2]], ['s'])
        self.assertEqual(rows[0]['status'], 'pass')

    def test_rounding_is_not_implicitly_accepted(self):
        rows, _ = compare_rows(['A'], [[10.5]], ['A'], [[10]], ['s'])
        self.assertEqual(rows[0]['status'], 'review')

    def test_complete_unique_key_equality_can_ignore_row_collation(self):
        rows, _ = compare_unique_rows(['A', 'b', 'C'], [[1], [2], [3]], ['A', 'C', 'b'], [[1], [3], [2]], ['s'])
        self.assertEqual(rows[0]['status'], 'pass')
        self.assertEqual(rows[0]['mismatching_retained_cells'], 0)

    def test_keyed_equality_cannot_hide_duplicate_or_missing_zero_genes(self):
        for source, values, output, counts in [
                (['A', 'A'], [[1], [2]], ['A', 'A'], [[1], [2]]),
                (['A', 'B'], [[1], [0]], ['A'], [[1]]),
                (['A', 'B'], [[1], [2]], ['A', 'A'], [[1], [2]]),
                (['A', ''], [[1], [2]], ['A', ''], [[1], [2]])]:
            with self.subTest(source=source, output=output), self.assertRaises(ValueError):
                compare_unique_rows(source, values, output, counts, ['s'])

    def test_row_collation_does_not_excuse_balanced_changed_values(self):
        rows, _ = compare_unique_rows(['A', 'b', 'C'], [[1], [2], [3]], ['A', 'C', 'b'], [[2], [2], [2]], ['s'])
        self.assertEqual(rows[0]['count_conservation_delta'], 0)
        self.assertEqual(rows[0]['mismatching_retained_cells'], 2)
        self.assertEqual(rows[0]['status'], 'review')

    def test_duplicate_sample_headers_cannot_be_selected_silently(self):
        with self.assertRaisesRegex(ValueError, '2 matches'):
            index(['gene', 's', 's'], 's')

    def test_invalid_count_values_rejected(self):
        for val in ['NA', 'NaN', 'Inf', '-1']:
            with self.subTest(val=val), self.assertRaises(ValueError):
                value(val)

    def test_runtime_portability_does_not_relax_scientific_evidence(self):
        original = {'script': {'sha256': 'original-script'}, 'records': [{
            'specification': {'rounding': 'R-round-digits0-ties-to-even'},
            'roundingRuntime': 'R version 4.4.1 (2024-06-14 ucrt)\nround(x), digits=0; IEEE 60559 nearest with ties to even',
            'pins': [{'sha256': 'original-source'}], 'samples': [{'output_library_size': 17}]}]}
        current = copy.deepcopy(original)
        current['records'][0]['roundingRuntime'] = 'R version 4.5.1 (2025-06-13)\nround(x), digits=0; IEEE 60559 nearest with ties to even'
        self.assertTrue(evidence_matches(original, current))
        changed = copy.deepcopy(current)
        changed['records'][0]['samples'][0]['output_library_size'] = 18
        self.assertFalse(evidence_matches(original, changed))
        changed = copy.deepcopy(current)
        changed['records'][0]['pins'][0]['sha256'] = 'different-source'
        self.assertFalse(evidence_matches(original, changed))
        changed = copy.deepcopy(current)
        changed['script']['sha256'] = 'different-script'
        self.assertFalse(evidence_matches(original, changed))
        changed = copy.deepcopy(current)
        changed['records'][0]['roundingRuntime'] = 'unknown runtime'
        self.assertFalse(evidence_matches(original, changed))


if __name__ == '__main__':
    unittest.main()
