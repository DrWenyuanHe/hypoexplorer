import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QualityBadge, DatasetQualityBadges } from '../common/QualityBadges';
import type { QualityAssessment } from '../data/qualityChecks';
import { requireAuthorValidation } from '../data/authorValidation';
import { datasetQuality, QUALITY_STATUS } from '../data/datasetQualityR460';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const assessment: QualityAssessment = { status: 'not_assessed', scope: 'Comparison: case_vs_control', policyVersion: 'test-v1', checks: [
  { id: 'values', label: 'Valid values', status: 'pass', note: 'All inspected values are finite.' },
  { id: 'model', label: 'Model validity', status: 'not_assessed', note: 'No model audit has been recorded.' },
] };

describe('quality badge checklist interaction', () => {
  it('shows green checks only for passed evidence on hover, without clipping in its parent', () => {
    const { container } = render(<div style={{ overflow: 'hidden' }}><QualityBadge label="Pipeline QC" assessment={assessment} /></div>);
    const badge = screen.getByRole('button', { name: /Pipeline QC not assessed/ });
    expect(badge).toHaveAttribute('aria-expanded', 'false');
    fireEvent.mouseEnter(badge);
    const panel = screen.getByRole('region', { name: 'Pipeline QC checks' });
    expect(container.contains(panel)).toBe(false);
    expect(panel.querySelector('[data-quality-check="values"]')).toHaveAttribute('data-check-status', 'pass');
    expect(panel.querySelector('[data-quality-check="model"]')).toHaveAttribute('data-check-status', 'not_assessed');
    expect(within(panel).getByText('No model audit has been recorded.')).toBeTruthy();
  });
  it('opens with keyboard focus and dismisses with Escape without reopening', () => {
    render(<QualityBadge label="Pipeline QC" assessment={assessment} />);
    const badge = screen.getByRole('button', { name: /Pipeline QC not assessed/ });
    act(() => badge.focus());
    expect(screen.getByRole('region', { name: 'Pipeline QC checks' })).toBeTruthy();
    fireEvent.keyDown(badge, { key: 'Escape' });
    expect(screen.queryByRole('region')).toBeNull();
    expect(badge).toHaveFocus();
  });
  it('pins on tap, permits moving into the checklist, and closes with its close button', () => {
    vi.useFakeTimers();
    render(<QualityBadge label="Pipeline QC" assessment={assessment} />);
    const badge = screen.getByRole('button', { name: /Pipeline QC not assessed/ });
    fireEvent.click(badge); fireEvent.mouseLeave(badge);
    act(() => vi.advanceTimersByTime(300));
    const panel = screen.getByRole('region', { name: 'Pipeline QC checks' });
    fireEvent.mouseEnter(panel);
    const close = within(panel).getByRole('button', { name: 'Close Pipeline QC checks' });
    act(() => close.focus()); fireEvent.click(close);
    expect(screen.queryByRole('region')).toBeNull(); expect(badge).toHaveFocus();
  });
  it('dismisses the checklist before allowing Escape to reach the enclosing dialog', () => {
    const closeDialog = vi.fn();
    render(<dialog open onKeyDown={(event) => { if (event.key === 'Escape') closeDialog(); }}><QualityBadge label="Pipeline QC" assessment={assessment} /></dialog>);
    const badge = screen.getByRole('button', { name: 'Pipeline QC not assessed' });
    act(() => badge.focus());
    fireEvent.keyDown(badge, { key: 'Escape' });
    expect(screen.queryByRole('region')).toBeNull();
    expect(badge).toHaveFocus();
    expect(closeDialog).not.toHaveBeenCalled();
    fireEvent.keyDown(badge, { key: 'Escape' });
    expect(closeDialog).toHaveBeenCalledTimes(1);
  });
  it('keeps only one checklist open and does not trigger parent row clicks', () => {
    const parentClick = vi.fn();
    render(<table><tbody><tr onClick={parentClick} onKeyDown={parentClick}><td><QualityBadge label="Pipeline QC" assessment={assessment} /><QualityBadge label="Author concordance" assessment={assessment} /></td></tr></tbody></table>);
    fireEvent.click(screen.getByRole('button', { name: /Pipeline QC not assessed/ }));
    fireEvent.mouseEnter(screen.getByRole('button', { name: /Author concordance not assessed/ }));
    expect(screen.queryByRole('region', { name: 'Pipeline QC checks' })).toBeNull();
    expect(screen.getAllByRole('region')).toHaveLength(1); expect(parentClick).not.toHaveBeenCalled();
  });
  it('uses the same assessment and explicit unsupported contrast state as the data layer', () => {
    const record = requireAuthorValidation('mouse_mhypoa_palmitate_gse280030');
    render(<DatasetQualityBadges record={record} contrastId="unsupported" />);
    const quality = datasetQuality(record, 'unsupported');
    expect(screen.getByRole('button', { name: `Pipeline QC ${QUALITY_STATUS[quality.pipelineQc.status].suffix}` })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /passed/ })).toBeNull();
  });
  it('keeps experimental limitations visible beside a pipeline pass', () => {
    render(<DatasetQualityBadges record={requireAuthorValidation('gse262407')} />);
    expect(screen.getByRole('button', { name: 'Pipeline QC passed' })).toBeTruthy();
    const design = screen.getByRole('button', { name: 'Experimental design review needed' });
    fireEvent.mouseEnter(design);
    const panel = screen.getByRole('region', { name: 'Experimental design checks' });
    expect(panel.querySelector('[data-quality-check="independent_replication"]')).toHaveAttribute('data-check-status', 'review');
    expect(within(panel).getByText(/not every aspect of the original experiment/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Author concordance not assessed' })).toBeTruthy();
  });
  it('opens the next badge when tab focus moves between checklists', () => {
    render(<><QualityBadge label="Pipeline QC" assessment={assessment} /><QualityBadge label="Author concordance" assessment={assessment} /></>);
    act(() => screen.getByRole('button', { name: 'Pipeline QC not assessed' }).focus());
    act(() => screen.getByRole('button', { name: 'Author concordance not assessed' }).focus());
    expect(screen.getByRole('region', { name: 'Author concordance checks' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Pipeline QC checks' })).toBeNull();
  });
  it('does not bubble portal close-button activation to a selectable table row', () => {
    const rowKey = vi.fn();
    render(<table><tbody><tr onKeyDown={rowKey}><td><QualityBadge label="Pipeline QC" assessment={assessment} /></td></tr></tbody></table>);
    fireEvent.click(screen.getByRole('button', { name: 'Pipeline QC not assessed' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close Pipeline QC checks' }), { key: 'Enter' });
    expect(rowKey).not.toHaveBeenCalled();
  });
});
