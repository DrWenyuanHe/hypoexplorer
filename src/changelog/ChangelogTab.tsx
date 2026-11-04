import { CHANGELOG } from './changelog';
import { FONT_HEADING, FONT_MONO, FONT_SANS } from '../styles/constants';

interface ChangelogTabProps {
  onClose: () => void;
}

export function ChangelogTab({ onClose }: ChangelogTabProps) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-app)', padding: '32px 24px' }}>
      <div style={{ maxWidth: 660, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', fontFamily: FONT_HEADING }}>
              Changelog
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Release notes. Features and dataset counts reflect each release date.
            </div>
          </div>
          <button type="button" onClick={onClose}
            style={{ fontSize: 11, padding: '3px 10px', border: '1px solid var(--border)',
              borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer',
              color: 'var(--text-muted)' }}>
            ← Back
          </button>
        </div>

        {/* Entries */}
        {CHANGELOG.map((entry, i) => (
          <div key={`${entry.date} ${entry.title}`} style={{ display: 'flex', gap: 20, marginBottom: 28 }}>
            {/* Date column */}
            <div style={{ flexShrink: 0, width: 96, paddingTop: 2, textAlign: 'right' }}>
              <span style={{ fontSize: 10, fontFamily: FONT_MONO,
                color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
                {entry.date}
              </span>
            </div>

            {/* Divider dot */}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 4,
                background: i === 0 ? '#4C78A8' : 'var(--border)', border: '2px solid var(--border)' }} />
              {i < CHANGELOG.length - 1 && (
                <div style={{ flex: 1, width: 1, background: 'var(--border)', marginTop: 4 }} />
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, paddingBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                fontFamily: FONT_SANS, marginBottom: 8 }}>
                {entry.title}
              </div>
              <ul style={{ margin: 0, padding: '0 0 0 16px', listStyle: 'disc' }}>
                {entry.items.map((item) => (
                  <li key={item} style={{ fontSize: 12, color: 'var(--text-muted)',
                    lineHeight: 1.6, marginBottom: 4, fontFamily: FONT_SANS }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
