import { useState } from 'react';
import { Modal } from './Modal';
import { btnStyle, FONT_MONO } from '../styles/constants';

/** The address bar is always current; this makes its analysis contract explicit. */
export function ShareAnalysisButton() {
  const [link, setLink] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  return <>
    <button type="button" onClick={() => { setLink(window.location.href); setStatus(''); }}
      style={{ fontSize: 12, padding: '5px 10px', border: '1px solid var(--border-dark)', borderRadius: 6, background: 'var(--bg-panel)', color: 'var(--text-primary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      Share analysis
    </button>
    {link && <Modal title="Share analysis" onClose={() => setLink(null)} width="600px" height="auto">
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6 }}>
      <p style={{ margin: 0 }}>The link restores your study selection, filters and analysis settings using the data available in the recipient&apos;s deployed release.</p>
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>For a fixed scientific record, keep the data export and its provenance alongside this link.</p>
      <label style={{ fontSize: 12, fontWeight: 600 }}>Analysis link
        <input readOnly value={link} onFocus={(event) => event.target.select()}
          style={{ display: 'block', width: '100%', marginTop: 6, padding: 8, fontFamily: FONT_MONO, fontSize: 12, fontWeight: 400, color: 'var(--text-primary)', background: 'var(--bg-panel)', border: '1px solid var(--border-dark)', borderRadius: 4 }} />
      </label>
      <button type="button" style={{ ...btnStyle, padding: '8px 14px', minHeight: 36, fontSize: 12, alignSelf: 'flex-start' }} onClick={async () => {
        try {
          if (!navigator.clipboard) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(link);
          setStatus('Link copied.');
        } catch { setStatus('Select the link above and copy it.'); }
      }}>Copy link</button>
      <p role="status" style={{ margin: 0, minHeight: 20, color: 'var(--text-secondary)' }}>{status}</p>
      </div>
    </Modal>}
  </>;
}
