import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as validationData from '../data/authorValidation';
import { VERIFICATION_CLAIMS, type AuthorVerification } from '../data/authorVerification';
import { TrackerFilters } from '../dataset-tracker/TrackerFilters';
import { filterAndSort, trackerValidationKey, type TrackerFilterState } from '../dataset-tracker/trackerLogic';
import type { TrackerRow } from '../types';
import { TrackerDetail } from '../dataset-tracker/TrackerDetail';
import * as internalQcData from '../data/internalQc';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const filters: TrackerFilterState = {
  q: '', status: 'all', feas: 'all', nok: 'all', mod: 'all', sp: 'all',
  tag: 'all', integ: 'all', validation: 'all', availability: 'all',
};
const sort = { key: 'validation', dir: 1 };

function evidenceRows() {
  const base = validationData.requireAuthorValidation('mouse_arc_hfd_gse225038');
  const cases: Array<[string, AuthorVerification['state'], AuthorVerification['evidenceLevel']]> = [
    ['source', 'partial', 'source_only'], ['reconstructed', 'partial', 'reconstructed'],
    ['direct', 'partial', 'author_results'], ['none', 'partial', 'none'],
    ['unresolved', 'unresolved', 'author_results'], ['pending', 'in_progress', 'author_results'],
  ];
  const records = new Map(cases.map(([datasetId, state, evidenceLevel]) => [datasetId, {
    ...base, datasetId, verification: { ...base.verification, state, evidenceLevel },
  }]));
  vi.spyOn(validationData, 'getAuthorValidation').mockImplementation((id) => records.get(id));
  return cases.map(([id]) => ({
    acc: id, title: id, integrated: true,
    match: { id, tier: 'dataset', name: id },
  }) as TrackerRow);
}

