// Statistics explainer — a full-screen, dataset-agnostic reference page that
// defines every statistic HypoExplorer shows and states where they stop: every
// number belongs to ONE dataset, and the cross-dataset views arrange those
// numbers without combining them. The pooled random-effects meta-analysis this
// page used to document was removed — 145 studies across eleven species,
// several platforms and a dozen perturbations do not estimate a common effect,
// so a pooled number averaged questions that are not the same question.
//
// Prose is written directly as JSX (the app has no markdown renderer), mirroring
// MethodologyView. It is a page-level `view` (like GeneReport / DatasetTracker)
// rather than a track-scoped tab, because nothing here depends on a loaded track.

import type { CSSProperties, ReactNode } from 'react';
import { FONT_HEADING, FONT_MONO, FONT_SANS, DIRECTION_UP_COLOR as UP, DIRECTION_DOWN_COLOR as DOWN } from '../styles/constants';
import { PageShell } from '../common/PageShell';
import { Mono } from '../common/prose';

// H2 / P / thStyle below are DELIBERATELY not ../common/prose's: this is a
// full-page reference, not a tab, so it runs a larger heading scale (15/600),
// wider section margins, and a 70ch measure. Only `Mono` (byte-identical
// everywhere) is shared. Converging the rest would shrink this page's headings.
function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', fontFamily: FONT_HEADING, margin: '34px 0 12px' }}>
      {children}
    </h2>
  );
}

function H3({ children }: { children: ReactNode }) {
  return (
    <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: FONT_HEADING, margin: '20px 0 8px' }}>
      {children}
    </h3>
  );
}

function P({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--text-primary)', fontFamily: FONT_SANS, margin: '0 0 12px', maxWidth: '70ch' }}>
      {children}
    </p>
  );
}

function Callout({ children, tone = 'note' }: { children: ReactNode; tone?: 'note' | 'warn' }) {
  const accent = tone === 'warn' ? UP : 'var(--accent)';
  return (
    <div style={{
      borderLeft: `3px solid ${accent}`, background: 'var(--bg-panel)', borderRadius: '0 6px 6px 0',
      padding: '10px 14px', margin: '0 0 14px', maxWidth: '70ch',
      fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-primary)', fontFamily: FONT_SANS,
    }}>
      {children}
    </div>
  );
}

const thStyle: CSSProperties = {
  padding: '7px 10px', fontSize: 11, fontWeight: 600, textAlign: 'left',
  color: 'var(--text-muted)', whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border)', fontFamily: FONT_SANS,
};
const tdMono: CSSProperties = {
  padding: '7px 10px', fontSize: 12, color: 'var(--text-mono)',
  borderBottom: '1px solid var(--border)', fontFamily: FONT_MONO, whiteSpace: 'nowrap', verticalAlign: 'top',
};
const tdSans: CSSProperties = {
  padding: '7px 10px', fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border)', fontFamily: FONT_SANS,
};

// The significance-star scheme, sourced from utils/format.ts pToStar thresholds.
const STAR_ROWS: Array<{ star: string; cond: string }> = [
  { star: '****', cond: 'p < 0.0001' },
  { star: '***', cond: 'p < 0.001' },
  { star: '**', cond: 'p < 0.01' },
  { star: '*', cond: 'p < 0.05' },
  { star: 'ns', cond: 'p ≥ 0.05' },
];

