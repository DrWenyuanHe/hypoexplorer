import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArmPills, ArmVariesBadge } from '../common/StudyMetadata';
import type { Group } from '../types';

const baseline: Group = { key: 'normal', label: 'Normal', color: '#3775BA' };
const caseGroup: Group = { key: 'obese', label: 'Obese', color: '#9C3A46' };

const triple = (hex: string) => {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

const pill = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('span')]
    .find(s => (s.textContent || '').trim().endsWith(label) && s.style.borderRadius === '12px');

describe('ArmPills', () => {
  it.each(['md', 'lg'] as const)('tints %s pills from each group color', (size) => {
    const { container } = render(
      <ArmPills
        baseline={baseline} caseGroup={caseGroup}
        nBaseline={3} nCase={3} size={size}
      />,
    );
    for (const group of [baseline, caseGroup]) {
      const el = pill(container, group.label);
      expect(el, `${size} pill for ${group.label}`).toBeTruthy();
      const style = el!.getAttribute('style') || '';
      expect(style).toContain(`rgba(${triple(group.color)}, 0.09)`);
      expect(style).toContain(`rgba(${triple(group.color)}, 0.22)`);
      const dot = el!.querySelector('span')!.getAttribute('style') || '';
      expect(dot).toMatch(new RegExp(`${group.color}|rgb\\(${triple(group.color)}\\)`, 'i'));
      expect(style).not.toContain('76, 120, 168');
      expect(style).not.toContain('228, 87, 86');
    }
  });

  it('degrades undefined and non-hex colors to a neutral grey wash', () => {
    const { container, rerender } = render(
      <ArmPills
        baseline={{ ...baseline, color: 'red' }}
        // #abc, not #888: the fallback grey IS rgb(136,136,136), so a short hex
        // whose expansion matches it cannot tell "degraded" from "parsed". #abc
        // expands to rgb(170,187,204) — if that ever appears, short hex started
        // being parsed and the degrade path regressed unobserved.
        caseGroup={{ ...caseGroup, color: '#abc' }}
        nBaseline={2} nCase={3}
      />,
    );
    for (const label of [baseline.label, caseGroup.label]) {
      const style = pill(container, label)!.getAttribute('style') || '';
      expect(style).toContain('rgba(136, 136, 136, 0.09)');
      expect(style).toContain('rgba(136, 136, 136, 0.22)');
      expect(style).not.toContain('170, 187, 204');
    }

    rerender(
      <ArmPills
        baseline={{ ...baseline, color: undefined as unknown as string }}
        caseGroup={caseGroup} nBaseline={2} nCase={3}
      />,
    );
    const style = pill(container, baseline.label)!.getAttribute('style') || '';
    expect(style).toContain('rgba(136, 136, 136, 0.09)');
    expect(style).toContain('rgba(136, 136, 136, 0.22)');
  });

  it('renders a missing count as one text node containing an em dash', () => {
    const { container } = render(
      <ArmPills
        baseline={baseline} caseGroup={caseGroup}
        nBaseline={null} nCase={3}
      />,
    );
    const baselinePill = pill(container, baseline.label)!;
    expect(baselinePill.textContent).toBe('– Normal');
    expect(baselinePill.childNodes.length).toBe(2);
    expect(baselinePill.childNodes[1].nodeType).toBe(Node.TEXT_NODE);
  });

  it('renders the varies badge with the caller noun and default title', () => {
    render(
      <ArmPills
        baseline={baseline} caseGroup={caseGroup}
        nBaseline={3} nCase={3} nVaries trackNoun="population"
      />,
    );
    const badge = screen.getByText('n varies by population');
    expect(badge.getAttribute('title')).toBe(
      'Replicate counts vary by population. These counts describe the default population.',
    );
  });

  it('applies per-arm tooltips and help cursors independently', () => {
    const { container } = render(
      <ArmPills
        baseline={baseline} caseGroup={caseGroup}
        nBaseline={3} nCase={3} baselineTitle="Normal samples"
      />,
    );
    const baselinePill = pill(container, baseline.label)!;
    const casePill = pill(container, caseGroup.label)!;
    expect(baselinePill.getAttribute('title')).toBe('Normal samples');
    expect(baselinePill.style.cursor).toBe('help');
    expect(casePill.getAttribute('title')).toBeNull();
    expect(casePill.style.cursor).toBe('');
  });

  it('renders the after node last', () => {
    const { container } = render(
      <ArmPills
        baseline={baseline} caseGroup={caseGroup}
        nBaseline={3} nCase={3} after={<span>warning</span>}
      />,
    );
    expect(container.firstElementChild?.lastElementChild?.textContent).toBe('warning');
  });

  it('matches the former hero metrics without adding wrapping styles', () => {
    const { container } = render(
      <ArmPills
        baseline={baseline} caseGroup={caseGroup}
        nBaseline={3} nCase={3} size="lg"
      />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const baselinePill = pill(container, baseline.label)!;
    const dot = baselinePill.querySelector('span')!;
    expect(wrapper.tagName).toBe('DIV');
    expect(wrapper.style.display).toBe('flex');
    expect(wrapper.style.gap).toBe('6px');
    expect(wrapper.style.flexWrap).toBe('');
    expect(baselinePill.style.gap).toBe('6px');
    expect(baselinePill.style.padding).toBe('3px 10px');
    expect(baselinePill.style.fontSize).toBe('12px');
    expect(baselinePill.style.whiteSpace).toBe('');
    expect(dot.style.width).toBe('8px');
    expect(dot.style.height).toBe('8px');
    expect(dot.style.flexShrink).toBe('');
  });

  it('renders the design arrow without counts or pill chrome', () => {
    const { container } = render(
      <ArmPills
        baseline={baseline} caseGroup={caseGroup}
        nBaseline={99} nCase={88} variant="design"
      />,
    );
    expect(container.textContent).toBe('Normal→Obese');
    expect(container.textContent).not.toContain('99');
    expect(container.textContent).not.toContain('88');
    expect(container.querySelector('[style*="border-radius: 12px"]')).toBeNull();
  });

  it('renders nothing without both groups', () => {
    const { container } = render(
      <ArmPills baseline={null} caseGroup={caseGroup} nBaseline={3} nCase={3} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('ArmVariesBadge', () => {
  it('supports default wording plus title and font-size overrides', () => {
    const { rerender } = render(<ArmVariesBadge />);
    expect(screen.getByText('n varies by track').getAttribute('title')).toBe(
      'Replicate counts vary by track. These counts describe the default track.',
    );

    rerender(<ArmVariesBadge trackNoun="population" title="Custom title" fontSize={10} />);
    const badge = screen.getByText('n varies by population');
    expect(badge.getAttribute('title')).toBe('Custom title');
    expect(badge.style.fontSize).toBe('10px');
  });
});
