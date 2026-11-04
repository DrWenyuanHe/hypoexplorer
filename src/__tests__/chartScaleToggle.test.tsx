import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChartScaleToggle } from '../common/ChartScaleToggle';
import {
  CHART_SCALE_STORAGE_KEY, _resetChartScaleStore, getSnapshot, setChartScale,
} from '../common/chartScaleStore';

beforeEach(() => { _resetChartScaleStore(); });

const option = (name: RegExp) => screen.getByRole('button', { name });

describe('ChartScaleToggle', () => {
  it('starts on the deposited scale — the charts’ behaviour before it existed', () => {
    render(<ChartScaleToggle />);
    expect(option(/As deposited/)).toHaveAttribute('aria-pressed', 'true');
    expect(option(/Linear/)).toHaveAttribute('aria-pressed', 'false');
    expect(option(/log₂/)).toHaveAttribute('aria-pressed', 'false');
  });

  it('moves the pick, and persists it across a reload', () => {
    render(<ChartScaleToggle />);
    fireEvent.click(option(/log₂/));
    expect(option(/log₂/)).toHaveAttribute('aria-pressed', 'true');
    expect(option(/As deposited/)).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem(CHART_SCALE_STORAGE_KEY)).toBe('log2');
  });

  it('two toggles on one screen show one pick, not two', () => {
    // The grids stack (a compare view above its summary, a pathway beside its
    // leading edge), so more than one control can be mounted at once. They read
    // the same store, so clicking either moves both.
    const { container } = render(<><ChartScaleToggle /><ChartScaleToggle /></>);
    const linear = [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Linear');
    expect(linear).toHaveLength(2);
    fireEvent.click(linear[0]);
    expect(linear[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('names the group for a screen reader without spending toolbar space on it', () => {
    render(<ChartScaleToggle />);
    expect(screen.getByRole('group', { name: 'Bar chart scale' })).toBeTruthy();
  });
});

describe('chartScaleStore', () => {
  it('reads a persisted pick on first use', () => {
    localStorage.setItem(CHART_SCALE_STORAGE_KEY, 'linear');
    expect(getSnapshot()).toBe('linear');
  });

  it('falls back to the deposited scale for a value this build does not know', () => {
    // The stored string outlives the deploy that wrote it: a removed option must
    // degrade, not throw, and not leave the charts on a scale with no control.
    localStorage.setItem(CHART_SCALE_STORAGE_KEY, 'log10');
    expect(getSnapshot()).toBe('native');
  });

  it('returns a stable snapshot when nothing changed', () => {
    // useSyncExternalStore compares by identity; a snapshot that differed every
    // call would re-render every mounted chart forever.
    setChartScale('log2');
    expect(getSnapshot()).toBe(getSnapshot());
  });
});
