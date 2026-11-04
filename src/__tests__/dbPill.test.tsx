import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DbPill } from '../common/DbPill';
import { LP_DB_COLOR } from '../styles/constants';

// DbPill replaced five hand-rolled pathway-database badges, four of which read
// LP_DB_COLOR[db] with no fallback. An unrecognised db therefore rendered
// `background: "undefined22"` and `color: undefined` — an invisible pill. These
// pin the fallback so the bug cannot come back through the shared primitive.

const pillOf = (el: HTMLElement) => el.querySelector('span') as HTMLSpanElement;

describe('DbPill', () => {
  it('colors a known database from LP_DB_COLOR, with a 0x22-alpha wash of the same hue', () => {
    const { container } = render(<DbPill db="HALLMARK" />);
    const span = pillOf(container);
    expect(span.textContent).toBe('HALLMARK');
    expect(span.style.color).toBe('rgb(176, 122, 161)');            // #B07AA1
    expect(span.style.background).toBe('rgba(176, 122, 161, 0.133)'); // #B07AA122
  });

  it('falls back to a visible grey for an unrecognised database', () => {
    const { container } = render(<DbPill db="WIKIPATHWAYS" />);
    const span = pillOf(container);
    // The regression: neither may serialise from `undefined`.
    expect(span.style.color).toBe('rgb(136, 136, 136)');            // #888
    expect(span.style.background).toBe('rgba(136, 136, 136, 0.133)'); // #88888822
    expect(span.getAttribute('style')).not.toMatch(/undefined/);
  });

  it('covers every LP_DB_COLOR key without falling back', () => {
    for (const [db, color] of Object.entries(LP_DB_COLOR)) {
      const { container } = render(<DbPill db={db} />);
      const span = pillOf(container);
      expect(span.getAttribute('style')).not.toMatch(/undefined/);
      // Not the fallback grey — each key resolves to its own hue.
      expect(span.style.color).not.toBe('rgb(136, 136, 136)');
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('takes size and padding from props but never lets callers override the colors', () => {
    const { container } = render(
      <DbPill db="KEGG" fontSize={9} padding="0px 3px" borderRadius={2} style={{ display: 'block' }} />,
    );
    const span = pillOf(container);
    expect(span.style.fontSize).toBe('9px');
    expect(span.style.padding).toBe('0px 3px');
    expect(span.style.borderRadius).toBe('2px');
    expect(span.style.display).toBe('block');
    expect(span.style.color).toBe('rgb(89, 161, 79)'); // #59A14F, not overridden
  });
});
