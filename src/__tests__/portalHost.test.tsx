import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../common/Modal';
import { HelpTip } from '../common/HelpTip';
import { portalHost } from '../common/portalHost';

// A modal dialog is in the top layer and makes the page outside it inert, so a
// popup portaled to document.body from inside one would be painted under the
// dialog and could not be clicked or focused. Popups portal into the dialog
// their anchor sits in instead, and into document.body everywhere else.

describe('portalHost', () => {
  it('is the enclosing dialog, else document.body', () => {
    const dialog = document.createElement('dialog');
    const inside = document.createElement('button');
    const outside = document.createElement('button');
    dialog.append(inside);
    document.body.append(dialog, outside);
    try {
      expect(portalHost(inside)).toBe(dialog);
      expect(portalHost(outside)).toBe(document.body);
      expect(portalHost(null)).toBe(document.body);
    } finally {
      dialog.remove();
      outside.remove();
    }
  });
});

describe('a popup opened inside a Modal', () => {
  it('renders inside the dialog, not under it', () => {
    render(
      <Modal onClose={() => {}} title="Record">
        <HelpTip label="About this record"><p>Explanation</p></HelpTip>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'About this record' }));
    const tip = screen.getByRole('tooltip');
    expect(screen.getByRole('dialog', { name: 'Record' }).contains(tip)).toBe(true);
  });

  it('still renders into document.body on the page', () => {
    render(<HelpTip label="About this page"><p>Explanation</p></HelpTip>);
    fireEvent.click(screen.getByRole('button', { name: 'About this page' }));
    expect(screen.getByRole('tooltip').parentElement).toBe(document.body);
  });
});
