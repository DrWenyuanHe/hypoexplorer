import { useEffect, useRef } from 'react';

export type Csv = { title: string; headers: string[]; rows: (string | number | null)[][] };

export function CsvDialog({ csv, onClose }: { csv: Csv; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  function download() {
    const quote = (field: string | number | null) => `"${String(field ?? '').replace(/"/g, '""')}"`;
    const content = [csv.headers, ...csv.rows].map(row => row.map(quote).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', content, '\r\n'], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${csv.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <dialog ref={dialog} className="hm-dialog" onClose={onClose} aria-labelledby="hm-csv-title">
      <h3 id="hm-csv-title">{csv.title}</h3>
      <div className="hm-table"><table>
        <thead><tr>{csv.headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead>
        <tbody>{csv.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
      </table></div>
      <div className="hm-controls">
        <button className="portal-secondary" type="button" onClick={download}>Download CSV</button>
        <button className="portal-secondary" type="button" onClick={() => dialog.current?.close()}>Close</button>
      </div>
    </dialog>
  );
}
