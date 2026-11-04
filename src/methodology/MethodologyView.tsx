// Static methodology reference page (#/methodology). It is a page-level `view`
// like StatisticsView, not an explorer tab: it describes the whole collection,
// so it does not sit inside one dataset's explorer. Prose is written directly
// as JSX (the app has no markdown renderer).
//
// Order: collection-wide rules first (source data, DE, enrichment, units,
// verification), then the macaque snRNA-seq pipeline and its size-cap example.
// Studies differ, so per-study facts stay in Dataset info, not here.

import type { ReactNode } from 'react';

import { FONT_HEADING, FONT_SANS } from '../styles/constants';
import { PageShell } from '../common/PageShell';
import { H2, Mono, P, tdStyle, thStyle } from '../common/prose';
import { DEFAULT_FDR_CUTOFF } from '../statistics/policy';
import { METRIC_DEFAULT_SIG_THRESH } from '../explorer/explorerSession';

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
  { id: 'methods-verification', title: 'Data verification and evidence' },
  { id: 'methods-macaque', title: 'Macaque single-nucleus pipeline' },
  { id: 'methods-missing', title: 'Why some macaque pathways are missing' },
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
      breadcrumbs={[{ label: 'Methodology', current: true }]}
      mainStyle={{ overflowY: 'auto' }}
    >
      <div style={{ maxWidth: 720, width: '100%', margin: '0 auto', padding: '28px 24px 72px', boxSizing: 'border-box' }}>
        <h1 style={{
          fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', fontFamily: FONT_HEADING,
          letterSpacing: '-0.01em', margin: '0 0 12px',
        }}>
          Methodology
        </h1>

        <P>
          This page describes the rules that apply to every study in the collection, then the macaque
          single-nucleus pipeline in detail. Facts that differ by study, such as groups, replicates,
          expression unit and upstream processing, are listed in that study&apos;s Dataset info. The{' '}
          <a href="/methods/" style={linkStyle}>public Methods guide</a> covers source selection,
          comparison direction and replicate units; <a href="#/statistics" style={linkStyle}>Statistics</a>{' '}
          defines P values, FDR and significance stars; <a href="/how-to-cite/" style={linkStyle}>How to cite</a>{' '}
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
            workflow applies to every dataset.
          </P>
          <H3>Significance in the explorer</H3>
          <Ul>
            <Li>
              Cross-dataset reports, gene reports and comparisons call a gene or pathway significant when
              its Benjamini–Hochberg FDR (or fgsea adjusted P) is below {DEFAULT_FDR_CUTOFF}, with no
              fold-change cutoff.
            </Li>
            <Li>
              The volcano plot starts by highlighting raw P &lt; {volcanoP}; the threshold and metric can be
              changed in its controls. Significance stars on plots use raw P values, not FDR.
            </Li>
          </Ul>
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
            Dataset info and on chart axes and exports, before interpreting a value.
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

        {/* 5. Verification */}
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
      </div>
    </PageShell>
  );
}
