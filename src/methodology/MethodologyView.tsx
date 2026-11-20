// Methods & statistics (#/methodology): the in-app reference for how every
// number in HypoExplorer was produced and how to read it. It is a page-level
// `view`, not an explorer tab: it describes the whole collection, so it does not
// sit inside one dataset's explorer. Prose is written directly as JSX (the app
// has no markdown renderer). The former Statistics page (#/statistics) is merged
// in here; its links open this page.
//
// Order: collection-wide rules first (source data, DE, enrichment, units), then
// how to read the statistics within one study and across studies, verification,
// the macaque snRNA-seq pipeline and its size-cap example, and a glossary.
// Studies differ, so per-study facts stay in the study record, not here. The
// public Methods guide (/methods/) is the indexed overview; this page keeps the
// parameter detail it leaves out.
//
// Every gene and pathway statistic is computed upstream in R and read out of the
// dataset's own bundle; the cross-dataset views arrange those numbers without
// pooling them. The pooled random-effects meta-analysis the Statistics page used
// to document was removed: studies across many species, platforms and
// perturbations do not estimate a common effect.

import type { ReactNode } from 'react';

import { FONT_HEADING, FONT_MONO, FONT_SANS, DIRECTION_UP_COLOR as UP, DIRECTION_DOWN_COLOR as DOWN } from '../styles/constants';
import { PageShell } from '../common/PageShell';
import { H2, Mono, P, tdStyle, thStyle } from '../common/prose';
import { DEFAULT_FDR_CUTOFF } from '../statistics/policy';
import { METRIC_DEFAULT_SIG_THRESH } from '../explorer/explorerSession';

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
  { term: 'Raw p-value', field: 'PValue / pval', meaning: 'The test p-value for a gene or pathway within one dataset, before adjustment for testing many features.' },
  { term: 'FDR', field: 'FDR / padj', meaning: 'The Benjamini–Hochberg adjusted p-value across all genes or all gene sets tested within one dataset. The threshold describes the expected false-discovery rate.' },
  { term: 'Significance stars', field: '★', meaning: 'Shorthand for the raw p-value, using the thresholds above. Stars and FDR can disagree.' },
  { term: 'NES', field: 'NES', meaning: "Normalized enrichment score. It describes the direction and strength of a gene set's coordinated shift. Its sign follows the log2FC convention." },
  { term: 'CPM (TMM-normalized)', field: 'cpm', meaning: "Counts per million after TMM normalization, using the normalization factors of that dataset's own edgeR fit. Shown for count data; datasets analysed from a deposited normalized matrix keep that matrix's unit." },
  { term: '95% CI', field: 'se', meaning: "The approximate interval through a forest-plot dot, log2FC ± 1.96 × SE. It uses the standard error from that dataset's model and describes uncertainty for that dataset only." },
];

// Worked-example rows: how a cluster's ranked-gene universe size decides
// whether GOBP_CELL_CELL_ADHESION clears the fgsea maxSize = 500 cap.
// Sorted by universe; e33 dropping below i15's universe is deliberate (the
// term's size counts its own detected genes, not the universe).
// Values measured from data/raw/results/<cluster>/ DE tables + FGSEA_GO_BP.csv
// after the R 4.6.0 regeneration (MSigDB 2026.1.Hs).
const EXAMPLE_ROWS = [
  { cluster: 'i45', universe: '7,073', size: '330', child: '31', outcome: 'kept', dropped: false },
  { cluster: 'e33', universe: '11,098', size: '> 500', child: '42', outcome: 'dropped', dropped: true },
  { cluster: 'i15', universe: '11,157', size: '496', child: '41', outcome: 'kept', dropped: false },
  { cluster: 'i23', universe: '11,581', size: '> 500', child: '50', outcome: 'dropped', dropped: true },
  { cluster: 'e9', universe: '12,627', size: '> 500', child: '50', outcome: 'dropped', dropped: true },
];

