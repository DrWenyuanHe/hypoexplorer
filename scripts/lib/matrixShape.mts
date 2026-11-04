/**
 * The one check that catches a row-names shift before it becomes a bundle.
 *
 * R's `write.table` with default `row.names = TRUE` and `col.names = TRUE`
 * writes N header fields over N+1 data fields — the row-name column gets no
 * header. `read.delim` and `data.table::fread` both absorb that leading column
 * silently, which is why the DE table and the SE sidecar come out CORRECT while
 * the bundle built from the same matrix is shifted by one.
 *
 * Every matrix parser in scripts/ indexes columns by the header's field order,
 * so a shift misattributes every sample's values to its neighbour. Nothing
 * downstream notices: `+row[colIdx[s]] || 0` turns each out-of-range read into a
 * plausible 0, and the existing "sample X is not a matrix column" check reads
 * the HEADER, which a row-names shift leaves perfectly intact.
 *
 * GSE234483 hit this on 2026-08-29 and was loud only by luck — the id column
 * shifted, the symbol join emptied, and the bundle built with 0 genes. A
 * values-only shift leaves the gene list full-size and the DE stats untouched:
 * a wrong bundle with no symptom at all.
 *
 * FIRST DATA ROW ONLY. A ragged final row is a different (and tolerated) thing —
 * GSE135639_Newborn.txt.gz is in use and legitimately ends short — while a
 * row-names shift is uniform from the first row down.
 */
export function assertRectangular(
  label: string,
  header: readonly string[],
  firstDataRow: readonly string[] | undefined,
): void {
  if (!firstDataRow) return;   // header-only file: nothing to compare against
  if (firstDataRow.length === header.length) return;
  const extra = firstDataRow.length - header.length;
  throw new Error(
    `${label}: matrix is not rectangular — ${header.length} header field(s) over `
    + `${firstDataRow.length} field(s) in the first data row`
    + (extra === 1
      ? '.\n  One extra data field is the signature of R row names written without a '
        + 'header (write.table(..., row.names = TRUE)). Every column would be read '
        + 'one to the left, silently.\n  Fix the matrix (re-export with '
        + 'row.names = FALSE, or add the missing header field) rather than the parser.'
      : '.\n  Header and data disagree on the column count; the parser indexes by '
        + 'position, so it cannot read this file correctly.'),
  );
}