// Glossary: the exact fields/terms shown across the explorer.
const GLOSSARY: Array<{ term: string; field: string; meaning: ReactNode }> = [
  { term: 'log2FC', field: 'logFC', meaning: 'The log2 fold-change of the case group over the baseline. +1 = doubled, −1 = halved.' },
  { term: 'Raw p-value', field: 'PValue / pval', meaning: 'The test p-value for a gene or pathway within one dataset, before adjustment for testing many features. See the dataset methods for its statistical test.' },
  { term: 'FDR', field: 'FDR / padj', meaning: 'The Benjamini–Hochberg adjusted p-value across all genes or all gene sets tested within one dataset. The threshold describes the expected false-discovery rate.' },
  { term: 'Significance stars', field: '★', meaning: 'Shorthand for the raw p-value, using the thresholds above. Stars and FDR can disagree.' },
  { term: 'NES', field: 'NES', meaning: "Normalized enrichment score. It describes the direction and strength of a gene set's coordinated shift. Its sign follows the log2FC convention." },
  { term: 'CPM (TMM-normalized)', field: 'cpm', meaning: "Counts per million after TMM normalization, using the normalization factors of that dataset's own edgeR fit. Shown for count data; datasets analysed from a deposited normalized matrix keep that matrix's unit." },
  { term: '95% CI', field: 'se', meaning: "The approximate interval through a forest-plot dot, log2FC ± 1.96 × SE. It uses the standard error from that dataset's model and describes uncertainty for that dataset only." },
];

interface StatisticsViewProps {
  onHome: () => void;
}

