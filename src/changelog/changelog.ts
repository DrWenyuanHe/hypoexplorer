export interface ChangelogEntry {
  date: string;
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-10-26',
    title: 'Explorer navigation, Compare loading, downloads and gene picker',
    items: [
      'In Compare, a population that fails to load now says so and offers Retry, instead of showing "Loading…" forever. The other populations stay usable.',
      'Pathway, leading-edge, Compare, compare-set, circadian and local downloads now include the Metadata record that gene downloads already had: dataset, track, contrast, release and export settings. Their file names include the dataset, track and contrast, so downloads from different contrasts no longer overwrite each other.',
      'The Compare tab and the compare set now use the Gene Explorer\'s gene picker, including the "now X" note on genes stored under a retired symbol, read in each study\'s own nomenclature.',
      'The Quality control and Sources links on the home page open those tabs even when the explorer was last left in Compare. Before, Compare stayed on screen.',
      'A link to Compare now reopens Compare. Before, it opened the default population.',
      'Leaving Compare returns to the population and tab you entered it from. Before, it always opened the default population.',
      'Opening a study from the tracker while its explorer was in Compare now shows the study.',
      'Clicking the current population in a Quality Control table opens its Gene Explorer without clearing the selected genes.',
    ],
  },
  {
    date: '2026-10-19',
    title: 'OXT cell expression and rat SON salt loading',
    items: [
      'Added GSE65663: rat supraoptic nucleus after seven days of salt loading, with five independent pools of five rats per arm. Gene and pathway results use the deposited log2 RMA values. This is bulk SON tissue containing multiple cell types.',
      'The expression survey now includes GSE147092, with 125 magnocellular and 21 parvocellular OXT cell profiles. It preserves the deposited CENSUS expression estimates and reported animal or pool labels. Cell counts describe sampled profiles; they are not independent animal counts.',
      'Expression charts now show negative values and their error bars correctly for studies deposited on a relative log-expression scale.',
    ],
  },
  {
    date: '2026-09-26',
    title: 'All results recomputed under one R version',
    items: [
      'Every gene and pathway result was recomputed under R 4.6.0 with edgeR 4.10.1, limma 3.68.4 and fgsea 1.38.0. Earlier results came from two R versions, 4.4.1 and 4.6.0, and most were not stored with a record of the software that made them. Each result table now has one.',
      'Some values and significance calls changed. Across the bulk studies, genes at FDR < 0.05 went from 129,674 to 129,326 and significant pathways from 51,308 to 49,480. In the macaque atlas, genes at FDR < 0.05 went from 763 to 613, and no significant gene changed direction.',
      'When several features share one gene symbol, they are now combined before testing, instead of keeping the strongest row afterwards, but only when they are different gene IDs for the same gene or repeats of the same label. Features without a gene symbol stay in the analysis but are not shown.',
      'Labels that spreadsheets turned into dates, 1-Mar and 2-Mar, can mean MARCHF1/2 or MTARC1/2. They are now shown only when a gene ID, gene name or chromosome in the same row identifies the gene, which adds Mtarc1 or Mtarc2 to three studies and hides the labels in two. Labels such as Sep-01 now read Septin1 instead of Septin01.',
      'Fractional count estimates are no longer rounded before analysis. This changes five studies: GSE235479, E-MTAB-6929, GSE229838, GSE282067 and GSE205313.',
      'Sample values for count-based studies are now CPM (TMM-normalized), using the normalization factors of each study\'s own analysis, as the macaque atlas already was. Bulk studies previously showed CPM on raw library sizes, so their bar charts and exports change. Studies analysed from a deposited normalized matrix keep that matrix\'s unit.',
      'The macaque atlas now passes its normalization and model checks, which are refitted from pseudobulk counts that are now stored with the results. Two author-concordance checks, GSE201408 coverage and GSE298648 effect size, moved from passed to review, because author genes that match only unannotated features are no longer shown.',
      'Each study record shows Upstream processing: the aligner, genome build and annotation the depositor used, taken from the repository record. HypoExplorer starts from the depositors\' processed data and does not realign reads.',
      'GSE87544 is marked exploratory. Its design leaves one residual degree of freedom, and the new edgeR version finds 1 significant gene where the old one found 224, with nearly the same fold changes. Use its effect sizes and pathway ranks rather than its gene-level significance.',
    ],
  },
  {
    date: '2026-09-24',
    title: 'Reproducibility checks pass on a fresh copy',
    items: [
      'The checks that confirm the published verification evidence pass again on a fresh copy of the repository. Some evidence files had been stored with different line endings from the bytes their checksums describe, so the checks failed even though no evidence had changed. Those files now keep their exact recorded bytes.',
      'The check that each verification report came from its recorded pipeline had failed since the high-fat-diet studies were added on 12 September. It passes again, wherever the repository is stored and whichever shell runs it.',
      'No data, result or verification label changed.',
    ],
  },
  {
    date: '2026-09-18',
    title: 'Search dialogs and a mobile layout',
    items: [
      'Search genes and Search pathways on the home page open a search dialog over the current page, with the cursor in the search box. Close, Escape or a click outside returns you to where you were. Empty #/gene and #/pathway links open the same dialog, and the results page opens once you submit a search.',
      'On screens 900 px wide or narrower, the explorer cell list, the library filters and the compare-set study list open from a button as a dialog. Study details, verification and volcano settings fold into collapsible sections. Wide tables and the explorer tabs scroll sideways inside their own area.',
      'On phones 600 px wide or narrower, buttons and form controls are at least 44 px tall and inputs use 16 px text, which stops iOS Safari zooming in when a field is selected. In short desktop windows the explorer scrolls and keeps at least 440 px for the chart.',
      'Fixed tapping a volcano-plot point on a touch screen. A tap now adds the gene without a hover first.',
      'Fixed a volcano-plot click adding the last gene hovered instead of the gene under the pointer. Clicking or tapping empty space adds nothing.',
      'Search dialogs hide the page behind them from screen readers, and closing one returns keyboard focus to the button that opened it.',
      'On phones, choosing a cell or a compare-set study closes the list and shows the result. The selected cell survives a window resize, and an open list closes when the window widens past 900 px.',
      'Full-height pages fit the visible screen, so mobile browser toolbars no longer hide the bottom of the page. Gene suggestions no longer run off the edge of narrow screens.',
    ],
  },
  {
    date: '2026-09-17',
    title: 'Study filters, result previews and a simpler home page',
    items: [
      'Headings use Source Serif 4 and body text uses Source Sans 3, replacing IBM Plex Sans. Numbers and gene IDs stay in IBM Plex Mono.',
      'The home page lists the Expression survey as a fourth main tool, and Search genes and Search pathways buttons replace the inline search boxes and example chips. More tools no longer lists Compare populations, Compare datasets, Single-cell datasets, the GSE220533 diet comparison or the planned tools. Footer links are grouped under Explore, Analysis and Reference.',
      'The Gene and Pathway Explorer search pages replace the example chips and six gene shortcuts with study filters: an All datasets card, 11 category cards with study counts, a Larger groups filter for studies with at least 5 samples in each group of the default comparison, and filters for studies that passed Pipeline QC, Experimental design or Author concordance. The study picker adds Select all and Clear selection. Pathway Explorer lists only studies with pathway results. Searches download data for the selected studies only.',
      'Each study row in gene and pathway results has More information, which opens its library record, Open, and a compare-set button. Source links and citations moved into More information. Hovering, focusing or tapping a fold change shows that study\'s bar chart for the exact comparison. Doing the same on an NES shows an approximate running enrichment-score plot built from the leading-edge genes.',
      'Pathway results can collapse categories and studies. Studies with more than three tracks show only their significant tracks until you choose Show all. Track IDs open that track\'s Pathway tab, and the NES axis is no longer capped at ±3.',
      'In the compare set, each study in the sidebar has a remove button, its comparison label, download progress and a Details section with sample counts, organism, verification and Open in explorer. The expression survey starts with an empty gene box, shows export and display controls once a survey runs, and keeps interpretation notes in a collapsed section below the results.',
      'Fixed unticking the last study in the study picker widening the search to every dataset. The search now stays empty and says no datasets match. The selected-study count includes only studies visible under the current filters.',
      'With a sample-size filter on, results wait for the sample counts instead of first running on unfiltered studies. Study filters are kept when you search for another gene or pathway.',
      'Result previews open from the keyboard or a tap as well as on hover, and close with Escape, on scroll or on a click outside. A compare-set study that fails to load shows why, and a missing track reads as not in this dataset.',
      'The low-sample warning on gene result rows moved into More information with the source links.',
    ],
  },
  {
    date: '2026-09-16',
    title: 'A consistent HypoExplorer identity',
    items: [
      'A new brain-and-wordmark logo appears across the explorer, library, tracker and public information pages. Clicking it returns to the home page.',
      'Browser tabs and installed shortcuts use the matching brain icon.',
    ],
  },
  {
    date: '2026-09-15',
    title: 'Expression survey and result bars in the library',
    items: [
      'The new Expression survey at #/expression shows per-sample expression of a gene across hypothalamic populations, isolated neurons and bulk tissue from NeuroSeq and 31 curated sources. Its sections are Gene survey, Population catalog, Tissue & bulk, and Sources & validation. Each source keeps its own measurement scale, RNA fraction and condition. The survey does not average across studies and does not report differential expression.',
      'Survey queries read a dedicated gene index. For Igf1r across four whole-hypothalamus studies, a query downloads about 62 KB instead of about 4.9 MB, estimated from local compressed sizes. Validation found no numerical difference from the full data files.',
      'Library study cards show result bars: the genes and pathways reaching FDR 0.05 on the default track, split into up and down, with the number tested. Hover or focus a bar for details. A study with no significant results reads as none at FDR 0.05, and a study without pathway results says so.',
      'The library can sort by Genes found (most first), and the replicate filter offers n ≥ 3, 4, 6 or 10 per arm.',
      'The files that point to the latest search and expression indexes now refresh within 5 minutes instead of 4 hours, so new data reaches returning visitors sooner.',
    ],
  },
  {
    date: '2026-09-14',
    title: 'Clearer wording and self-hosted fonts',
    items: [
      'Text across the explorer, reference pages, tracker and public study pages was rewritten to state the action or result directly. Accessions, identifiers, evidence records, data values and statistical thresholds are unchanged.',
      'Corrected descriptions that called every exported value CPM, described searches as instant, or described the collection as macaque and mouse only. The Benjamini-Yekutieli help text now states its multiplier, about 10.2 at 15,000 tests.',
      'Fonts are served from the site instead of Google Fonts. Some home page text and accent colours are darker. Links to the home page shared on social media now show a preview image.',
      'Fixed Pathway Explorer clearing its category selection when a search was submitted.',
    ],
  },
  {
    date: '2026-09-12',
    title: 'Two high-fat-diet studies and clearer study records',
    items: [
      'Two high-fat-diet studies bring the collection to 161: mouse ventral hypothalamus after chronic 45%-fat feeding (GSE104709, five RNA pools per arm), and rat neonatal hypothalamus at postnatal day 10 after maternal high-fat diet (GSE107324), with separate male and female tracks. Both include pathway results, source records and author comparisons.',
      'Study records open with a verification summary, then the study facts grouped as Comparison, Sample, Measurement and Source, then the full verification report in a collapsed section. The arms shown belong to the default comparison.',
      'The Internal QC label is split into three labels and filters in the library and tracker: Pipeline QC, Experimental design, which covers biological replication and sample support, and Author concordance. A passing pipeline result no longer implies that it reproduces the authors\' analysis.',
      'Fixed keyboard navigation in study dialogs. Tab no longer reaches links inside collapsed sections or leaves the dialog through a quality checklist, collapsed sections open from the keyboard, and Escape closes an open checklist before the record.',
      'GSE314184, one of the studies listed as mouse on 8 September, is relabelled as African striped mouse (Rhabdomys pumilio). Its processing used laboratory-mouse gene annotation and pathway sets, and the study record flags that cross-species mapping for review.',
      'Fixed study records that showed no limitations for an unresolved verification with no review flags, so it read as clean. They now explain what remains unresolved.',
    ],
  },
  {
    date: '2026-09-08',
    title: '14 more studies, local datasets and quality checklists',
    items: [
      'Fourteen studies bring the collection to 159: 13 mouse and 1 rat. They cover sleep rebound in the PVN, SRC-1 deletion, hypertension in the rat PVN, the SCN response to light, acute and chronic colitis, preoptic isoflurane exposure, arcuate responses to diet and glucose, parental behaviour in the MPOA, preoptic sex differences, Gough Island mice, POMC responses to food cues, the TN-783 compound in diet-induced obesity, and cancer cachexia. Replicates are counted by animal or independent pool, so 18 mice pooled into 6 samples count as 6.',
      'The new Local datasets workspace at #/local-datasets explores your own differential-expression and pathway tables. Import CSV, TSV, text, Excel or ODS files, or paste a table, then confirm the suggested column matches. It offers a volcano plot, gene and pathway tables with cutoffs, and gene-to-pathway links through leading-edge genes, and it can follow a gene or pathway across your saved datasets of the same species. You can also add a public HypoExplorer comparison beside your own. Files stay in your browser and are never uploaded. Clearing site data or using private browsing can delete them.',
      'Each study has an Internal QC badge and an Author concordance badge, with a checklist that opens on hover, focus or tap. Internal QC covers 13 checks, from source-file integrity to recorded analysis completion. Author concordance passes when at least 30 genes match with 90% coverage and either Pearson and Spearman correlations both reach 0.9 or at least 90% of genes agree in direction. The badges appear in the library, tracker, explorer header, QC tab and verification page, and the library and tracker can filter by both. The verification page now explains how the checks work.',
      'Replicate descriptions were corrected for 20 studies. Where independence between samples is not established, the record says so, and where the unit is a litter or pool, it names that unit.',
      'GSE156859 and GSE153498 moved from pass to review for author concordance because their comparison uses a different effect estimator from the authors\'.',
      'Library cards hide replicate and feature counts when the catalog comes from a different data build than the study files.',
    ],
  },
  {
    date: '2026-09-05',
    title: 'Author-result verification and public study pages',
    items: [
      'Every study has a verification record, explained at #/verification, stating what was compared with the authors\' own results. Labels range from fully verified to no comparison evidence, with separate labels for unresolved reviews, work in progress and the macaque atlas, which is outside verification scope. Each record names the compared result, the author reference and the acceptance criteria. The claim covers a named comparison, not every gene and pathway shown. The same record appears on library cards, tracker rows, explorer headers, cross-dataset reports and the compare set, and the library and tracker can filter by it.',
      'For studies with more than two groups, the pathway detail panel can show all design groups or the selected comparison, with a table of NES, FDR and p-values for each registered comparison. The Excel export adds a PathwayComparisons sheet.',
      'A sortable table of the plotted genes appears under the Gene Explorer volcano plot.',
      'Each of the 145 studies has a public page that loads without the app, alongside a studies index, six topic pages, and methods, citation and about pages. Each page links to the source record and publication.',
      'Every page notes that the explorer is in beta and that results should be checked against the source publication.',
      'Pathway detail headers name the comparison that the leading-edge genes and logFC values belong to. Export titles say values instead of CPM for studies not measured in counts.',
      'Fixed cross-dataset gene lookups downloading about 280 MB each on the live site. The previous build looked for the search index on the wrong host and fell back to loading every track.',
      'Fixed public study pages that could show the title and authors of one paper beside the DOI of another when a PubMed record did not match the study. A mismatched record is now dropped and the study\'s own citation is shown. A study can no longer be labelled as having author results compared when no comparison was made.',
      'Installing the app no longer downloads every public study page, and a missing study page shows its own not-found page instead of the app.',
      'The data host accepts only data file paths and limits requests per network address and per day, to protect it from abuse. Normal browsing stays well within these limits.',
      'The Methodology page states that its pathway size-filtering explanation applies to the macaque atlas, and that a pathway removed by the filter is not thereby shown to lack biological relevance.',
    ],
  },
  {
    date: '2026-09-04',
    title: 'All conditions in one chart and a y-axis scale',
    items: [
      'For studies with more than two groups, the Gene Explorer bar-chart pop-up can switch between the active comparison and all conditions on one axis. Each comparison has its own bracket and p-value, hovering shows its logFC, P and FDR, and the CSV and Excel exports follow the chart shown.',
      'Bar charts in the Gene Explorer, Compare, the Pathway Explorer leading-edge grid and cross-dataset compare offer an As deposited, Linear or log₂ y-axis. The browser remembers the choice. A chart that cannot use the chosen scale keeps its original scale and is marked with a dagger. Exports keep the original values.',
      'Each row on the Gene nomenclature page links to its record at HGNC, MGI, RGD or NCBI Gene.',
      'The site moved from Hostinger to Cloudflare. Older copies of the app that still request data from the site\'s own address are redirected to the data host, so they keep working until they update.',
    ],
  },
  {
    date: '2026-09-03',
    title: 'Corrected study labels and rebuilt pathway results',
    items: [
      'Corrected four study descriptions. GSE314029 tests a GLP-1/GIP dual agonist, not a GLP-1 agonist. GSE247825 is labelled as a pooled 14- and 17-day overfeeding effect and GSE285006 as a dnFGFR genotype effect pooled across housing arms, and both are marked exploratory. GSE282067 is described as BL/6 Treg pools, distinct from the paper\'s BALB/c cohort. GSE124693 gained its DOI and PubMed link.',
      'Four studies were re-analysed from corrected inputs. GSE252779 uses edgeR on the integer count sheet instead of limma on log2 FPKM. GSE87544 uses the 7 author-defined units, giving 4 controls instead of 5. GSE174085 moves batch L13 from the control group to the early-life adversity group, following the authors\' table. GSE143818 uses only the authors\' 467 selected VMH cells.',
      'Pathway results for 144 studies, every study except the macaque atlas, were recomputed after fixing a cache that let earlier gene-set collections restrict later GO, KEGG and Reactome lookups. Each collection now uses a fixed random seed. Across all comparisons and collections, 13,070 pathway results at FDR < 0.05 were gained and 7,891 were lost.',
      'Library cards, the library table and the tracker gained an author-validation badge and filter. The verification records of 5 September replaced them.',
    ],
  },
  {
    date: '2026-09-01',
    title: 'Compare set, gene lists and no pooled statistics',
    items: [
      'Cross-dataset reports no longer calculate pooled effects, pooled p-values, cross-dataset q-values or I². The collection spans eleven species, several assay types and many perturbations, so a pooled number would average different questions. Each study keeps its own log2FC and 95% interval on a shared axis. A new Statistics section explains why there is no pooled number, and counts such as "significant in N of M" are labelled as a tally, not a test.',
      'The new compare set holds up to 12 studies or tracks. Add them from library cards, the library table, study records or the explorer top bar, which adds the active track, such as one macaque population. Compare two or more side by side with volcano plots, gene and pathway tables, bar charts and an Excel export. The set is saved in your browser. A link to the view shares a snapshot without changing the recipient\'s own set.',
      'Load list imports genes from text, CSV, TSV, Excel, GMT or JSON files, or pasted text. Before selecting anything, it reports which names matched, which matched under another name, which were left out as ambiguous aliases and which the dataset lacks. Save list exports the selection as text, CSV or Excel, and the volcano plot can save the genes passing its thresholds.',
      'Updates are now required. When a new version is available, the app counts down 10 seconds and reloads, and Reload now skips the wait. Open tabs check for updates every 15 minutes and when they return to view.',
      'The home page shows each main tool as a row with its own control. A header light reports whether the data host is online, unreachable or offline.',
    ],
  },
  {
    date: '2026-09-01',
    title: '86 more studies and nine more species',
    items: [
      'The collection grows from 59 studies to 145 and from two species to eleven. Rat, pig, human, chicken, Djungarian hamster, cattle, zebrafish, rhesus macaque and garden dormouse join mouse and the macaque atlas. The new studies cover torpor in dormouse and hamster, photoperiod in hamster tanycytes, chicken feed efficiency, maternal immune activation in two pig cohorts, and cattle nutritional restriction. Each added study has at least three animals per arm. The largest compares high-fat and low-fat diets across 391 outbred rats.',
      'Microbiome and gut-brain axis becomes the eleventh category. Microbial interventions were previously grouped with diet studies. Separating them keeps comparisons such as gut colonisation under a shared fructose diet out of a high-fat-versus-chow pooled result.',
      'Library filters now include lateral hypothalamus and supraoptic nucleus, microbiome and sex perturbations, and single-cell, spatial-spot and cell-culture preparations. Study cards identify the preparation so readers can distinguish these assays from bulk dissections.',
      'Gene nomenclature covers all eleven species using eight sources: HGNC, MGI, RGD, its retired-symbol list, and NCBI Gene records for chicken, zebrafish, pig and cattle. The table has 200,806 rows. The sources file identifies three species without their own nomenclature authority.',
      'Fixed gene search retaining suggestions from the previous study when both studies shared a track name. Pressing Enter could select a gene from the study you had left. Also fixed nomenclature counts including species absent from the displayed table when an older cached app loaded newer nomenclature data.',
      'Expression values in 41 existing studies change by up to about 1 percent. The symbol update changed the features counted toward library size, so normalisation was recomputed. Fold changes and p-values are unchanged, and no study gained or lost a gene.',
      'Gene search resolves aliases and previous symbols with the nomenclature of the open study\'s species. Across eleven species, 24,316 symbols share a spelling between authorities, so the cross-dataset picker no longer guesses which gene an ambiguous alias means.',
    ],
  },
  {
    date: '2026-08-31',
    title: 'Clearer data errors and one PubMed link per study',
    items: [
      'When study data fails to load, the explorer checks whether your browser can reach the data host. If it cannot, the message says so, lists likely causes such as a network or firewall blocking the data address, says that no data is lost, and links the hosting provider\'s status page. Previously it said only "Failed to load".',
      'Each study shows its PubMed ID once, as a link. 24 citations had repeated the ID as plain text beside the link. Searching the library for a PMID still finds the study.',
    ],
  },
  {
    date: '2026-08-30',
    title: 'Gene aliases, previous symbols and aging studies',
    items: [
      'Three aging studies bring the collection to 59. The new Aging category includes direct age comparisons and excludes treatments tested only in aged animals. One study compares 22 months with 12 weeks. Two compare 27 months with 6 months, including a multi-tissue atlas and a circadian study whose age effect averages over a full day. All three have pathway enrichment and per-gene standard errors for pooled meta-analysis. The library adds an Aging theme, and an Aging shortcut in gene search opens IGF1.',
      'Gene search now matches current symbols, previous symbols and aliases when the nomenclature table contains a matching record. Suggestions explain the match. For example, the macaque atlas stores AARS, which HGNC replaced with AARS1. Both names now find the stored gene. Previously, searching AARS1 returned no result.',
      'A new Aliases button beside the search box lists every alias and previous symbol next to each suggestion, so AGRP reads as AGRP · Agrt, ART, ASIP2.',
      'Selected-gene chips identify retired symbols. For example, AARS shows a "now AARS1" marker.',
      'The new Gene nomenclature page lists all 65,709 stored symbols, including 3,570 that an authority has replaced. Mouse records use MGI. The macaque atlas uses HGNC because its upstream analysis mapped features to human orthologs. Search by symbol, alias, previous symbol or gene name, filter by status, and export to Excel. A versioned tab-separated table is available in the repository for citation and comparison.',
      'Bar charts and Summary table appear in the toolbar as soon as a study opens. With no genes selected, each view shows search instructions and a search box. Across comparisons appears only for studies with more than one comparison.',
      'Exact matches are listed first in gene suggestions. A prefix match could previously push an exact match down the list.',
      'A network error at the first gene search no longer turns off alias matching for the rest of the session. The nomenclature page no longer re-sorts all 65,709 rows on each keystroke, its status labels meet WCAG AA contrast, and a symbol split into two genes reads "now A / B".',
    ],
  },
  {
    date: '2026-08-29',
    title: '13 more studies and faster cross-dataset comparison',
    items: [
      'Thirteen mouse studies bring the collection to 56. All have pathway enrichment, making every study searchable by gene and pathway. Four cover fasting and feeding, including 16-hour and 18-hour fasts and an AGRP-neuron fed-versus-fasted series. Three test drugs: a GLP-1 mono-agonist, Gly-Low and CCK-8s in oxytocin neurons. Four use genetic or disease models: Abi3 knockout, Ube3a duplication, muscle COX10 knockout and pituitary stalk lesion. The remaining two examine hypothalamic astrocytes under high-fat high-sucrose feeding and VMHvl under estradiol. VMHvl becomes the tenth library region.',
      'Gene Explorer and Pathway Explorer each have a landing page with search, physiological-signal shortcuts, category filters and a study picker. Searches retain the selected scope. Each page has its own URL, so you can share a selection such as circadian studies before entering a gene.',
      'Cross-dataset reports now accept individual study selections as well as categories. The pooled-effect diamond uses only the displayed studies, and cross-dataset q-values are corrected across the categories included in the report.',
      'Cross-dataset gene bar charts now load in four requests using less than a megabyte. Previously they downloaded full studies, using 148 MB over 43 requests, or an estimated 178 MB over 56 for the expanded collection. If the precomputed index is missing or fails validation for any study, the view loads the full data for complete coverage.',
      'All sortable tables now support keyboard sorting. Screen readers announce the active sort column and direction.',
      'Removed the age-adjusted diet comparison from GSE135639. Four comparisons remain, with the weaning-age diet effect as the default. The removed model assumed no age-by-diet interaction and could obscure an age-specific effect. No gene reached FDR < 0.05 in that model, compared with 21 at weaning and 9 at birth.',
      'Fixed overstated replicate counts for GSE135639. Cards and study records showed "8 Chow · P21 vs 9 HFD · P21" for groups of 3 and 4. They now use the selected comparison\'s group counts. No other study was affected.',
      'Cross-dataset gene and pathway reports, and library cards, check that the search index describes the selected comparison before using it, and otherwise load the full data.',
      'Data builds now stop on a table with row names, which would have shifted every sample value by one column. All 54 configured inputs passed the new check, so no published value changed.',
    ],
  },
  {
    date: '2026-08-28',
    title: 'Links for each view and library browsing by theme',
    items: [
      'Navigation now updates the URL across all eight views. You can share or bookmark a view, dataset, cell population or tab, and return to it with the browser Back button. Previously, links worked on initial load but navigation did not update the address.',
      'Dataset-library category filters are included in the URL. Shared links open the filtered list, and Back restores the previous selection.',
      'The library groups its nine categories into browse themes. Category definitions, filter values and meta-analysis strata are unchanged. The themes make a list with uneven category sizes, such as eleven studies in one category and one in another, easier to browse.',
      'The facet rail now scrolls on its own instead of sliding away with the results, and a study record opens as a centred modal rather than a narrow right-edge drawer. Escape or a click outside closes it, and focus returns to the card you opened it from.',
      'Homepage section links open their matching studies. "Physiology & signaling" opens the 17 studies searched by its rows, and "Data coverage" opens all 43. Removed section descriptions that repeated the row labels.',
      'On the home page, Cross-model is renamed WT vs KO and Apelin signaling is removed.',
      'QC report PDFs load from the data host with the other data files, and their download link opens in a new tab instead of replacing the app.',
    ],
  },
  {
    date: '2026-08-27',
    title: 'Five comparisons for the POMC 2×2 design',
    items: [
      'GSE135639 measures POMC-neuron RiboTag RNA in offspring of chow-fed or high-fat-diet dams at birth, P0, and weaning, P21. The 2×2 design now offers five comparisons in the header: the age-adjusted diet effect, diet effects at each age, and P0→P21 maturation within each diet. Previously, only the diet effect averaged across ages was available.',
      'The averaged diet comparison finds no gene at FDR < 0.05. The weaning comparison finds 21 and the birth comparison finds 9. For example, Timp1 is flat at birth and strongly up at weaning, a pattern obscured by the averaged effect.',
      'A new "Across comparisons" button in the Gene Explorer puts your selected genes in one table with a column per comparison, so you can read a gene across all five at once instead of switching back and forth. It downloads as CSV.',
      'The header group labels, replicate counts and volcano axis follow the selected comparison. At weaning, the counts are 3 vs 4 rather than the pooled 8 vs 9. Each of the five comparisons has its own pathway enrichment.',
      'The "exploratory contrast" warning marks comparisons absent from the source study. Here it applies to the three diet comparisons. The two maturation comparisons refit the published comparison and are not marked exploratory. Previously, any comparison with an explanatory note received the warning.',
    ],
  },
  {
    date: '2026-08-27',
    title: 'Dataset library and corrected pooling weights',
    items: [
      'The new dataset library at #/library replaces the dataset dropdown. Filter studies by region, perturbation and preparation, and see each study\'s groups and replicate counts before opening it. A study bar in the explorer names the open study.',
      'Developmental programming becomes the ninth category, for studies that expose the mother and profile the offspring. GSE135639, POMC-neuron translatomes from offspring of chow- or high-fat-fed dams, joins it and brings the collection to 43.',
      'Corrected GSE162744, which was described as a maternal low- versus high-protein diet study. It is a maternal obesity study: in GEO\'s LP and HP labels, L and H stand for low- and high-fat diet and P for the postnatal PBS injection. The comparison was always correct; only its names were wrong.',
      'Corrected the standard errors that edgeR studies contributed to pooled cross-dataset estimates. They came from a statistic that is not a Wald test and were a median 25% too small, so each edgeR study carried about 1.8 times its proper weight against limma studies. 39 of 40 edgeR studies now use a refitted Wald standard error. GSE292416 and the macaque atlas could not be refitted and no longer enter pooled estimates, though their own results still display.',
      'Fixed the live site sending track files about 26% larger than necessary, because the precompressed copies had not been uploaded.',
      'Fixed the Dataset Tracker lagging a release behind the explorer. It showed GSE135639 as not yet included and GSE162744 under its old protein-diet title.',
    ],
  },
  {
    date: '2026-08-27',
    title: 'Circadian rhythm tests',
    items: [
      'The new Circadian tab tests daily rhythms with JTK_CYCLE, COSINOR and Lomb-Scargle in the browser. Choose the test, group, multiple-testing correction and either a 24 h period or a 20 to 28 h scan. Changing the correction re-ranks results immediately. Changing the test reruns the analysis in under a second.',
      'Five correction options are available: Benjamini-Hochberg, Benjamini-Yekutieli, Holm, Bonferroni or none. Each states its assumptions. Across roughly 15,000 genes, the correction can substantially change which results meet the threshold.',
      'A gene rhythm trace shows mean ± SEM, individual libraries, the fitted cosine curve and a light/dark bar, with an optional double-plot. A phase map places rhythmic genes at their peak hour on a 24-hour clock. The searchable, sortable table includes every gene. Download results, per-library values or a workbook with the analysis settings.',
      'Restored sampling times for three datasets whose time courses had been collapsed during import. The SCN diet series previously included only CT0, or 6 of 36 libraries. The arcuate clock-knockout series averaged four collection times into one comparison. Each library now retains its timepoint.',
      'Added GSE157077, mouse SCN under chow or high-fat diet, with 36 libraries sampled every 4 hours over a full day. It is the first dataset in the collection to combine a full circadian time course with an obesity comparison, bringing the total to 42.',
      'The tab warns when too few timepoints limit JTK power or constrain the smallest p-value Lomb-Scargle can report. These method limits must be considered when interpreting a rhythm result.',
    ],
  },
  {
    date: '2026-08-25',
    title: 'Smaller data files and two plot fixes',
    items: [
      'Data files are smaller. Values stored beyond the precision the app uses were trimmed and three unused fields removed, reducing the collection from 385 MB to 326 MB. A check of 1,319,978 gene rows and 377,148 pathway rows found no change to any significance call or to gene order.',
      'Data files are served precompressed. A track that downloaded as 2.5 MB now downloads as about 440 KB.',
      'Fixed genes with an unknown FDR appearing at the top of the volcano plot\'s FDR axis. They now plot at 0.',
      'Fixed the GSEA running-score plot counting leading-edge genes absent from the gene table as misses, which distorted each miss step.',
    ],
  },
  {
    date: '2026-08-19',
    title: 'One format for p-values and q-values',
    items: [
      'Every p-value and q-value follows one display rule: two significant figures in exponential form below 0.001, and three decimals at or above it. The FDR column previously showed "< 0.001" for every smaller value, hiding the order of 5,309 q-values. A value too small to store shows "< 1e-300". Exports keep full precision.',
      'The sidebar filter stays when you pick a track, so you can open several matches from one filtered list. It still clears when you switch datasets.',
      'Header arm pills use their group colour, unrecognised pathway databases show a visible badge, and reprocessed data gets new search-index addresses so cached searches cannot show old numbers.',
      'Force refresh also clears cached search-index files, which could otherwise keep serving old numbers.',
    ],
  },
  {
    date: '2026-08-18',
    title: 'Faster search and fixes for comparisons and exports',
    items: [
      'Cross-dataset gene and pathway search now reads a prebuilt index, downloading about 98 KB in two requests and returning results in roughly a quarter of a second. Previously it loaded about 285 MB of full datasets over about 10 seconds. The homepage loads about 8× less data and renders before data scripts finish. Index significance calls were checked against the source to prevent rounding from changing an FDR < 0.05 classification.',
      'Fixed Compare charts falling back to the macaque atlas comparison and showing the wrong contrast. Chart inputs now require the selected dataset and comparison.',
      'CSV and Excel exports now read column units from the same dataset record, preventing expression values on other scales from being labelled CPM.',
      'Old bookmarks no longer cause errors. The app ignores unknown dataset IDs and uses the default track when a linked track no longer exists.',
      'Pathway tables now return to page 1 after filters change. Fixed service-worker errors on non-API requests and 404 errors when loading data bundles from a separate storage origin.',
      'Fixed a loading overlay that could stay over the explorer after you switched, mid-load, to another dataset with the same track name, and a "Failed to load" banner from a dataset you had left staying on screen.',
      'A single network error while loading the search index no longer sends every later search in the session to the slow full download. Pathway rows with a missing raw p-value are dropped from index results instead of showing as p = 0.',
      'Pathway details reset their gene view when you choose another pathway. Cross-dataset Compare loads up to 8 tracks at a time instead of all 41 at once.',
      'The sidebar search box has its keyboard focus ring back, and heterogeneity warnings use amber instead of the red that marks up-regulated genes.',
    ],
  },
  {
    date: '2026-06-25',
    title: 'Cross-dataset search and pooled meta-analysis',
    items: [
      'Cross-dataset search shows a gene or pathway across the collection. Reports pool each model category, such as diet-induced obesity or fasting, into a random-effects estimate with a 95% interval, I² and a cross-dataset q-value. The macaque atlas counts as one study. Its sixty populations share six animals, so the report shows a combined effect and cell-type spread while withholding pooled p-values, q-values and intervals that would overstate precision.',
      'Compare shows per-dataset expression in side-by-side bar charts. The Pathway report shows NES and significance across datasets with pathway results. Mouse high-fat-diet studies now include enrichment, allowing mouse and macaque pathways to be matched by MSigDB names.',
      'The new Statistics page explains per-dataset tests and pooled statistics. Its glossary covers log2FC, FDR, NES, pooled log2FC, I² and cross-dataset q-values.',
      'The cross-dataset report and the Compare table now show both the raw p-value and the FDR together, so you can see where the two disagree.',
      'Data bundles now include per-gene standard errors for meta-analysis. Pathway results load in smaller files, which can also be served from a separate storage origin.',
      'Fixed pipeline issues found during verification, including missing pathway values leaking into results. A study whose analysis method is not recorded gets no standard error, instead of one computed with the edgeR formula. Help text now says cross-dataset q-values are corrected across the categories other than the macaque atlas, not across all categories.',
      'Pooled statistics were removed on 1 September 2026. See that entry.',
    ],
  },
  {
    date: '2026-06-21',
    title: '41 datasets, research themes and source records',
    items: [
      'The explorer has 41 hypothalamus datasets across 8 themes: diet-induced obesity, feeding & fasting, leptin/insulin & energy signaling, incretin & pharmacology, reproduction & development, circadian, stress/immune/disease, and the macaque atlas. The dataset picker, homepage and cross-dataset "Explore all" report group studies by theme. Explore all can be filtered to one theme. The homepage Insulin, Leptin, Feeding and Inflammatory tiles open gene reports with those study selections.',
      'The new "Dataset info" button opens the active study\'s organism, assay, expression unit, groups, replicate counts, comparisons, populations and citation. Source links open NCBI GEO or EBI ArrayExpress, the paper DOI and PubMed. The same links appear in cross-dataset reports and the Data Sources tab.',
      'The Quality Control tab now lists the exact replicate sample ids used by each track, including any that QC dropped, and the header replicate counts show those ids on hover.',
      'The app moved to TypeScript. Gene IDs now use standardised symbols, and dialogs manage keyboard focus.',
      'The new Dataset Tracker, linked from the home page, lists candidate hypothalamus datasets and their review status.',
      'A study can offer more than one comparison, chosen from a selector in the header. Replicate counts follow the selected comparison, and comparison descriptions appear on hover.',
      'Fixed Explore all opening with its category collapsed when limited to one theme.',
    ],
  },
  {
    date: '2026-06-15',
    title: 'Version badge and force refresh',
    items: [
      'The app header now shows which version you are running, next to the Changelog button, so you can check which build is live.',
      'Click the version badge for "force refresh". It clears cached app files and reloads from the server when an older version persists after an upgrade. This can resolve failed track loads caused by a cached app requesting files that have moved.',
    ],
  },
  {
    date: '2026-06-13',
    title: 'Two mouse HFD hypothalamus datasets added',
    items: [
      'Two mouse bulk RNA-seq studies join the macaque single-nucleus atlas. Both compare chow and HFD: whole hypothalamus from Garrett et al., GSE220533, and arcuate nucleus from Ritter & Grobe, GSE225038, PMID 38145289. Choose a dataset from the top-left dropdown.',
      'Each dataset has a chow-versus-HFD volcano plot, gene search, gene-expression bar charts and CSV/Excel export. Sample counts are 7 vs 8 for whole hypothalamus and 3 vs 4 for arcuate nucleus. Pathway Explorer is hidden because these studies do not yet have pathway enrichment. Gene Explorer is available.',
    ],
  },
  {
    date: '2026-06-13',
    title: 'Support for multiple datasets',
    items: [
      'The explorer now supports multiple datasets, with a record for each organism, assay, feature type, pathway availability, citation, group and comparison. The breadcrumb identifies the active dataset.',
      'Expression views now use each dataset\'s group labels and sample membership instead of assuming 3 Normal + 3 Obese samples. This supports other designs, including high-fat diet versus chow and fasted versus fed. Pathway views hide for assays without enrichment, such as miRNA arrays.',
      'Macaque data moved to /datasets/macaque_snrna/. Equivalence checks confirmed that the population data and results are unchanged. The previous file locations remain supported.',
      'Switching datasets opens the new dataset\'s default track and keeps your significance and fold-change cutoffs.',
      'Fixed a blank Pathway tab after switching to a dataset without pathway results. The Gene Explorer opens instead.',
      'Fixed the QC low-power flag, which looked for a 3 vs 3 design instead of any group smaller than 3.',
      'The volcano plot stays sharp on high-resolution and zoomed displays and shows a message when it has no points. A dataset whose information or QC fails to load shows a banner with a retry button instead of an empty sidebar. Replicate counts show a placeholder while loading instead of a misleading 3.',
    ],
  },
  {
    date: '2026-06-12',
    title: 'Data sources and acknowledgements',
    items: [
      'The new Data Sources & Acknowledgements tab credits the macaque hypothalamus single-nucleus study reanalysed here, Lei et al., Cell Metabolism 2024. It also lists edgeR, fgsea, GSEA, MSigDB/Hallmark, Reactome, KEGG, Gene Ontology and Seurat, with DOI links checked against PubMed.',
    ],
  },
  {
    date: '2026-06-11',
    title: 'Loading indicators and responsive layout',
    items: [
      'Excel and CSV exports show a progress spinner. Charts and tables appear as their data loads, and empty views explain why no results are shown.',
      'The sidebar, charts and tables adapt to smaller laptop windows and wider monitors.',
      'Standardised spacing and adjusted transitions between tabs.',
    ],
  },
  {
    date: '2026-06-11',
    title: 'Nature-style bar charts',
    items: [
      'Gene-expression bar charts in Gene Explorer, Compare and Pathway Explorer leading-edge grids use a style based on Nature journal figures. Normal bars are muted blue and Obese bars are muted red, with thin near-black edges and an L-shaped axis. Numerals use a proportional sans-serif font. SEM bars are heavier and black, and darker sample dots improve contrast.',
    ],
  },
  {
    date: '2026-06-10',
    title: 'Non-neuronal cell types added',
    items: [
      'DE and FGSEA results now include 15 previously omitted non-neuronal populations: astrocytes, oligodendrocytes, OPC, COP, microglia, endothelial, ependymal, fibroblasts and tanycytes. Find them under "Non-neuronal" in the cell sidebar and Compare picker.',
      'Populations below the minimum cell and sample thresholds are listed as failed.',
    ],
  },
  {
    date: '2026-06-10',
    title: 'Methodology tab',
    items: [
      'The new Methodology tab explains edgeR quasi-likelihood differential expression and fgsea enrichment against Hallmark, KEGG, GO:BP and Reactome. It also explains gene-set size filtering to [15, 500]. Broad GO terms can exceed the 500-gene cap in clusters that detect more genes and therefore disappear from the results. GOBP_CELL_CELL_ADHESION provides a worked example.',
    ],
  },
  {
    date: '2026-06-09',
    title: 'Update prompts and gene exports',
    items: [
      'The app prompts you to reload when a new version is available.',
      'Bar charts and the gene summary table now open in modal pop-ups, with CSV, Excel, and PNG export. The CSV export now covers raw per-sample values.',
    ],
  },
  {
    date: '2026-04-24',
    title: 'Accessibility and code checks',
    items: [
      'Volcano, NES comparison, heatmap, running-score and leading-edge charts now have image roles and labels. Interactive controls have explicit button types, and gene-search suggestions use buttons.',
      'Added Biome for linting and formatting, and knip for unused-code detection. The source passed lint with 0 errors and 0 warnings.',
    ],
  },
  {
    date: '2026-04-20',
    title: 'Compare tab redesign',
    items: [
      'The cell selector opens a modal grouped by neurotransmitter type, with search, colour dots, full marker names and shortcuts for selecting all cells or a group. It replaces the flat row of cell-ID checkboxes. Selected cells appear as removable coloured chips.',
      'Pathway detail opens as an inline accordion row directly beneath the pathway, with the NES bar chart and per-population stats side by side. The old right-side panel had taken about 45% of the width.',
      'NES bars use the population colour for FDR < 0.05 and muted grey for FDR ≥ 0.05.',
      'Clicking the HypoExplorer logo returns home, and the "Compare all cells" toggle moved to the top of the sidebar.',
    ],
  },
  {
    date: '2026-04-20',
    title: 'Cached-data fix',
    items: [
      'Fixed the browser loading stale data after an upgrade, such as 6-cell data in the 45-cell interface. Data files now carry version identifiers and are revalidated after deployment.',
    ],
  },
  {
    date: '2026-04-19',
    title: 'Left-sidebar cell navigator',
    items: [
      'A 232px left sidebar replaces the roughly 1400px horizontal row of 45 populations. It groups cells by neurotransmitter type and shows group counts, the active cell and a flag for 2v3 designs.',
      'Sidebar cell search filters all populations instantly by id, marker gene, or type.',
      'The header fits on one row, giving the volcano plot about 80 px more height, and its condition pills are tinted blue for Normal and red for Obese. The Compare header no longer says "All 6".',
      'Warning icons for populations with a dropped sample look the same on every operating system. Screen readers announce the active cell, keyboard focus is visible in the list, and choosing a cell from QC or Compare clears the sidebar search so the active cell stays in view.',
    ],
  },
  {
    date: '2026-04-19',
    title: '45 cell populations and quality control',
    items: [
      'Expanded macaque results from 6 to 45 cell populations, each with edgeR differential expression and FGSEA across 4 databases. Populations with a 2v3 design have lost one sample from a group and carry a warning about reduced statistical power.',
      'The new Quality Control tab shows summary counts and sections for runs, group sizes, DE, FGSEA, composition and QA report PDFs.',
      'Hallmark added as a fourth pathway database alongside GO:BP, KEGG, and Reactome.',
      'The volcano plot includes every gene, about 12k per population, rather than only significant results. The x-axis rescales to include extreme logFC values.',
      'Fixed group means for populations that lost a sample in QC. The Normal mean and SEM could include an Obese sample. Missing samples are now left out.',
    ],
  },
  {
    date: '2026-04-19',
    title: 'Faster plots and population loading',
    items: [
      'The volcano plot uses canvas rendering for roughly 12,000 points, keeping slider and threshold changes responsive.',
      'Population data loads when selected, with outdated loading results ignored after a selection changes. A failed tab offers "Reload this tab" while the rest of the app stays available.',
      'Fixed the passing-gene count dropping by one when you selected a gene that already passed the thresholds.',
      'Fixed pathways with the same name in GO, KEGG and Reactome, such as Glycolysis, merging into one row in Compare → Pathways. Sorting that table is faster.',
      'Fixed pathway and bar-chart exports naming files after population e9 whichever population was open. Compare\'s Excel export waits until every selected population has loaded, instead of writing a workbook with missing columns.',
      'Restored the keyboard focus ring on the gene, pathway and Compare pathway search boxes.',
    ],
  },
  {
    date: '2026-04-19',
    title: 'Volcano thresholds and a pathway pop-up',
    items: [
      'The volcano FDR cutoff is no longer capped at 0.1, and both cutoffs accept a typed value, such as 0.05, as well as the slider. The slider shows the matching threshold, for example P < 0.0100.',
      'The volcano header counts the genes passing the current thresholds, split into up and down, out of the total. The fixed note that no gene reached FDR < 0.05 was removed.',
      'Pathway details in the Pathway Explorer open in a large pop-up with a single scroll bar instead of a side panel, with the same Export button as the gene pop-up.',
      'A larger header shows the current population, its conditions and gene count, with Compare all cells beside the population switcher.',
    ],
  },
  {
    date: '2026-04-19',
    title: 'Pathways for a selected gene',
    items: [
      'Each gene bar chart has a "N pathways as leading gene" button listing the GSEA pathways where that gene contributes to the leading edge. Select a pathway to see its heatmap, running enrichment and leading-edge gene grid. Closing the modal preserves your gene selection.',
      'Export the displayed pathway list or pathway detail as a multi-sheet Excel workbook.',
    ],
  },
  {
    date: '2026-04-14',
    title: 'Leading-edge gene profiles and changelog',
    items: [
      'In Pathway Explorer, "Explore leading-edge genes" opens bar charts with SEM for every leading-edge gene, plus a sortable logFC / p-value / FDR / CPM summary table.',
      'The Pathway Explorer now shows the raw p-value for each pathway alongside its FDR. Its p column sorts by raw p-value.',
      'The new "Gene profiles" sub-tab in Compare pathway details shows gene bar charts with SEM for each population in the leading edge, plus a DE summary table across populations.',
      'Single-population and multi-population views export leading-edge data as a 2-sheet XLSX containing gene summaries and per-sample CPM.',
      'Added the Changelog tab.',
    ],
  },
  {
    date: '2026-04-10',
    title: 'Gene comparison across populations',
    items: [
      'Compare → Genes now marks a gene as "not detected" in populations where it is undetectable. Those populations remain visible in the comparison.',
    ],
  },
  {
    date: '2026-04-09',
    title: 'Cross-population pathway comparison',
    items: [
      'A new Pathways sub-tab in Compare puts GSEA enrichment results for every active population in one sortable table.',
      'The detail panel shows an NES bar chart, per-population statistics, and a leading-edge gene overlap table.',
      'The Pathway Explorer table is split into pages, and gene bar-chart panels fill each row to fit more on screen.',
    ],
  },
  {
    date: '2026-04-08',
    title: 'Multi-population data',
    items: [
      'Added population data for all six hypothalamic cohorts: e9, i23, e33, i26, i40, o30.',
      'A population switcher loads lazily, fetching only the active cohort on demand.',
    ],
  },
];
