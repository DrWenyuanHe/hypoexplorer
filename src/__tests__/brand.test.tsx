import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrandLink } from '../common/BrandLink';
import { PageShell } from '../common/PageShell';
import { renderSeoRoute } from '../../scripts/lib/seoPages.mjs';

describe('brand navigation', () => {
  it('returns home through the router without reloading a report', () => {
    const onHome = vi.fn();
    render(<PageShell onHome={onHome} breadcrumbs={[{ label: 'Report', current: true }]}>Report content</PageShell>);
    const link = screen.getByRole('link', { name: 'HypoExplorer home' });
    expect(link).toHaveAttribute('href', '/#/');
    expect(fireEvent.click(link)).toBe(false);
    expect(onHome).toHaveBeenCalledOnce();
  });

  it.each(['ctrlKey', 'metaKey', 'shiftKey', 'altKey'])('preserves native link behavior for %s', (modifier) => {
    const onHome = vi.fn();
    render(<BrandLink onHome={onHome} />);
    const link = screen.getByRole('link', { name: 'HypoExplorer home' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, [modifier]: true });
    // Observe after React's delegated handler, then prevent jsdom navigation.
    let intercepted = true;
    const observe = (click: MouseEvent) => { intercepted = click.defaultPrevented; click.preventDefault(); };
    document.addEventListener('click', observe, { once: true });
    fireEvent(link, event);
    expect(intercepted).toBe(false);
    expect(onHome).not.toHaveBeenCalled();
  });

  it.each(['/studies/', '/topics/', '/methods/', '/how-to-cite/', '/about/'])('uses the same logo, home target and icons on %s', (path) => {
    const result = renderSeoRoute(path);
    expect(result).not.toBeNull();
    const page = new DOMParser().parseFromString(result!.body, 'text/html');
    const home = page.querySelector('header .site-brand');
    expect(home?.getAttribute('href')).toBe('/#/');
    expect(home?.getAttribute('aria-label')).toBe('HypoExplorer home');
    expect(home?.querySelector('img')?.getAttribute('src')).toBe('/brand/v1/hypoexplorer-logo.png');
    expect(page.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe('/brand/v1/apple-touch-icon.png');
    expect(page.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest.webmanifest');
  });
});
