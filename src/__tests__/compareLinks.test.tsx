import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import App from '../App';
import { parseRoute, routeHref } from '../utils/appLinks';

// A Compare link names what Compare shows — its populations, genes and
// Genes/Pathways sub-tab — so a refresh, Back or a copied link reopens the same
// comparison instead of the bare default pair.

describe('Compare links — the codec', () => {
  const roundTrips = (hash: string) => expect(routeHref(parseRoute(hash)!)).toBe(hash);

  it('carries populations, genes and the Pathways sub-tab', () => {
    const hash = '#/dataset/macaque_snrna/compare/pathways?pops=e9,i23,Ast1&genes=POMC,AGRP';
    expect(parseRoute(hash)).toEqual({
      view: 'explorer', datasetId: 'macaque_snrna', trackId: 'compare',
      compare: { mode: 'pathways', pops: ['e9', 'i23', 'Ast1'], genes: ['POMC', 'AGRP'] },
    });
    roundTrips(hash);
    roundTrips('#/dataset/macaque_snrna/compare?genes=POMC');
    roundTrips('#/dataset/macaque_snrna/compare/pathways');
  });

  it('keeps an id\'s own comma inside it', () => {
    const route = { view: 'explorer' as const, datasetId: 'd', trackId: 'compare', compare: { pops: ['a,b', 'c'] } };
    expect(parseRoute(routeHref(route))).toEqual(route);
  });

  it('keeps an analysis-only Compare link byte-identical, after the lists', () => {
    const plain = '#/dataset/macaque_snrna/compare';
    expect(routeHref(parseRoute(plain)!)).toBe(plain);
    const href = routeHref({
      view: 'explorer', datasetId: 'd', trackId: 'compare', compare: { genes: ['X'] },
      analysis: {
        version: 1, contrastId: 'c', genes: [],
        volcano: { metric: 'pval', logFCThresh: 0.5, sigThresh: 0.05 },
        pathway: { search: '', dbFilter: { GOBP: true, GOMF: true, GOCC: true, KEGG: true, REACTOME: true, HALLMARK: true }, fdrThresh: 0.25, sortKey: 'padj' },
      },
    });
    expect(href).toMatch(/^#\/dataset\/d\/compare\?genes=X&analysis=/);
  });

  it('writes /compare/genes back as plain /compare', () => {
    expect(routeHref(parseRoute('#/dataset/d/compare/genes')!)).toBe('#/dataset/d/compare');
  });

  it('rejects a malformed or unknown field rather than guessing', () => {
    for (const bad of [
      '#/dataset/d/compare?pops=',
      '#/dataset/d/compare?pops=a&pops=b',
      '#/dataset/d/compare?colour=red',
      '#/dataset/d/compare?p%6Fps=a,b',
      '#/dataset/d/e9?pops=a,b',
    ]) expect(parseRoute(bad)).toBeNull();
  });
});

describe('Compare links — in the app', () => {
  const META = {
    populations: ['arcuate', 'vmh', 'dmh'],
    labels: { arcuate: 'Arcuate', vmh: 'VMH', dmh: 'DMH' },
    types: { arcuate: 'Region', vmh: 'Region', dmh: 'Region' },
    nGenes: { arcuate: 2, vmh: 2, dmh: 2 },
  };
  afterEach(() => {
    cleanup();
    delete (window as any).HX_GSE262407_META;
    window.history.replaceState(null, '', '/');
  });

  it('opens a Compare link on its populations and genes, dropping ids the dataset lacks', async () => {
    (window as any).HX_GSE262407_META = META;
    window.history.replaceState(null, '', '/#/dataset/gse262407/compare?pops=vmh,not_a_region,dmh&genes=POMC');
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Remove vmh' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove dmh' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove arcuate' })).toBeNull();
    expect(screen.getByText('1 gene selected')).toBeTruthy();
    // The address bar is rewritten to the comparison actually shown.
    await waitFor(() => expect(window.location.hash).toBe('#/dataset/gse262407/compare?pops=vmh,dmh&genes=POMC'));
  });

  it('writes a change of populations into the URL', async () => {
    (window as any).HX_GSE262407_META = META;
    window.history.replaceState(null, '', '/#/dataset/gse262407/compare?pops=arcuate,vmh,dmh');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove dmh' }));
    await waitFor(() => expect(window.location.hash).toBe('#/dataset/gse262407/compare'));
  });
});
