import { describe, it, expect } from 'vitest';
import { hubSections } from '../hub/LandingHub';

// Three main tools and the supporting tools retain their existing destinations.
describe('hubSections', () => {
  const build = (nDatasets = 42) => {
    const tools: string[] = [];
    const sections = hubSections(
      {
        onOpenSearch: () => tools.push('search'),
        onOpenExpression: () => tools.push('expression-survey'),
        onOpenTracker: () => {},
        onOpenLibrary: () => {},
      },
      { nDatasets },
    );
    return { sections, tools };
  };


  it('keeps the two sections and their row counts', () => {
    const { sections } = build();
    expect(sections.map((s) => s.id)).toEqual(['start', 'more']);
    expect(sections[0].items).toHaveLength(3);
    expect(sections[1].items).toHaveLength(2);
  });

  it('opens the independent expression survey from the tool index', () => {
    const { sections, tools } = build();
    sections[0].items.find((item) => item.name === 'Expression survey')?.go();
    expect(tools).toEqual(['expression-survey']);
  });

  it('leads with exactly the three primary tools, in order', () => {
    const { sections } = build();
    expect(sections[0].items.map((i) => i.name)).toEqual([
      'Expression survey',
      'Dataset library',
      'Gene & Pathway Explorer',
    ]);
  });

  it('counts the corpus on the dataset library card', () => {
    const { sections } = build(42);
    const library = sections[0].items.find((i) => i.name === 'Dataset library');
    expect(library?.desc).toContain('42 studies');
  });

  it('routes the explorer card to the shared search dialog, not to a dataset tab', () => {
    // The regression this guards: the explorer cards used to call
    // onEnterTool('gene') / ('pathway'), which opens the PER-DATASET explorer
    // tab. The card now opens the cross-dataset search.
    const { sections, tools } = build();
    for (const item of sections[0].items) item.go();
    expect(tools).toEqual(['expression-survey', 'search']);
  });

  it('keeps only local datasets and tracking in More tools', () => {
    const { sections } = build();
    expect(sections[1].items.map((item) => item.name)).toEqual([
      'Explore Local Datasets', 'Dataset tracker',
    ]);
  });
});
