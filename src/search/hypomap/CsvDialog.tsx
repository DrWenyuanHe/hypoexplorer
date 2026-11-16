import { useEffect, useRef } from 'react';
import { writeCsv } from '../../utils/csv';
import { exportFilename } from '../../utils/exportAction';

export type Csv = { title: string; headers: string[]; rows: (string | number | null)[][] };

export function CsvDialog({ csv, onClose }: { csv: Csv; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  // The bytes, the filename sanitizer and the hand-off belong to the CSV and
  // export-action seams.
  const download = () => writeCsv(exportFilename([csv.title], 'csv'), csv.headers, csv.rows);
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
