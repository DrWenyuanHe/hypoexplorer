import { useEffect, useMemo, useRef, useState } from 'react';

// Standalone triage tracker (dev tool). Catalog rows come from the dev /api/catalog
// endpoint as untyped JSON, so rows are typed loosely as Record<string, any>.
// biome-ignore lint/suspicious/noExplicitAny: fetched untyped catalog rows
type Row = Record<string, any>;
type FilterState = {
  status: string; feas: string; nok: string; mod: string; sp: string; tag: string; integ: string; q: string;
};
type Sort = { key: string; dir: number };

const STATUSES = [
  { key: 'new', label: 'New', cls: 'new' },
  { key: 'reviewed', label: 'Reviewed', cls: 'reviewed' },
  { key: 'pipeline', label: 'In pipeline', cls: 'pipeline' },
  { key: 'added', label: 'Added', cls: 'added' },
  { key: 'rejected', label: 'Rejected', cls: 'rejected' },
];
const STATUS_KEYS = STATUSES.map((s) => s.key);

function speciesGroup(sp?: string): string {
  const s = (sp || '').toLowerCase();
  if (s.includes('homo') || s.includes('human')) return 'Human';
  if (/macaca|callithrix|papio|marmoset|baboon|rhesus|cynomolgus|primate/.test(s)) return 'Primate';
  if (/mus |mouse/.test(s)) return 'Mouse';
  if (/rattus|\brat\b/.test(s)) return 'Rat';
  if (/ovis|sheep|capra|goat|bos|cattle|bovine|sus|pig|porcine|gallus|chick|duck|goose|quail|equus|horse/.test(s)) return 'Livestock/bird';
  return 'Other';
}
function modGroup(m?: string): string {
  const s = (m || '').toLowerCase();
  if (/mirna|small-rna|small rna|microrna|non-coding/.test(s)) return 'miRNA';
  if (/spatial|visium|xenium|stereo-seq|merfish|slide-seq/.test(s)) return 'Spatial';
  if (/snrna|single-nucleus|single nucleus|scrna|single-cell|single cell|drop-seq|dronc|10x|chromium/.test(s)) return 'Single-cell';
  if (/trap|ribosome|bactrap|nutrap|ribotag/.test(s)) return 'TRAP/sorted';
  if (/microarray|\barray\b/.test(s)) return 'Microarray';
  if (/bulk|expression profiling by high/.test(s)) return 'Bulk';
  return 'Other';
}
const FEAS: Record<string, { label: string; cls: string; rank: number }> = {
  'drop-in': { label: 'Existing pipeline', cls: 'fz-drop', rank: 0 },
  'modified-pipeline': { label: 'Pipeline changes', cls: 'fz-mod', rank: 1 },
  'heavy-lift': { label: 'Major rework', cls: 'fz-heavy', rank: 2 },
  blocked: { label: 'Blocked', cls: 'fz-block', rank: 3 },
};
function feasMeta(r: Row) { const t = r.feas && r.feas.tier; return FEAS[t] || { label: '—', cls: 'fz-na', rank: 4 }; }
function nState(r: Row): { s: string; min: number | null } { if (!r.nadeq || r.nadeq.min == null) return { s: 'unknown', min: null }; return { s: r.nadeq.min < 3 ? 'excluded' : 'ok', min: r.nadeq.min }; }
function firstN(n?: string | number): string { const m = String(n || '').match(/\d[\d,]*/); return m ? m[0] : '—'; }

function linkChips(r: Row): Array<[string, string]> {
  const L = r.links || {};
  const out: Array<[string, string]> = [];
  if (r.repoUrl) out.push(['Repository', r.repoUrl]);
  if (L.doi) out.push(['DOI', `https://doi.org/${L.doi}`]);
  if (L.pmid) out.push(['PubMed', `https://pubmed.ncbi.nlm.nih.gov/${L.pmid}/`]);
  if (L.pmc) out.push(['PMC', `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${L.pmc}/`]);
  if (L.bioproject) out.push([L.bioproject, `https://www.ncbi.nlm.nih.gov/bioproject/${L.bioproject}`]);
  if (L.sra) out.push([L.sra, `https://www.ncbi.nlm.nih.gov/sra/?term=${L.sra}`]);
  if (L.cellxgene) out.push(['CELLxGENE', `https://cellxgene.cziscience.com/collections/${L.cellxgene}`]);
  if (r.evidenceUrl && r.evidenceUrl !== r.repoUrl) out.push(['Verified ✓', r.evidenceUrl]);
  return out;
}