describe('tracker verification evidence claims', () => {
  it('offers concrete claim labels without a vague partial option', () => {
    render(<TrackerFilters f={filters} setF={vi.fn()} tags={[]} view="table" setView={vi.fn()} canEdit={false} save="" />);
    fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
    const select = screen.getByRole('combobox', { name: 'Detailed author review' });
    for (const [key, claim] of Object.entries(VERIFICATION_CLAIMS)) {
      expect(within(select).getByRole('option', { name: claim.label })).toHaveAttribute('value', key);
    }
    expect(select.querySelector('option[value="partial"]')).toBeNull();
  });

  it('separates partial evidence claims and preserves unresolved priority', () => {
    const rows = evidenceRows();
    expect(rows.map(trackerValidationKey)).toEqual([
      'source_only', 'reconstructed', 'author_results', 'no_evidence', 'unresolved', 'in_progress',
    ]);
    expect(filterAndSort(rows, {}, { ...filters, validation: 'author_results' }, sort).map((r) => r.acc)).toEqual(['direct']);
    expect(filterAndSort(rows, {}, { ...filters, validation: 'source_only' }, sort).map((r) => r.acc)).toEqual(['source']);
    expect(filterAndSort(rows, {}, { ...filters, q: 'Author results untested' }, sort).map((r) => r.acc)).toEqual(['source']);
    expect(filterAndSort(rows, {}, { ...filters, q: 'Author results compared, limits remain' }, sort).map((r) => r.acc)).toEqual(['direct']);
  });

  it('filters and searches by author follow-up', () => {
    const rows = evidenceRows();
    const lookup = validationData.getAuthorValidation;
    const direct = lookup('direct')!;
    vi.spyOn(validationData, 'getAuthorValidation').mockImplementation((id) => id === 'direct'
      ? { ...direct, verification: { ...direct.verification, followUp: 'author_contact' } }
      : { ...direct, datasetId: id });
    expect(filterAndSort(rows, {}, { ...filters, followUp: 'author_contact' }, sort).map((r) => r.acc)).toEqual(['direct']);
    expect(filterAndSort(rows, {}, { ...filters, q: 'needs author clarification' }, sort).map((r) => r.acc)).toEqual(['direct']);
    expect(filterAndSort(rows, {}, { ...filters, followUp: 'all' }, sort)).toHaveLength(rows.length);
  });

  it('offers the follow-up filter only while some record carries one', () => {
    const { verification } = validationData.AUTHOR_VALIDATION_REPORT.records[0];
    const saved = validationData.AUTHOR_VALIDATION_REPORT.records.map((record) => record.verification.followUp);
    const open = () => {
      render(<TrackerFilters f={filters} setF={vi.fn()} tags={[]} view="table" setView={vi.fn()} canEdit={false} save="" />);
      fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
      return screen.queryByRole('combobox', { name: 'Author follow-up' });
    };
    try {
      for (const record of validationData.AUTHOR_VALIDATION_REPORT.records) delete record.verification.followUp;
      expect(open()).toBeNull();
      cleanup();
      verification.followUp = 'author_contact';
      expect(within(open()!).getByRole('option', { name: 'Needs author clarification' })).toHaveAttribute('value', 'author_contact');
    } finally {
      validationData.AUTHOR_VALIDATION_REPORT.records.forEach((record, i) => {
        if (saved[i]) record.verification.followUp = saved[i];
        else delete record.verification.followUp;
      });
    }
  });

  it('retains a saved legacy filter without treating it as a new evidence claim', () => {
    const rows = evidenceRows();
    expect(filterAndSort(rows, {}, { ...filters, validation: 'partial' }, sort).map((r) => r.acc))
      .toEqual(['direct', 'reconstructed', 'source', 'none']);
    // A saved filter behind "More filters" opens the panel so it stays visible.
    render(<TrackerFilters f={{ ...filters, validation: 'partial' }} setF={vi.fn()} tags={[]} view="table" setView={vi.fn()} canEdit={false} save="" />);
    expect(screen.getByRole('button', { name: /More filters/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('combobox', { name: 'Detailed author review' })).toHaveValue('partial');
    expect(screen.getByRole('option', { name: 'Combined evidence group, saved filter' })).toHaveValue('partial');
  });

  it('does not assign an evidence claim to candidates outside the Explorer', () => {
    const row = { acc: 'candidate', integrated: false } as TrackerRow;
    expect(trackerValidationKey(row)).toBe('not_in_explorer');
    expect(filterAndSort([row], {}, { ...filters, validation: 'not_in_explorer' }, sort)).toEqual([row]);
  });

  it.each(['review', 'not_assessed', 'fail'] as const)('keeps recorded intake claims historical beside current replication %s', status => {
    const id = 'cattle_arc_nutrition_gse153498';
    const current = internalQcData.getInternalQc(id)!;
    const replication = current.checks.find(check => check.id === 'independent_replication')!;
    const note = status === 'review' ? replication.note : `Current replication ${status}: experimental units remain unresolved.`;
    vi.spyOn(internalQcData, 'getInternalQc').mockReturnValue({...current, status,
      checks: current.checks.map(check => check.id === 'independent_replication' ? {...check, status, note} : check)});
    const row: TrackerRow = {
      acc: 'GSE153498', title: 'Cattle arcuate nutrition', integrated: true, links: {},
      match: {id, name: 'Cattle arcuate nutrition', tier: 'dataset', via: 'GSE153498'},
      feas: {blockers: 'None for feasibility'},
      nadeq: {min: 14, perGroup: '14 vs 15 independent heifer calves'},
    };
    const before = JSON.stringify(row);
    render(<TrackerDetail row={row} entry={{}} status="reviewed" canEdit={false}
      onSetStatus={vi.fn()} onSetNote={vi.fn()} onOpenInExplorer={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Recorded intake feasibility & sample counts')).toBeInTheDocument();
    expect(screen.getByText('Recorded intake blockers')).toBeInTheDocument();
    expect(screen.getByText('None for feasibility')).toBeInTheDocument();
    expect(screen.getByText(/Use the Experimental design assessment above/)).toBeInTheDocument();
    const currentNote = screen.getByRole('note', {name: 'Current biological replication assessment'});
    expect(currentNote).toHaveTextContent(note);
    expect(currentNote).not.toHaveTextContent('independent heifer calves');
    expect(JSON.stringify(row)).toBe(before);
  });

  it('does not attach a related publication’s replication review to an unintegrated candidate', () => {
    const row: TrackerRow = {acc: 'candidate', title: 'Related candidate', integrated: false, related: true, links: {},
      match: {id: 'cattle_arc_nutrition_gse153498', name: 'Cattle arcuate nutrition', tier: 'publication', via: 'publication'}};
    render(<TrackerDetail row={row} entry={{}} status="new" canEdit={false}
      onSetStatus={vi.fn()} onSetNote={vi.fn()} onOpenInExplorer={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('note', {name: 'Current biological replication assessment'})).toBeNull();
    expect(screen.getByText(/Recorded sample counts do not establish biological independence/)).toBeInTheDocument();
  });
});
