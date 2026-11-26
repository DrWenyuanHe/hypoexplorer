// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSurveyHandoff } from '../expression-survey/useSurveyHandoff';
import { DEFAULT_SURVEY_SCOPE } from '../expression-survey/expressionSurvey';

const SCOPE = { ...DEFAULT_SURVEY_SCOPE, collection: 'existing' as const };

describe('the survey page handover', () => {
  it('lasts only for the visit it opened', () => {
    const { result, rerender } = renderHook(({ view, gene }) => useSurveyHandoff(view, gene), {
      initialProps: { view: 'expression', gene: null as string | null },
    });
    act(() => { result.current.handOff('Pomc', SCOPE); });
    // The route has not settled yet: the handover survives that render.
    rerender({ view: 'expression', gene: null });
    expect(result.current.scopeFor('Pomc')).toBe(SCOPE);
    rerender({ view: 'report', gene: 'Pomc' });
    expect(result.current.scopeFor('Pomc')).toBe(SCOPE);
    expect(result.current.scopeFor('Agrp')).toBeUndefined();
    // Leaving the page drops it: the same gene reached by ordinary search opens plainly.
    rerender({ view: 'hub', gene: null });
    rerender({ view: 'report', gene: 'Pomc' });
    expect(result.current.scopeFor('Pomc')).toBeUndefined();
  });

  it('replaces an earlier handover with a new one', () => {
    const { result, rerender } = renderHook(({ view, gene }) => useSurveyHandoff(view, gene), {
      initialProps: { view: 'report', gene: 'Pomc' as string | null },
    });
    act(() => { result.current.handOff('Agrp', SCOPE); });
    rerender({ view: 'report', gene: 'Agrp' });
    expect(result.current.scopeFor('Agrp')).toBe(SCOPE);
    expect(result.current.scopeFor('Pomc')).toBeUndefined();
  });
});