export default function App() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [explorer, setExplorer] = useState<Row[]>([]);
  const [showExplorer, setShowExplorer] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, Row>>({});
  const [loadErr, setLoadErr] = useState('');
  const [view, setView] = useState('table');
  const [selected, setSelected] = useState<string | null>(null);
  const [save, setSave] = useState('');
  const [sort, setSort] = useState<Sort>({ key: 'feas', dir: 1 });
  const [f, setF] = useState<FilterState>({ status: 'all', feas: 'all', nok: 'all', mod: 'all', sp: 'all', tag: 'all', integ: 'all', q: '' });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/catalog').then((r) => r.json()),
      fetch('/api/statuses').then((r) => r.json()),
    ]).then(([cat, st]) => { setRows(cat.rows || []); setExplorer(cat.explorer || []); setStatuses(st || {}); })
      .catch((e) => setLoadErr(String(e)));
  }, []);

  function persist(next: Record<string, Row>) {
    setSave('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch('/api/statuses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
        .then((r) => { if (!r.ok) throw new Error('save failed'); setSave('saved'); setTimeout(() => setSave(''), 1500); })
        .catch(() => setSave('error'));
    }, 250);
  }
  function setStatus(acc: string, status: string) {
    setStatuses((prev) => { const next = { ...prev, [acc]: { ...(prev[acc] || {}), status, updated: new Date().toISOString() } }; persist(next); return next; });
  }
  function setNote(acc: string, note: string) {
    setStatuses((prev) => { const next = { ...prev, [acc]: { ...(prev[acc] || {}), note, updated: new Date().toISOString() } }; persist(next); return next; });
  }
  const statusOf = (acc: string): string => (statuses[acc] && statuses[acc].status) || 'new';

  const tags = useMemo(() => Array.from(new Set((rows || []).map((r) => r.searchTag || `pass${r.pass}`))).sort(), [rows]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, inExplorer: 0, related: 0 }; STATUS_KEYS.forEach((k) => (c[k] = 0));
    (rows || []).forEach((r) => { c.all++; c[statusOf(r.acc)]++; if (r.integrated) c.inExplorer++; if (r.related) c.related++; });
    return c;
  }, [rows, statuses]);

  // Drift: a candidate marked "added" but NOT actually in the explorer registry,
  // or one that IS in the explorer but isn't marked added. Surfaced as a hint.
  const driftAddedNotInExplorer = useMemo(
    () => (rows || []).filter((r) => statusOf(r.acc) === 'added' && !r.integrated).map((r) => r.acc),
    [rows, statuses],
  );

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = f.q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (f.status !== 'all' && statusOf(r.acc) !== f.status) return false;
      if (f.feas !== 'all' && (r.feas && r.feas.tier ? r.feas.tier : 'not-surveyed') !== f.feas) return false;
      if (f.nok !== 'all' && nState(r).s !== f.nok) return false;
      if (f.mod !== 'all' && modGroup(r.modality) !== f.mod) return false;
      if (f.sp !== 'all' && speciesGroup(r.species) !== f.sp) return false;
      if (f.tag !== 'all' && (r.searchTag || `pass${r.pass}`) !== f.tag) return false;
      if (f.integ === 'yes' && !r.integrated) return false;
      if (f.integ === 'related' && !r.related) return false;
      if (f.integ === 'no' && (r.integrated || r.related)) return false;
      if (q && !(`${r.acc} ${r.title} ${r.species} ${r.region} ${r.phenotype} ${r.method || ''}`).toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = sort.dir;
    const keyFns: Record<string, (r: Row) => string | number> = {
      acc: (r) => r.acc.toLowerCase(), sp: (r) => speciesGroup(r.species), reg: (r) => r.region, mod: (r) => modGroup(r.modality),
      n: (r) => parseInt(firstN(r.n).replace(/,/g, ''), 10) || 0, feas: (r) => feasMeta(r).rank, nok: (r) => (nState(r).min ?? -1),
      fit: (r) => (r.score ? r.score.fit : -1), status: (r) => STATUS_KEYS.indexOf(statusOf(r.acc)),
    };
    const acc = keyFns[sort.key] || ((r: Row) => r.acc);
    out = [...out].sort((a, b) => { const av = acc(a), bv = acc(b); if (av < bv) return -1 * dir; if (av > bv) return 1 * dir; return 0; });
    return out;
  }, [rows, statuses, f, sort]);

  if (loadErr) return <div className="loading">The dataset catalog could not be loaded. {loadErr}<br />Start the local server with <code>npm run dev</code>, then reload this page.</div>;
  if (!rows) return <div className="loading">Loading dataset catalog…</div>;

  const sortBtn = (key: string, label: string) => (
    <th onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))}>{label}{sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>
  );

  function exportStatuses() {
    const blob = new Blob([JSON.stringify(statuses, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'statuses-backup.json'; a.click();
  }

  return (
    <div>
      <header className="top">
        <div className="title-row">
          <h1>Hypothalamus dataset tracker</h1>
          <span className="sub">Review and track integration of {rows.length} candidate datasets</span>
          <div className="viewtoggle">
            <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>Table</button>
            <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Board</button>
          </div>
        </div>
        <div className="summary">
          <div className={`scard${f.status === 'all' ? ' on' : ''}`} onClick={() => setF({ ...f, status: 'all' })}>
            <span className="dot all" /><span className="num">{counts.all}</span><span className="lab">All</span>
          </div>
          {STATUSES.map((s) => (
            <div key={s.key} className={`scard${f.status === s.key ? ' on' : ''}`} onClick={() => setF({ ...f, status: f.status === s.key ? 'all' : s.key })}>
              <span className={`dot ${s.cls}`} /><span className="num">{counts[s.key]}</span><span className="lab">{s.label}</span>
            </div>
          ))}
          <div className={`scard integ-card${f.integ === 'yes' ? ' on' : ''}`} title="Show candidates already in HypoExplorer" onClick={() => setF({ ...f, integ: f.integ === 'yes' ? 'all' : 'yes' })}>
            <span className="dot integ" /><span className="num">{counts.inExplorer}</span><span className="lab">In explorer</span>
          </div>
          <button className="btn explorer-toggle" onClick={() => setShowExplorer((v) => !v)} title="Show the datasets currently live in HypoExplorer">
            {explorer.length} explorer datasets {showExplorer ? '▲' : '▼'}
          </button>
        </div>

        {showExplorer && (
          <div className="explorer-ref">
            <div className="erhead">Datasets in HypoExplorer</div>
            <div className="ergrid">
              {explorer.map((d) => (
                <div className="ercard" key={d.id}>
                  <div className="erid">{d.id}{d.geo ? <span className="eracc">{d.geo}</span> : null}</div>
                  <div className="ername">{d.name}</div>
                  <div className="ermeta">{d.organism} · {d.modality}</div>
                  <div className="erkeys">{(d.accessions && d.accessions.length ? d.accessions : [d.doi].filter(Boolean)).join(' · ') || '—'}</div>
                </div>
              ))}
            </div>
            <div className="sub2" style={{ marginTop: 8 }}>
              {counts.inExplorer === 0
                ? `None of the ${rows ? rows.length : 0} candidates below matches an explorer dataset by accession or BioProject.`
                : `${counts.inExplorer} candidates below are already in the explorer. Use the "In explorer" filter to see them.`}
              {counts.related > 0 ? ` ${counts.related} share a publication with an explorer dataset. The "same paper" label marks these as likely different series.` : ''}
              {' Reload after adding a dataset to the explorer registry to update its integration status.'}
            </div>
          </div>
        )}
        <div className="filters">
          <input type="search" placeholder="Search accession, title, species or phenotype…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          <span className="lbl">Feasibility</span>
          <select value={f.feas} onChange={(e) => setF({ ...f, feas: e.target.value })}>
            <option value="all">all</option><option value="drop-in">Existing pipeline</option><option value="modified-pipeline">Pipeline changes</option><option value="heavy-lift">Major rework</option><option value="blocked">Blocked</option><option value="not-surveyed">Not surveyed</option>
          </select>
          <span className="lbl">n≥3</span>
          <select value={f.nok} onChange={(e) => setF({ ...f, nok: e.target.value })}>
            <option value="all">All sample counts</option><option value="ok">Pass</option><option value="excluded">n&lt;3</option><option value="unknown">Unknown</option>
          </select>
          <span className="lbl">Modality</span>
          <select value={f.mod} onChange={(e) => setF({ ...f, mod: e.target.value })}>
            <option value="all">all</option>{['Bulk', 'Single-cell', 'miRNA', 'Spatial', 'TRAP/sorted', 'Microarray', 'Other'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <span className="lbl">Species</span>
          <select value={f.sp} onChange={(e) => setF({ ...f, sp: e.target.value })}>
            <option value="all">all</option>{['Human', 'Primate', 'Mouse', 'Rat', 'Livestock/bird', 'Other'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <span className="lbl">Search round</span>
          <select value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })}>
            <option value="all">all</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="lbl">In explorer</span>
          <select value={f.integ} onChange={(e) => setF({ ...f, integ: e.target.value })}>
            <option value="all">all</option><option value="yes">Integrated</option><option value="related">Same paper</option><option value="no">Not yet</option>
          </select>
          <span className="spacer" />
          <span className={`savestate ${save}`}>{save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : save === 'error' ? 'Could not save changes' : ''}</span>
          <button className="btn" onClick={exportStatuses}>Export backup</button>
        </div>
      </header>

      <main>
        {driftAddedNotInExplorer.length > 0 && (
          <div className="driftbar" onClick={() => setF({ ...f, status: 'added', integ: 'no' })} title="Show datasets marked Added that are missing from the explorer">
            {driftAddedNotInExplorer.length} datasets marked &quot;Added&quot; are missing from HypoExplorer. Finish integrating them or update their status.
          </div>
        )}
        <div style={{ color: 'var(--mut)', fontSize: 12.5, margin: '0 0 10px' }}>{filtered.length} shown{f.status !== 'all' || f.feas !== 'all' || f.nok !== 'all' || f.mod !== 'all' || f.sp !== 'all' || f.tag !== 'all' || f.integ !== 'all' || f.q ? ' (filtered)' : ''}</div>
        {view === 'table' ? (
          <div className="tablewrap">
            <table>
              <thead><tr>
                {sortBtn('acc', 'Accession')}{sortBtn('sp', 'Species')}{sortBtn('reg', 'Region')}{sortBtn('mod', 'Modality')}
                {sortBtn('n', 'n')}{sortBtn('feas', 'Feasibility')}{sortBtn('nok', 'n≥3')}{sortBtn('fit', 'Fit score')}{sortBtn('status', 'Status')}
              </tr></thead>
              <tbody>
                {filtered.map((r) => {
                  const ns = nState(r), fm = feasMeta(r), st = statusOf(r.acc);
                  return (
                    <tr key={r.acc} className={`row${selected === r.acc ? ' sel' : ''}${ns.s === 'excluded' ? ' exrow' : ''}`} onClick={() => setSelected(r.acc)}>
                      <td className="acc">{r.repoUrl ? <a href={r.repoUrl} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>{r.acc}</a> : r.acc}{r.integrated ? <span className="intbadge" title={`In HypoExplorer as ${r.match.id}, matched via ${r.match.via}`}>● in explorer</span> : r.related ? <span className="intbadge rel" title={`Same publication as ${r.match.id}, matched via ${r.match.via}. Likely a different dataset.`}>↔ same paper</span> : null}{r.searchTag ? <div className="sub2">{r.searchTag}</div> : null}</td>
                      <td>{speciesGroup(r.species)}</td>
                      <td title={r.region}>{(r.region || '').split(/[;.(]/)[0].slice(0, 40)}</td>
                      <td><span className="pill">{modGroup(r.modality)}</span></td>
                      <td className="ctr">{firstN(r.n)}</td>
                      <td><span className={`pill ${fm.cls}`} title={r.feas ? r.feas.pipeline : ''}>{fm.label}</span></td>
                      <td className="ctr">{ns.s === 'ok' ? <span className="nok">{ns.min}✓</span> : ns.s === 'excluded' ? <span className="nbad">{ns.min}✗</span> : <span className="nunk">?</span>}</td>
                      <td className="ctr">{r.score ? <span title={r.score.rec}>{r.score.fit}</span> : <span className="sub2">—</span>}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select className={`statussel st-${st}`} value={st} onChange={(e) => setStatus(r.acc, e.target.value)}>
                          {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="board">
            {STATUSES.map((col) => {
              const items = filtered.filter((r) => statusOf(r.acc) === col.key);
              return (
                <div className="col" key={col.key}>
                  <div className="colhead"><span className={`dot ${col.cls}`} />{col.label}<span className="cnt">{items.length}</span></div>
                  <div className="cards">
                    {items.length === 0 ? <div className="empty">No matching candidates</div> : items.map((r) => {
                      const idx = STATUS_KEYS.indexOf(col.key);
                      return (
                        <div className="card" key={r.acc} onClick={() => setSelected(r.acc)}>
                          <div className="cacc">{r.acc}{r.integrated ? <span className="intbadge" title={`In HypoExplorer as ${r.match.id}`}>● in explorer</span> : r.related ? <span className="intbadge rel" title={`Same paper as ${r.match.id}`}>↔ same paper</span> : null}</div>
                          <div className="cmeta">{speciesGroup(r.species)} · {modGroup(r.modality)} · {feasMeta(r).label}{nState(r).s === 'excluded' ? ' · n<3' : ''}</div>
                          <div className="cmove" onClick={(e) => e.stopPropagation()}>
                            {idx > 0 && <button onClick={() => setStatus(r.acc, STATUS_KEYS[idx - 1])} title={`← ${STATUSES[idx - 1].label}`}>←</button>}
                            {idx < STATUS_KEYS.length - 1 && <button onClick={() => setStatus(r.acc, STATUS_KEYS[idx + 1])} title={`${STATUSES[idx + 1].label} →`}>→</button>}
                            <button onClick={() => setStatus(r.acc, 'rejected')} title="Reject" style={{ color: 'var(--rejected)' }}>✗</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {selected && (() => {
        const r = rows.find((x) => x.acc === selected); if (!r) return null;
        const st = statusOf(r.acc), entry = statuses[r.acc] || {}, ns = nState(r);
        return (
          <>
            <div className="overlay" onClick={() => setSelected(null)} />
            <aside className="drawer">
              <div className="dhead">
                <button className="close" onClick={() => setSelected(null)}>×</button>
                <div><span className={`stbadge ${st}`}>{(STATUSES.find((s) => s.key === st) || STATUSES[0]).label}</span>{r.searchTag ? <span className="chip" style={{ marginLeft: 6 }}>{r.searchTag}</span> : null}{r.score ? <span className="chip" style={{ marginLeft: 6 }}>fit {r.score.fit} · {r.score.rec}</span> : null}</div>
                <h2>{r.repoUrl ? <a href={r.repoUrl} target="_blank" rel="noopener">{r.acc}</a> : r.acc}</h2>
                <div className="sub">{r.title}</div>
              </div>
              <div className="dbody">
                {r.integrated ? (
                  <div className="intnote ok">Already in HypoExplorer as <b>{r.match.id}</b>, &quot;{r.match.name}&quot;. <span className="sub2">Matched via {r.match.via}.</span></div>
                ) : r.related ? (
                  <div className="intnote rel">Shares a publication with <b>{r.match.id}</b>, matched via {r.match.via}. This appears to be a different dataset or series and is not currently in the explorer. Review it separately.</div>
                ) : st === 'added' ? (
                  <div className="intnote warn">Marked &quot;Added&quot; but missing from HypoExplorer. Check that it was added to the explorer registry or update its status.</div>
                ) : (
                  <div className="intnote none">Not yet in HypoExplorer. Its integration status will update when it is added to the explorer registry.</div>
                )}
                <div className="sectlabel">Set status</div>
                <div className="statusbtns">
                  {STATUSES.map((s) => <button key={s.key} className={(st === s.key ? `on ${s.cls}` : '')} onClick={() => setStatus(r.acc, s.key)}>{s.label}</button>)}
                </div>
                <div className="sectlabel">Review note</div>
                <textarea className="notearea" placeholder="Your notes on this dataset…" defaultValue={entry.note || ''} key={r.acc} onBlur={(e) => setNote(r.acc, e.target.value)} />
                {entry.updated ? <div className="sub2" style={{ marginTop: 4 }}>last changed {new Date(entry.updated).toLocaleString()}</div> : null}

                <div className="sectlabel">Source links</div>
                <div className="chips">{linkChips(r).map(([lab, url], i) => <a className="chip" key={i} href={url} target="_blank" rel="noopener">{lab}</a>)}</div>

                <div className="sectlabel">Methods</div>
                <table className="metatbl"><tbody>
                  <tr><th>Species</th><td>{r.species}</td></tr>
                  <tr><th>Region</th><td>{r.region}</td></tr>
                  <tr><th>Modality</th><td>{r.modality}</td></tr>
                  {r.platform ? <tr><th>Platform</th><td>{r.platform}</td></tr> : null}
                  <tr><th>Phenotype</th><td>{r.phenotype}</td></tr>
                  <tr><th>Design</th><td>{r.design}</td></tr>
                  <tr><th>Total n</th><td>{r.n}</td></tr>
                </tbody></table>

                <div className="sectlabel">Feasibility &amp; n≥3</div>
                <table className="metatbl"><tbody>
                  <tr><th>Tier</th><td><span className={`pill ${feasMeta(r).cls}`}>{feasMeta(r).label}</span></td></tr>
                  {r.feas ? <>
                    <tr><th>Pipeline</th><td>{r.feas.pipeline}</td></tr>
                    <tr><th>Access</th><td>{r.feas.access}</td></tr>
                    <tr><th>Raw data</th><td>raw {r.feas.raw_present} · matrix {r.feas.processed_matrix} · FASTQ {r.feas.fastq_sra}</td></tr>
                    {r.feas.file_formats ? <tr><th>Files</th><td className="note-prose">{r.feas.file_formats}</td></tr> : null}
                    {r.feas.blockers ? <tr><th>Blockers</th><td className="risk">{r.feas.blockers}</td></tr> : null}
                  </> : null}
                  <tr><th>n≥3 rule</th><td>{ns.s === 'ok' ? <span className="nok">Passes, minimum {ns.min} per group</span> : ns.s === 'excluded' ? <span className="nbad">Excluded, n&lt;3. Minimum {ns.min} per group</span> : <span className="nunk">unknown</span>}{r.nadeq && r.nadeq.perGroup ? `. ${r.nadeq.perGroup}` : ''}</td></tr>
                  {r.nadeq && r.nadeq.contrast ? <tr><th>Contrast</th><td>{r.nadeq.contrast}</td></tr> : null}
                </tbody></table>

                {r.score ? <><div className="sectlabel">Assessment (fit {r.score.fit}/100 · {r.score.rec})</div><div className="note-prose">{r.score.rationale}{r.score.risks ? <><br /><br /><b>Risks:</b> {r.score.risks}</> : null}</div></> : null}

                {r.correctionNotes ? <><div className="sectlabel">Verification log</div><div className="note-prose">{r.correctionNotes}</div></> : null}
              </div>
            </aside>
          </>
        );
      })()}
    </div>
  );
}
