import { describe, it, expect } from 'vitest';
import { hubSections } from '../hub/LandingHub';

// Two main tools and the supporting tools retain their existing destinations.
// Gene and pathway search is the hub's own search box, not a listed tool.
describe('hubSections', () => {
  const build = (nDatasets = 42) => {
    const tools: string[] = [];
    const sections = hubSections(
      {
        onOpenExpression: () => tools.push('expression-survey'),
        onOpenTracker: () => tools.push('tracker'),
        onOpenLibrary: () => tools.push('library'),
      },
      { nDatasets },
    );
    return { sections, tools };
  };


  it('keeps the two sections and their row counts', () => {
    const { sections } = build();
    expect(sections.map((s) => s.id)).toEqual(['start', 'more']);
    expect(sections[0].items).toHaveLength(2);
    expect(sections[1].items).toHaveLength(1);
  });

  it('opens the independent expression survey from the tool index', () => {
    const { sections, tools } = build();
    sections[0].items.find((item) => item.name === 'Expression survey')?.go();
    expect(tools).toEqual(['expression-survey']);
  });

  it('leads with exactly the two primary tools, in order', () => {
    const { sections } = build();
    expect(sections[0].items.map((i) => i.name)).toEqual([
      'Expression survey',
      'Dataset library',
    ]);
  });

  it('counts the corpus on the dataset library card', () => {
    const { sections } = build(42);
    const library = sections[0].items.find((i) => i.name === 'Dataset library');
    expect(library?.desc).toContain('42 studies');
  });

  it('routes each primary tool to its own destination', () => {
    const { sections, tools } = build();
    for (const item of sections[0].items) item.go();
    expect(tools).toEqual(['expression-survey', 'library']);
  });

  it('keeps only dataset tracking in More tools', () => {
    const { sections } = build();
    expect(sections[1].items.map((item) => item.name)).toEqual(['Dataset tracker']);
  });
});
