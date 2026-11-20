import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import App from '../App';
import { _resetUpdateStore, markUpdateAvailable } from '../pwa/updateStore';
import { DEFAULT_STUDY_ANALYSIS } from '../utils/analysisState';

// The survey's own data loading is not under test here, only the page it sits on.
vi.mock('../expression-survey/ExpressionSurveyView', () => ({
  ExpressionSurveyView: () => <h1>Expression survey</h1>,
}));

afterEach(() => {
  _resetUpdateStore();
  window.history.replaceState(null, '', '/');
});

const signalUpdate = () => act(() => { markUpdateAvailable(vi.fn().mockResolvedValue(undefined)); });
const prompts = () => screen.queryAllByRole('alertdialog', { name: 'Updating to the newest version' });

// App mounts the new-version prompt once, above its view switch. These pin the
// two pages that used to render without it, and that it is never doubled.
describe('App new-version prompt', () => {
  it('appears once on the expression survey', async () => {
    window.history.replaceState(null, '', '/#/expression');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Expression survey' })).toBeInTheDocument();
    expect(prompts()).toHaveLength(0);
    signalUpdate();
    expect(prompts()).toHaveLength(1);
  });

  it('appears once on the route-error page', () => {
    window.history.replaceState(null, '', `/#/gene/POMC?analysis=${encodeURIComponent(JSON.stringify({ ...DEFAULT_STUDY_ANALYSIS, version: 99 }))}`);
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Analysis link unavailable' })).toBeInTheDocument();
    signalUpdate();
    expect(prompts()).toHaveLength(1);
  });

  // Not preloaded on purpose: the prompt sits above every view's Suspense
  // boundary, so it shows while the chunk downloads and stays single after.
  it('appears once on a lazily loaded view, before and after its chunk arrives', async () => {
    window.history.replaceState(null, '', '/#/methodology');
    render(<App />);
    signalUpdate();
    expect(prompts()).toHaveLength(1);
    expect(await screen.findByRole('heading', { level: 1 }, { timeout: 10_000 })).toBeInTheDocument();
    expect(prompts()).toHaveLength(1);
  });

  it('appears once on the hub', () => {
    render(<App />);
    signalUpdate();
    expect(prompts()).toHaveLength(1);
  });
});