export function StatisticsView({ onHome }: StatisticsViewProps) {
  return (
    <PageShell
      onHome={onHome}
      breadcrumbs={[{ label: 'Statistics', current: true }]}
      mainStyle={{ overflowY: 'auto' }}
    >
        <div style={{ maxWidth: 760, width: '100%', margin: '0 auto', padding: '28px 24px 72px' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', fontFamily: FONT_HEADING, letterSpacing: '-0.01em', margin: 0 }}>
            Statistics in HypoExplorer
          </h1>
          <P>
            Each dataset has its own analysis and statistics. This page explains how to read those
            results within a study and compare them across studies. HypoExplorer does not pool results
            across datasets.
          </P>

          {/* WITHIN ONE DATASET */}
          <H2 id="within-dataset">Within a single dataset</H2>
          <P>
            Each dataset was analysed independently. HypoExplorer shows both the raw p-value and the
            adjusted p-value from that analysis.
          </P>

          <H3>Raw p-value</H3>
          <P>
            The raw p-value, <Mono>PValue</Mono> for genes or <Mono>pval</Mono> for pathways, is the test
            result before adjustment for multiple testing. For a single pre-registered hypothesis,
            such as a change in <Mono>IGFBP2</Mono> expression in one dataset, read the raw p-value.
          </P>

          <H3>FDR (Benjamini–Hochberg)</H3>
          <P>
            The adjusted p-value, <Mono>FDR</Mono> for genes or <Mono>padj</Mono> for pathways, accounts
            for testing many features within one dataset, roughly 12,000–19,000 genes. Use it when
            searching a dataset for significant results. The threshold describes the expected
            false-discovery rate among results called significant. The family includes features
            without a gene symbol or with an ambiguous one: they stay in the model but are not shown.
          </P>
          <P>
            The display rounds q-values to 2 significant figures; exports keep the full stored precision.
            For small pathway <Mono>padj</Mono> values, fgsea&apos;s <Mono>log2err</Mono> indicates
            uncertainty by a factor of roughly 1.6–2.
          </P>
          <Callout>
            <strong>A-priori vs discovery.</strong> Use the raw p-value for a single hypothesis named
            in advance. Use FDR when scanning the dataset for hits.
          </Callout>

          <H3>Significance stars</H3>
          <P>
            The star marks on bar charts and tables are a shorthand for the <em>raw</em> p-value:
          </P>
          <table style={{ borderCollapse: 'collapse', margin: '0 0 14px' }}>
            <thead><tr><th style={thStyle}>Mark</th><th style={thStyle}>Condition</th></tr></thead>
            <tbody>
              {STAR_ROWS.map((r) => (
                <tr key={r.star}>
                  <td style={{ ...tdMono, fontWeight: 700 }}>{r.star}</td>
                  <td style={tdMono}>{r.cond}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Callout tone="warn">
            <strong>Stars use the raw p-value.</strong> A gene can show <Mono>***</Mono> yet fail
            FDR &lt; 0.05 after correction across the dataset. This is common with small sample sizes.
            Check FDR before treating an exploratory result as significant.
          </Callout>

          <H3>Direction and effect size</H3>
          <P>
            Effect size is the <Mono>log2FC</Mono>. Throughout the explorer, <span style={{ color: UP, fontWeight: 600 }}>red is up in the case / HFD condition</span> and{' '}
            <span style={{ color: DOWN, fontWeight: 600 }}>blue is down toward the baseline</span>. Colour is
            always paired with the sign and a text label, never used alone.
          </P>

          {/* ACROSS DATASETS */}
          <H2 id="across-datasets">Across many datasets</H2>
          <P>
            The Gene and Pathway Explorers show results for a gene or pathway across datasets.
            Each result retains its study&apos;s effect size, p-value and adjusted p-value. These views
            align the results for comparison without calculating a pooled effect, pooled p-value or
            cross-dataset q-value.
          </P>

          <H3>Why there is no pooled number</H3>
          <P>
            Pooling assumes the studies estimate the same thing. These do not. The collection spans multiple
            species; bulk RNA-seq alongside single-nucleus and spatial data; whole hypothalamus alongside
            dissected nuclei and sorted cell populations; and perturbations as different as a 16-hour fast,
            a high-fat diet, a knockout and a drug. Two studies filed under the same heading can still
            differ in dose, duration, age, sex and baseline. A pooled estimate would obscure those
            differences. Categories group related studies for browsing; they do not establish that
            the studies estimate the same effect.
          </P>

          <Callout tone="warn">
            <strong>A significant-dataset count is a tally.</strong> The report&apos;s
            &quot;significant in N of M datasets&quot; line counts per-dataset results. Each FDR applies
            within its own dataset, so some results across a hundred-plus datasets will pass{' '}
            <Mono>FDR &lt; 0.05</Mono> by chance. The tally does not test significance across datasets.
            Inspect the direction, magnitude and study design behind each result, including disagreements.
          </Callout>

          <Callout>
            <strong>The macaque atlas is one study.</strong> Its ~60 cell populations come from the same
            6 animals, 3 Normal and 3 Obese. Separate tracks show cell-type-specific effects.
            They are not 60 independent replications.
          </Callout>

          <H3>The compare set</H3>
          <P>
            The compare set shows selected studies or populations in columns. Each column names its
            contrast and replicate counts, uses its study&apos;s expression unit, and shows that
            study&apos;s p-values and FDR. The <Mono>Sig (tally)</Mono> column counts results passing{' '}
            <Mono>FDR &lt; 0.05</Mono> by direction. It does not combine them into a statistical test.
            Populations from the same study share animals, as noted on the page.
          </P>

          {/* GLOSSARY */}
          <H2 id="glossary">Glossary</H2>
          <table style={{ width: '100%', borderCollapse: 'collapse', margin: '0 0 8px' }}>
            <thead>
              <tr>
                <th style={thStyle}>Term</th>
                <th style={thStyle}>Field</th>
                <th style={thStyle}>What it means</th>
              </tr>
            </thead>
            <tbody>
              {GLOSSARY.map((g) => (
                <tr key={g.term}>
                  <td style={{ ...tdSans, fontWeight: 600, whiteSpace: 'nowrap' }}>{g.term}</td>
                  <td style={tdMono}>{g.field}</td>
                  <td style={tdSans}>{g.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_SANS, lineHeight: 1.5, marginTop: 10 }}>
            Every gene and pathway statistic here is computed upstream in R (edgeR / limma for genes, fgsea for
            pathways, Benjamini–Hochberg within each dataset) and read out of that dataset&apos;s own bundle. All
            of them were computed under R 4.6.0, and each dataset&apos;s tables are stored with their R session
            record. The cross-dataset views display and arrange those numbers; they do not compute new ones.
            See the Methodology page for the analysis pipeline.
          </div>
        </div>
    </PageShell>
  );
}