const SECTIONS = [
  { id: 'methods-source', title: 'Source data and analysis environment' },
  { id: 'methods-de', title: 'Differential expression' },
  { id: 'methods-enrichment', title: 'Pathway enrichment' },
  { id: 'methods-units', title: 'Expression units' },
  { id: 'methods-within', title: 'Reading the statistics within one study' },
  { id: 'methods-across', title: 'Reading results across studies' },
  { id: 'methods-verification', title: 'Data verification and evidence' },
  { id: 'methods-macaque', title: 'Macaque single-nucleus pipeline' },
  { id: 'methods-missing', title: 'Why some macaque pathways are missing' },
  { id: 'methods-glossary', title: 'Glossary' },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

const linkStyle = { color: 'var(--accent)' };

// Only this page uses a styled <li> and <h3>, so they stay here rather than in ../common/prose.
function Li({ children }: { children: ReactNode }) {
  return (
    <li style={{
      fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)',
      fontFamily: FONT_SANS, marginBottom: 6,
    }}>
      {children}
    </li>
  );
}

function Ul({ children }: { children: ReactNode }) {
  return <ul style={{ margin: '0 0 12px', padding: '0 0 0 18px', listStyle: 'disc' }}>{children}</ul>;
}

function H3({ children }: { children: ReactNode }) {
  return (
    <h3 style={{
      fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
      fontFamily: FONT_HEADING, margin: '18px 0 6px',
    }}>
      {children}
    </h3>
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

// Section anchors. The app routes on the URL hash, so in-page links scroll
// with scrollIntoView instead of writing #id into the location.
function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const title = SECTIONS.find((s) => s.id === id)!.title;
  return (
    <section id={id} aria-labelledby={`${id}-h`} tabIndex={-1} style={{ scrollMarginTop: 16, outline: 'none' }}>
      <div id={`${id}-h`}><H2>{title}</H2></div>
      {children}
    </section>
  );
}

function Contents() {
  return (
    <nav aria-label="On this page" style={{
      margin: '16px 0 4px', padding: '10px 14px',
      border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-panel)',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', fontFamily: FONT_SANS,
        textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
      }}>
        On this page
      </div>
      <ol style={{ margin: 0, padding: '0 0 0 18px' }}>
        {SECTIONS.map((s) => (
          <li key={s.id} style={{ fontSize: 13, lineHeight: 1.7, fontFamily: FONT_SANS, color: 'var(--text-muted)' }}>
            <button
              type="button"
              onClick={() => {
                const target = document.getElementById(s.id);
                target?.scrollIntoView({ block: 'start' });
                target?.focus({ preventScroll: true });
              }}
              style={{
                background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left',
                font: 'inherit', color: 'var(--accent)',
              }}
            >
              {s.title}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function MethodologyView({ onHome }: { onHome: () => void }) {
  const volcanoP = 10 ** -METRIC_DEFAULT_SIG_THRESH.pval;
  return (
    <PageShell
      onHome={onHome}
      breadcrumbs={[{ label: 'Methods & statistics', current: true }]}
      mainStyle={{ overflowY: 'auto' }}
    >
      <div style={{ maxWidth: 720, width: '100%', margin: '0 auto', padding: '28px 24px 72px', boxSizing: 'border-box' }}>
        <h1 style={{
          fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', fontFamily: FONT_HEADING,
          letterSpacing: '-0.01em', margin: '0 0 12px',
        }}>
          Methods &amp; statistics
        </h1>

        <P>
          This page describes the rules that apply to every study in the collection, how to read the
          statistics within one study and across studies, and the macaque single-nucleus pipeline in
          detail. Each study has its own analysis: HypoExplorer does not pool results across datasets.
          Facts that differ by study, such as groups, replicates, expression unit and upstream
          processing, are listed in that study&apos;s library record. The{' '}
          <a href="/methods/" style={linkStyle}>public Methods guide</a> covers source selection,
          comparison direction and replicate units; <a href="/how-to-cite/" style={linkStyle}>How to cite</a>{' '}
          explains how to credit the original datasets and HypoExplorer separately.
        </P>

        <Contents />

        {/* 1. Source data */}
        <Section id="methods-source">
          <P>
            HypoExplorer starts from the depositors&apos; processed matrices and does not realign raw
            reads. Each study record lists the depositor&apos;s aligner, genome build and annotation under
            Upstream processing, as stated in the repository record or source paper.
          </P>
          <P>
            Every differential-expression and enrichment table was computed under R 4.6.0 with
            edgeR 4.10.1, limma 3.68.4, fgsea 1.38.0 and msigdbr 26.1.0 (MSigDB 2026.1.Hs). Every table
            has a provenance record of package versions, handling rules, samples and file checksums, and
            each differential-expression run also keeps its R session record. Earlier tables, made partly
            under R 4.4.1, were replaced on 26 September 2026, so some values and significance calls
            differ from earlier versions of HypoExplorer.
          </P>
        </Section>

        {/* 2. Differential expression */}
        <Section id="methods-de">
          <P>
            Count data are tested with edgeR&apos;s quasi-likelihood (QL) framework on TMM-normalized
            libraries. Studies available only as a deposited normalized matrix are tested with limma on
            that matrix. Consult the selected study&apos;s record rather than assuming the macaque
            workflow applies to every dataset. How the explorer calls a result significant is under{' '}
            <em>Reading the statistics within one study</em> below.
          </P>
          <H3>Feature handling before testing</H3>
          <Ul>
            <Li>
              <strong>Duplicate gene symbols.</strong> Each feature is mapped to its gene symbol before
              testing. Features that share a symbol are combined into one row only when they are different
              stable gene IDs annotated to that symbol (Ensembl, Entrez, RefSeq or array probe) or repeats
              of the same ordinary label. Counts and linear-scale values are summed, log-scale values are
              averaged, and <Mono>log2(x + 1)</Mono> values are summed on the linear scale. Other features
              that reach the same symbol, such as different labels joined only by an alias or previous
              symbol, stay as separate rows, and only the one whose label matches the symbol is shown.
            </Li>
            <Li>
              <strong>Spreadsheet-damaged labels.</strong> Gene labels that a spreadsheet converted to dates
              are restored to their symbol. 1-Mar and 2-Mar can mean MARCHF1/2 or MTARC1/2, so they are
              shown only when a gene ID, gene name or chromosome in the same source row identifies the gene.
              A date label that occurs more than once is never combined.
            </Li>
            <Li>
              <strong>Unshown features.</strong> Features without a symbol, and unresolved ones, stay in the
              model and are removed only after testing, so filtering, normalization and the FDR correction
              see the whole library.
            </Li>
            <Li>
              <strong>Fractional counts.</strong> Estimated counts, such as those from Salmon, are
              analysed without rounding.
            </Li>
          </Ul>
        </Section>

        {/* 3. Enrichment */}
        <Section id="methods-enrichment">
          <P>
            Gene-set enrichment uses <Mono>fgsea</Mono> on the full ranked gene list of each comparison:
            the signed QL F-statistic (<Mono>sign(logFC) × F</Mono>) for edgeR fits and the moderated
            t-statistic for limma fits. Gene sets come from MSigDB Hallmark, KEGG (legacy), GO:BP and
            Reactome, mapped from human to the study species&apos; orthologs.
          </P>
          <P>
            A gene set is tested only when <Mono>minSize = 15</Mono> to <Mono>maxSize = 500</Mono> of its
            genes are present in that comparison&apos;s ranked list. These limits exclude very small and
            very broad overlaps. A pathway missing from a result table was not tested; its absence does
            not show that it is biologically absent or inactive.
          </P>
        </Section>

        {/* 4. Expression units */}
        <Section id="methods-units">
          <P>
            Displayed values and differential-expression statistics have different roles, and the
            collection does not share one scale. Read the unit label for the selected dataset, shown in
            the study record and on chart axes and exports, before interpreting a value.
          </P>
          <table style={{ width: '100%', borderCollapse: 'collapse', margin: '4px 0 12px' }}>
            <thead>
              <tr>
                <th style={thStyle}>Unit label</th>
                <th style={thStyle}>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={tdStyle}>CPM (TMM-normalized)</td>
                <td style={{ ...tdStyle, fontFamily: FONT_SANS }}>
                  Count studies, including the macaque atlas. Counts per million on the TMM-effective
                  library sizes of the study&apos;s own edgeR fit.
                </td>
              </tr>
              <tr>
                <td style={tdStyle}>log2(… + 1)</td>
                <td style={{ ...tdStyle, fontFamily: FONT_SANS }}>
                  A deposited normalized matrix (for example TPM, FPKM or DESeq2-normalized counts),
                  log-transformed here. The label names the deposited scale.
                </td>
              </tr>
              <tr>
                <td style={tdStyle}>Other deposited scales</td>
                <td style={{ ...tdStyle, fontFamily: FONT_SANS }}>
                  Values kept on the depositor&apos;s scale, such as variance-stabilized or RMA values.
                  GSE220533 is <Mono>log2-normalized</Mono>: it was deposited on that scale, with no raw
                  counts to renormalize from.
                </td>
              </tr>
            </tbody>
          </table>
          <P>
            TMM-normalized CPM adjusts for library size and RNA composition without transcript-length
            normalization. TPM and FPKM include a length correction with different scaling conventions,
            and TPM uses a sample-specific denominator after length adjustment, so converting between them
            needs the source quantification and is not a constant rescaling of each gene. A displayed log
            scale is not an untransformed count ratio.
          </P>
          <P>
            Interpret expression within the selected assay and study. Transcript length can affect
            comparisons between genes in conventional bulk RNA-seq, while 3&prime;-tag UMI assays have
            different quantification properties. Gene-wise z-scored heatmaps show relative patterns, not
            absolute expression differences between genes or across studies.
          </P>
        </Section>

        {/* 5. Within one study (formerly the Statistics page) */}
        <Section id="methods-within">
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
          <H3>Significance in the explorer</H3>
          <Ul>
            <Li>
              Cross-dataset reports, gene reports and comparisons call a gene or pathway significant when
              its Benjamini–Hochberg FDR (or fgsea adjusted P) is below {DEFAULT_FDR_CUTOFF}, with no
              fold-change cutoff.
            </Li>
            <Li>
              The volcano plot starts by highlighting raw P &lt; {volcanoP}; the threshold and metric can be
              changed in its controls.
            </Li>
          </Ul>
          <H3>Significance stars</H3>
          <P>
            The star marks on bar charts and tables are a shorthand for the <em>raw</em> p-value:
          </P>
          <table style={{ borderCollapse: 'collapse', margin: '0 0 14px' }}>
            <thead><tr><th style={thStyle}>Mark</th><th style={thStyle}>Condition</th></tr></thead>
            <tbody>
              {STAR_ROWS.map((r) => (
                <tr key={r.star}>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{r.star}</td>
                  <td style={tdStyle}>{r.cond}</td>
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
        </Section>

        {/* 6. Across studies (formerly the Statistics page) */}
        <Section id="methods-across">
          <P>
            Search and the gene and pathway reports show results for a gene or pathway across datasets.
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
          <Callout tone="warn">
            <strong>Search and the gene and pathway reports also list nominal results.</strong> They
            list every track with raw <Mono>p &lt; 0.05</Mono> and label the ones that also pass{' '}
            <Mono>FDR &lt; 0.05</Mono>. The others are marked <Mono>p &lt; 0.05 only</Mono>: they are
            not corrected for the thousands of genes or pathways each study tested, nor for the many
            tracks searched, so a share of them are expected by chance. The significant counts and
            the pathway follow-up count only the FDR results. Set <Mono>List</Mono> to{' '}
            <Mono>FDR (q &lt; 0.05)</Mono> on any of these pages to list the FDR results alone; the
            choice is remembered in this browser.
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
        </Section>

        {/* 7. Verification */}
        <Section id="methods-verification">
          <P>
            Separate pipeline QC, experimental design and author concordance badges show processing checks,
            replication limitations and matched-gene agreement. Hover, focus or tap a badge for its checklist.
            Author concordance allows justified method differences without requiring identical P values or FDR.
            The macaque single-nucleus dataset is
            excluded from this author-comparison review at the project owner&apos;s request.
          </P>
          <P>
            <a href="#/verification" style={linkStyle}>
              Read the verification process and badge criteria →
            </a>
          </P>
        </Section>

        {/* 6. Macaque pipeline */}
        <Section id="methods-macaque">
          <P>
            The macaque dataset (<em>Macaca fascicularis</em>, Normal vs Obese) analyses each cell-type
            cluster independently, using the animal as the replicate.
          </P>
          <H3>Pseudobulk samples</H3>
          <P>
            Nuclei are summed into one pseudobulk count profile per animal and cluster. An animal
            contributes to a cluster only when it has at least 15 nuclei there, so group sizes vary by
            cluster: most clusters compare 3 Normal with 3 Obese animals, and a few have 2 in one group.
          </P>
          <H3>Differential expression</H3>
          <P>
            Each cluster keeps the genes that pass edgeR&apos;s <Mono>filterByExpr</Mono> for its groups,
            applies TMM normalization and tests Obese against Normal with the QL F-test. The genes that
            pass this filter form the cluster&apos;s ranked universe, shown as genes detected in the
            header. A leave-one-animal-out refit of the top genes, shown in Quality Control, flags calls
            that depend on a single animal.
          </P>
          <H3>Enrichment</H3>
          <P>
            Genes are ranked by <Mono>sign(logFC) × F</Mono>, with a seeded jitter of at most 10
            <sup>−7</sup> to break ties, and the random seed is reset before each collection. MSigDB sets
            are mapped to <em>Macaca mulatta</em> orthologs, the closest species msigdbr offers for the
            cynomolgus source animals (see <Mono>data/raw/scripts/run_atlas_r460.R</Mono>).
          </P>
        </Section>

        {/* 7. Missing pathways + worked example */}
        <Section id="methods-missing">
          <P>
            The 15–500 size window counts only a pathway&apos;s genes present in{' '}
            <em>that cluster&apos;s ranked universe</em>, which ranges from about 1,600 genes (COP) to
            about 13,800 (Ast1). A large GO term gains genes as more of the transcriptome is detected,
            crosses 500 and is dropped by <Mono>fgsea</Mono>, so it never reaches the Pathway Explorer.
            The cutoff follows the term&apos;s own detected genes, so a cluster with a slightly smaller
            universe can still lose a term that a larger one keeps. More specific child terms stay under
            500 and remain testable.
          </P>
          <H3>Worked example: GOBP_CELL_CELL_ADHESION</H3>
          <P>
            <Mono>GOBP_CELL_CELL_ADHESION</Mono> is tested in 23 of the 60 clusters, at sizes from 109
            genes (COP) to 497 (e28), and exceeds 500 in the other 37, including <Mono>e9</Mono>,{' '}
            <Mono>i23</Mono> and <Mono>e33</Mono>. Its child term{' '}
            <Mono>GOBP_CELL_CELL_ADHESION_MEDIATED_BY_CADHERIN</Mono> is tested in every cluster except
            COP, whose small universe leaves it below the 15-gene minimum.
          </P>
          <div style={{ overflowX: 'auto', margin: '4px 0 8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Cluster</th>
                  <th style={thStyle}>Universe (genes)</th>
                  <th style={thStyle}>Term size</th>
                  <th style={thStyle}>Outcome</th>
                  <th style={thStyle}>Child term size</th>
                </tr>
              </thead>
              <tbody>
                {EXAMPLE_ROWS.map((r) => (
                  <tr key={r.cluster}>
                    <td style={tdStyle}>{r.cluster}</td>
                    <td style={tdStyle}>{r.universe}</td>
                    <td style={tdStyle}>{r.size}</td>
                    <td style={{
                      ...tdStyle, fontFamily: FONT_SANS, fontWeight: 600,
                      color: r.dropped ? 'var(--color-obese)' : 'var(--color-normal)',
                    }}>
                      {r.outcome}
                    </td>
                    <td style={tdStyle}>{r.child}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_SANS, lineHeight: 1.5 }}>
            e33 drops the term with fewer detected genes than i15, which keeps it at 496. Across clusters
            that keep the term, several sizes sit just below the cutoff, at 477, 482, 496 and 497.
          </div>
        </Section>

        {/* 10. Glossary (formerly the Statistics page) */}
        <Section id="methods-glossary">
          <div style={{ overflowX: 'auto', margin: '4px 0 8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                    <td style={{ ...tdStyle, fontFamily: FONT_SANS, fontWeight: 600, whiteSpace: 'nowrap' }}>{g.term}</td>
                    <td style={{ ...tdStyle, fontFamily: FONT_MONO }}>{g.field}</td>
                    <td style={{ ...tdStyle, fontFamily: FONT_SANS }}>{g.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_SANS, lineHeight: 1.5 }}>
            Every gene and pathway statistic here is computed upstream in R (edgeR / limma for genes, fgsea for
            pathways, Benjamini–Hochberg within each dataset) and read out of that dataset&apos;s own bundle.
            The cross-dataset views display and arrange those numbers; they do not compute new ones.
          </div>
        </Section>
      </div>
    </PageShell>
  );
}
