import { useEffect, useRef } from 'react';
import { writeCsv } from '../../utils/csv';
import { atlasExportProvenance, exportName } from '../../utils/exportProvenance';
import type { AtlasTable } from './atlas';

export type Csv = { title: string; headers: string[]; rows: (string | number | null)[][] };

export function CsvDialog({ table, onClose }: { table: AtlasTable; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const { csv } = table;
  // The preview shows the table alone. The download is named and stamped with the atlas
  // release by the export-provenance seam and written by the CSV seam.
  const download = () => writeCsv(exportName(table.subject, [csv.title], 'csv'), csv.headers, csv.rows,
    { provenance: atlasExportProvenance(table.kind, table.subject, table.settings) });
  return (
    <dialog ref={dialog} className="hm-dialog" onClose={onClose} aria-labelledby="hm-csv-title">
      <h3 id="hm-csv-title">{csv.title}</h3>
      <div className="hm-table"><table>
        <thead><tr>{csv.headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead>
        <tbody>{csv.rows.map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a static preview; row position is the identity
          <tr key={i}>{row.map((cell, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: column position is the identity
            <td key={j}>{cell}</td>
          ))}</tr>
        ))}</tbody>
      </table></div>
      <div className="hm-controls">
        <button className="portal-secondary" type="button" onClick={download}>Download CSV</button>
        <button className="portal-secondary" type="button" onClick={() => dialog.current?.close()}>Close</button>
      </div>
    </dialog>
  );
}
