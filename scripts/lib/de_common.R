# Shared rules for every bulk differential-expression producer.
#
# Sourced by the R 4.6.0 regeneration producers in scripts/regen-r460/
# (run_dataset_r460.R, compute_edger_se_r460.R, run_hfd_r460.R,
# run_september5_r460.R, supported_matrix_r460.R, de_gse135639_r460.R,
# de_gse157077_r460.R, de_gse154274_r460.R and the prep_*_r460.R preparations
# whose output changed under rule B) and by scripts/regenerate_bulk_de.R. The
# sealed originals they derive from are left byte-identical. It holds only
# what must be identical across them:
#
#   Rule A (duplicates, DE_RULE_DUPLICATES)
#     Every feature is mapped to its FINAL public gene symbol before any test:
#     the organism annotation (org.*.eg.db / msigdbr / probe map) first, then the
#     same public-identifier gate the bundle builders apply
#     (scripts/lib/geneSymbol.mts normalizeGene, mirrored by normalize_gene()).
#     Features that share a symbol are aggregated before the DGEList / limma
#     fit: counts summed (rowsum), log-scale matrices averaged
#     (limma::avereps), linear-scale normalized matrices summed on the linear
#     scale. Features WITHOUT a symbol are NOT dropped before the fit: each
#     stays in it as its own row keyed by its raw id, so filterByExpr, TMM,
#     the dispersion / eBayes priors and the BH family see the full feature
#     set. They are excluded only from the PUBLISHED tables (DE, SE, CPM,
#     expression) after testing, and counted (n_unmapped_in_fit). Nothing is
#     de-duplicated after testing, and the SE sidecar comes from the same fit.
#     A3 (2026-09-26): only groups of distinct stable identifiers or repeats of
#     one non-date label are summed; repeated Excel-date labels ("1-Mar" can be
#     MARCHF1 or MTARC1) and distinct symbol-type labels are fitted as separate
#     rows, and only an exact-label feature is published (see
#     classify_symbol_groups below).
#   Rule B (fractional counts, DE_RULE_FRACTIONAL)
#     Count estimates are passed to edgeR unrounded; edgeR's quasi-likelihood
#     pipeline accepts non-integer counts.
#   Rule C (browser CPM, DE_RULE_CPM)
#     Two CPM matrices per count dataset, both over the aggregated symbols:
#       CPM_raw: count / raw library size * 1e6, where the raw library size is
#                the column total of the prepared input before any feature is
#                dropped (the definition the bundle builders used).
#       CPM_TMM: count / (lib.size * norm.factor) * 1e6 with the effective
#                library sizes of the dataset's own DE fit (filterByExpr with
#                keep.lib.sizes = FALSE, then calcNormFactors "TMM", over the
#                full feature set including unmapped rows) when one fit covers
#                every sample; for multi-contrast studies (HFD / September 5
#                intake) the same recipe is run ONCE per track over all included
#                samples with the whole-track group design. The factors are
#                applied to every published symbol, including filtered ones.
#
# Output location: HYPO_OUT_ROOT (environment) redirects every write to
# <HYPO_OUT_ROOT>/<dataset directory>/<sub>, e.g. a staging tree. Reads prefer
# the same overlay path when it exists (so a re-run preparation in staging is
# used by the DE step), else the tracked in-repo file. Unset = in-repo.

suppressPackageStartupMessages({ library(edgeR); library(limma); library(data.table) })

DE_COMMON_VERSION <- "2026-09-26.6"
DE_RULE_DUPLICATES <- "A3.1-2026-09-26: map to final public symbol (annotation, then normalizeGene mirror); features sharing a symbol are summed before testing only when they are distinct stable ids or repeats of one non-date label (counts rowsum, log matrices avereps, linear matrices linear sum); repeated Excel-date labels and distinct symbol-type labels are fitted as separate rows and only an exact-label feature is published (others ambiguous_symbol); Excel-date labels of 1-Mar / 2-Mar (any format; MARCHF1/2 vs MTARC1/2) are ambiguous even when single: fitted as hidden ambiguous_symbol rows unless another column of the same source row resolves them unambiguously (stable id, official gene name, or chromosome; feature_map status disambiguated_by_*); unmapped features kept in the fit and not published; no post-test dedup"
DE_RULE_FRACTIONAL <- "B1-2026-09-25: count estimates kept unrounded for edgeR-QL"
DE_RULE_MAR_DISAMBIGUATION <- "M1-2026-09-26: a 1-Mar/2-Mar label is published only if another column of its source row identifies one candidate (Marchf<n> vs Mtarc<n>): stable id (Entrez/Ensembl) mapped by org.*.eg.db; else gene-name text equal to one candidate's org.*.eg.db GENENAME after normalization, or (renamed genes, e.g. the previous official name) sharing >=50% of its non-numeric word tokens (Jaccard) with one candidate and <=20% with the other, and containing the same gene number; else a single chromosome equal to exactly one candidate's org.*.eg.db CHR when the candidates lie on different chromosomes; otherwise hidden as ambiguous_symbol"
DE_RULE_CPM <- "C2-2026-09-25: raw and TMM CPM both emitted; CPM_raw = count/raw input column total*1e6; CPM_TMM = count/(filtered lib.size*TMM factor)*1e6 using the DE fit's own TMM (full feature set incl. unmapped rows); multi-contrast tracks: one whole-track fit over all included samples"

# ---- locations ---------------------------------------------------------------

de_script_path <- function() {
  f <- grep("^--file=", commandArgs(FALSE), value = TRUE)
  if (length(f)) normalizePath(sub("^--file=", "", f[[1L]]), winslash = "/", mustWork = FALSE) else NA_character_
}

# Repository root = the directory holding scripts/lib/de_common.R's parent.
de_repo_root <- function() {
  here <- getOption("de_common.repo_root")
  if (!is.null(here)) return(here)
  stop("de_common.R: call de_init(<repo root>) after sourcing")
}

de_init <- function(repo_root) {
  repo_root <- normalizePath(repo_root, winslash = "/", mustWork = TRUE)
  stopifnot(file.exists(file.path(repo_root, "scripts", "lib", "de_common.R")))
  options(de_common.repo_root = repo_root)
  invisible(repo_root)
}

repo_rel <- function(path) {
  p <- normalizePath(path, winslash = "/", mustWork = FALSE)
  root <- paste0(de_repo_root(), "/")
  if (startsWith(tolower(p), tolower(root))) substring(p, nchar(root) + 1L) else p
}

# The repository path a staged file stands for: <HYPO_OUT_ROOT>/<dir>/<rest>
# -> geo_replication/<datasets|archive>/<dir>/<rest>. Recorded paths therefore
# do not depend on the staging root. Other paths: repo_rel().
repo_equivalent_path <- function(path) {
  p <- normalizePath(path, winslash = "/", mustWork = FALSE)
  out <- hypo_out_root()
  if (nzchar(out) && startsWith(tolower(p), tolower(paste0(out, "/")))) {
    rest <- substring(p, nchar(out) + 2L)
    dir <- sub("/.*$", "", rest)
    tail <- substring(rest, nchar(dir) + 2L)
    top <- if (dir.exists(file.path(de_repo_root(), "geo_replication", "archive", dir))) "archive" else "datasets"
    return(paste("geo_replication", top, dir, tail, sep = "/"))
  }
  repo_rel(p)
}

hypo_out_root <- function() {
  v <- Sys.getenv("HYPO_OUT_ROOT", "")
  if (nzchar(v)) normalizePath(v, winslash = "/", mustWork = FALSE) else ""
}

# `ds` is a dataset directory in any of the spellings the drivers use:
# "datasets/X", "archive/X", "geo_replication/datasets/X", or an absolute path.
.ds_parts <- function(path) {
  p <- gsub("\\\\", "/", path)
  m <- regmatches(p, regexec("(?:^|/)(datasets|archive)/([^/]+)(/(.*))?$", p, perl = TRUE))[[1L]]
  if (!length(m)) stop("not a geo_replication dataset path: ", path)
  list(kind = m[[2L]], dir = m[[3L]], rest = if (length(m) >= 5L) m[[5L]] else "")
}

# Absolute in-repo path of a geo_replication-relative or repo-relative path.
repo_path <- function(path) {
  p <- gsub("\\\\", "/", path)
  if (grepl("^([A-Za-z]:)?/", p)) return(p)
  if (startsWith(p, "geo_replication/")) return(file.path(de_repo_root(), p))
  file.path(de_repo_root(), "geo_replication", p)
}

# Output directory for a dataset: overlay when HYPO_OUT_ROOT is set.
dataset_output_dir <- function(ds, sub = "processed") {
  out <- hypo_out_root()
  d <- if (nzchar(out)) file.path(out, .ds_parts(ds)$dir, sub) else file.path(repo_path(ds), sub)
  dir.create(d, recursive = TRUE, showWarnings = FALSE)
  normalizePath(d, winslash = "/", mustWork = TRUE)
}

# Output file path for a file that lives at `path` in the repository layout.
overlay_output_path <- function(path) {
  out <- hypo_out_root()
  if (!nzchar(out)) return(repo_path(path))
  pp <- .ds_parts(path)
  target <- file.path(out, pp$dir, pp$rest)
  dir.create(dirname(target), recursive = TRUE, showWarnings = FALSE)
  target
}

# Input file: the overlay copy (written by a re-run preparation) wins.
overlay_input_path <- function(path) {
  out <- hypo_out_root()
  if (nzchar(out)) {
    pp <- tryCatch(.ds_parts(path), error = function(e) NULL)
    if (!is.null(pp)) {
      cand <- file.path(out, pp$dir, pp$rest)
      if (file.exists(cand)) return(normalizePath(cand, winslash = "/"))
    }
  }
  repo_path(path)
}

sha256_file <- function(path) {
  con <- file(path, "rb"); on.exit(close(con))
  unclass(as.character(openssl::sha256(con)))
}

# ---- public symbol gate (mirror of scripts/lib/geneSymbol.mts normalizeGene) ---

.ENS2SYM <- new.env(parent = emptyenv())
mgi_ens2sym <- function() {
  if (is.null(.ENS2SYM$map)) {
    path <- file.path(de_repo_root(), "scripts", "lib", "mmus_ens2sym.json")
    .ENS2SYM$map <- unlist(jsonlite::fromJSON(path), use.names = TRUE)
    .ENS2SYM$sha256 <- sha256_file(path)
  }
  .ENS2SYM$map
}

.IS_ENS <- "^ENS(MUSG|MUST|MUSP|RNOG|RNOT|RNOP|G|MMUG|MMUT|MFAG)[0-9]"

normalize_gene <- function(raw) {
  g <- trimws(as.character(raw))
  out <- g
  miss <- is.na(g) | !nzchar(g) | g == "NA"
  out[miss] <- NA_character_
  # 1. "id|symbol" composites: first part that is neither Ensembl nor numeric
  pipe <- which(!miss & grepl("|", g, fixed = TRUE))
  for (i in pipe) {
    parts <- trimws(strsplit(g[[i]], "|", fixed = TRUE)[[1L]]); parts <- parts[nzchar(parts)]
    pick <- parts[!grepl(.IS_ENS, parts, ignore.case = TRUE) & !grepl("^[0-9]+$", parts)]
    out[[i]] <- if (length(pick)) pick[[1L]] else if (length(parts)) parts[[1L]] else g[[i]]
  }
  x <- out; live <- !is.na(x)
  # 2. Excel-corrupted March / September symbols. Excel may zero-pad the day
  # ("Sep-01"); gene numbers never are: String(Number(num)) in the JS, i.e.
  # leading zeros stripped (exact for the <16-digit numbers these labels carry).
  m1 <- live & grepl("^[0-9]+-(Mar|Sep)$", x, ignore.case = TRUE)
  m2 <- live & grepl("^(Mar|Sep)-[0-9]+$", x, ignore.case = TRUE)
  js_number_string <- function(n) sub("^0+([0-9])", "\\1", n)
  if (any(m1)) {
    num <- js_number_string(sub("-.*$", "", x[m1])); mon <- tolower(sub("^[0-9]+-", "", x[m1]))
    out[m1] <- ifelse(mon == "mar", paste0("Marchf", num), paste0("Septin", num))
  }
  if (any(m2)) {
    num <- js_number_string(sub("^[A-Za-z]+-", "", x[m2])); mon <- tolower(sub("-.*$", "", x[m2]))
    out[m2] <- ifelse(mon == "mar", paste0("Marchf", num), paste0("Septin", num))
  }
  rest <- live & !m1 & !m2
  # 3. mouse Ensembl gene -> MGI symbol, else drop
  ensm <- rest & grepl("^ENSMUSG[0-9]", x, ignore.case = TRUE)
  if (any(ensm)) {
    map <- mgi_ens2sym()
    hit <- unname(map[sub("\\..*$", "", x[ensm])])
    out[ensm] <- ifelse(is.na(hit), NA_character_, hit)
  }
  rest <- rest & !ensm
  # 4-7. other Ensembl ids, RefSeq, numeric Entrez, htseq "__" rows, "-<n>"
  drop <- rest & (grepl(.IS_ENS, x, ignore.case = TRUE) |
                    grepl("^(N[MR]_|X[MR]_)[0-9]", x, ignore.case = TRUE) |
                    grepl("^[0-9]+$", x) | grepl("^__", x) | grepl("^-[0-9]+$", x))
  out[drop] <- NA_character_
  out[!is.na(out) & !nzchar(out)] <- NA_character_
  out
}

# ---- annotation mapping --------------------------------------------------------

.ANNOT_USED <- new.env(parent = emptyenv())
note_annotation <- function(key, value) assign(key, value, envir = .ANNOT_USED)
annotation_record <- function() {
  keys <- sort(ls(.ANNOT_USED))
  setNames(vapply(keys, function(k) as.character(get(k, envir = .ANNOT_USED)), character(1)), keys)
}

org_map <- function(pkg, keys, keytype) {
  suppressPackageStartupMessages(library(pkg, character.only = TRUE))
  note_annotation(paste0(pkg, "_version"), as.character(packageVersion(pkg)))
  note_annotation("AnnotationDbi_version", as.character(packageVersion("AnnotationDbi")))
  db <- get(pkg)
  valid <- intersect(unique(keys), AnnotationDbi::keys(db, keytype = keytype))
  m <- if (length(valid)) AnnotationDbi::mapIds(db, keys = valid, keytype = keytype, column = "SYMBOL",
                                                multiVals = "first") else setNames(character(), character())
  unname(m[keys])
}

msigdbr_ensembl_map <- function(species, keys) {
  suppressPackageStartupMessages(library(msigdbr))
  note_annotation("msigdbr_version", as.character(packageVersion("msigdbr")))
  tab <- msigdbr(species = species)
  if ("db_version" %in% names(tab)) note_annotation("msigdbr_db_version", paste(unique(tab$db_version), collapse = ";"))
  tab <- tab[!is.na(tab$ensembl_gene) & nzchar(tab$ensembl_gene) &
               !is.na(tab$gene_symbol) & nzchar(tab$gene_symbol), c("ensembl_gene", "gene_symbol")]
  tab <- tab[!duplicated(tab$ensembl_gene), ]
  tab$gene_symbol[match(keys, tab$ensembl_gene)]
}

# Annotation step of run_dataset.R (unchanged authorities), followed by the
# public symbol gate. Unmapped annotation-typed ids fall back to their raw id
# only so the gate can resolve mouse Ensembl ids through MGI; every other
# unmapped Ensembl or Entrez id has no symbol and is dropped. A probe map
# (id_map) overrides only the ids it lists; the rest pass through to the gate.
config_symbols <- function(ids, id_type, organism, id_map = NA_character_) {
  idt <- toupper(id_type)
  has_map <- !is.na(id_map) && nzchar(id_map) && id_map != "NA"
  stripped <- sub("\\..*", "", ids)
  mapped <- NULL
  if (idt == "ENSEMBL" && organism == "Mus musculus") mapped <- org_map("org.Mm.eg.db", stripped, "ENSEMBL")
  else if (idt == "ENSEMBL" && organism == "Rattus norvegicus") mapped <- org_map("org.Rn.eg.db", stripped, "ENSEMBL")
  else if (idt == "ENSEMBL" && organism %in% c("Homo sapiens", "Macaca mulatta")) mapped <- msigdbr_ensembl_map(organism, stripped)
  else if (idt == "ENTREZID" && organism == "Mus musculus") mapped <- org_map("org.Mm.eg.db", as.character(ids), "ENTREZID")
  else if (idt == "ENTREZID" && organism == "Rattus norvegicus") mapped <- org_map("org.Rn.eg.db", as.character(ids), "ENTREZID")
  else if (has_map) {
    pm <- read.delim(repo_path(id_map), header = FALSE, col.names = c("probe", "symbol"), stringsAsFactors = FALSE)
    note_annotation("probe_map", repo_rel(repo_path(id_map)))
    note_annotation("probe_map_sha256", sha256_file(repo_path(id_map)))
    # As in run_dataset.R, the map overrides only the ids it lists (GSE56238
    # maps compound Cufflinks labels to "__AMBIGUOUS_*" placeholders, which the
    # public gate then drops); every other id passes through to the gate.
    m <- pm$symbol[match(ids, pm$probe)]
    return(normalize_gene(ifelse(is.na(m) | m == "", ids, m)))
  } else if (idt %in% c("ENSEMBL", "ENTREZID")) {
    stop(sprintf("no annotation authority for id_type=%s organism=%s", idt, organism))
  }
  if (is.null(mapped)) return(normalize_gene(ids))
  mapped[!is.na(mapped) & !nzchar(mapped)] <- NA_character_
  fallback <- ifelse(grepl("^ENSMUSG[0-9]", ids, ignore.case = TRUE), ids, NA_character_)
  normalize_gene(ifelse(is.na(mapped), fallback, mapped))
}

# Final symbols for tables that already carry a symbol column next to an id
# (the HFD / September intake matrices): fill missing or Ensembl-looking
# symbols from the organism annotation, then apply the public gate.
intake_symbols <- function(ids, symbols, organism) {
  symbols <- as.character(symbols)
  needs <- is.na(symbols) | !nzchar(symbols) | grepl("^ENS[A-Z]*G[0-9]+", symbols)
  if (any(needs)) {
    pkg <- switch(organism, "Mus musculus" = "org.Mm.eg.db", "Rattus norvegicus" = "org.Rn.eg.db",
                  stop("unsupported organism: ", organism))
    keys <- sub("\\.[0-9]+$", "", ids[needs])
    keytype <- if (all(grepl("^[0-9]+$", keys))) "ENTREZID" else "ENSEMBL"
    mapped <- org_map(pkg, keys, keytype)
    bad <- is.na(mapped) | !nzchar(mapped)
    mapped[bad] <- ifelse(grepl("^ENSMUSG[0-9]", ids[needs][bad], ignore.case = TRUE), ids[needs][bad], NA_character_)
    symbols[needs] <- mapped
  }
  normalize_gene(symbols)
}

# ---- rule A: aggregation -------------------------------------------------------

# ---- rule A3: which features sharing a symbol are the same gene ------------------
#
# A group of >1 features mapped to one final symbol is classified by the RAW
# labels of its features (the source identifiers, before any mapping):
#   i_stable_ids      distinct stable identifiers (Ensembl / Entrez / RefSeq /
#                     array probe, alone or inside an "id|symbol" composite)
#                     that the annotation assigns to one symbol -> gene-level
#                     aggregation, SUMMED.
#   ii_identical      the same non-date label repeated -> the same gene, SUMMED.
#   ii_date_damaged   the same Excel-date-damaged label repeated ("1-Mar",
#                     "2-Sep", ...), which can name two different genes
#                     (MARCHF1 / MTARC1) -> NOT summed.
#   iii_symbol_labels distinct symbol-type labels that meet only through
#                     alias / previous-symbol / date normalization -> NOT summed.
# Features of a not-summed group stay in the fit as their own rows. Only the
# feature(s) whose raw label equals the final symbol exactly are published
# under it (several identical exact labels are summed); the rest are hidden
# ("ambiguous_symbol"). If none matches exactly, the symbol is not published.

DATE_LABEL_RE <- "^(0?[1-9]|[12][0-9]|3[01])-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-(0?[1-9]|[12][0-9]|3[01])$"
is_date_label <- function(x) grepl(DATE_LABEL_RE, tolower(trimws(x)))

# A3.1: Excel renders both MARCH1/MARCH2 (now MARCHF1/2) and MARC1/MARC2 (now
# MTARC1/2) as the 1st / 2nd of March, so these labels are ambiguous even when
# they occur once. Formats: 1-Mar, 01-Mar, 1-Mar-20, Mar-1, Mar-01 (any case),
# US m/d/y 3/1/2020, ISO 2020-03-01.
AMBIGUOUS_MAR_RE <- "^0*[12]-mar(-[0-9]{2,4})?$|^mar-0*[12]$|^0*3/0*[12]/[0-9]{2,4}$|^[0-9]{4}-0*3-0*[12]$"
is_ambiguous_mar_label <- function(x) grepl(AMBIGUOUS_MAR_RE, tolower(trimws(as.character(x))))

STABLE_ID_RE <- paste0(
  "^ENS[A-Z]*[GTP][0-9]{5,}(\\.[0-9]+)?$",          # Ensembl gene / transcript / protein
  "|^[0-9]+$",                                        # Entrez
  "|^[NX][MRP]_[0-9]+(\\.[0-9]+)?$",                  # RefSeq
  "|_(s_|x_|a_|i_|f_|r_|g_)?at$|^ILMN_[0-9]+$|^A_[0-9]+_P[0-9]+$")  # array probes
is_stable_id <- function(x) {
  x <- as.character(x)
  out <- grepl(STABLE_ID_RE, trimws(x), ignore.case = TRUE)
  pipe <- which(!out & grepl("|", x, fixed = TRUE))
  if (length(pipe)) out[pipe] <- vapply(strsplit(x[pipe], "|", fixed = TRUE),
    function(p) any(grepl(STABLE_ID_RE, trimws(p), ignore.case = TRUE)), logical(1))
  out
}

classify_symbol_groups <- function(labels, symbols) {
  empty <- data.table(symbol = character(), class = character(), n_features = integer(),
                      n_exact = integer(), labels = character())
  dt <- data.table(lab = as.character(labels), sym = as.character(symbols))[!is.na(sym) & nzchar(sym)]
  if (!nrow(dt)) return(empty)
  dt[, n := .N, by = sym]
  dt <- dt[n > 1L]
  if (!nrow(dt)) return(empty)
  dt[, stable := is_stable_id(lab)]
  g <- dt[, .(n_features = .N, n_exact = sum(lab == sym), n_labels = uniqueN(lab), first = lab[[1L]],
              all_stable = all(stable), labels = paste(sort(unique(lab)), collapse = ";")), by = sym]
  g[, class := fifelse(n_labels == 1L, fifelse(is_date_label(first), "ii_date_damaged", "ii_identical"),
                       fifelse(all_stable, "i_stable_ids", "iii_symbol_labels"))]
  g[, .(symbol = sym, class, n_features, n_exact, labels)]
}

# scale: "counts" and "linear" are summed; "log" is averaged (limma::avereps);
# "log2p1" is a log2(linear + 1) matrix that is summed on its linear scale.
# labels: the raw source label of every row (defaults to rownames).
aggregate_by_symbol <- function(mat, symbols, scale = c("counts", "log", "linear", "log2p1"),
                                labels = rownames(mat), resolved_by = NULL) {
  scale <- match.arg(scale)
  stopifnot(nrow(mat) == length(symbols))
  raw_ids <- rownames(mat)
  if (is.null(raw_ids)) raw_ids <- rep(NA_character_, nrow(mat))
  if (is.null(labels)) labels <- raw_ids
  labels <- as.character(labels)
  mapped <- !is.na(symbols) & nzchar(symbols)
  # A3.1: 1-Mar / 2-Mar labels are hidden on their own, before grouping.
  amb_mar <- mapped & is_ambiguous_mar_label(labels)
  groups <- classify_symbol_groups(labels, ifelse(amb_mar, NA_character_, symbols))
  no_sum <- groups[class %in% c("ii_date_damaged", "iii_symbol_labels"), symbol]
  ambiguous <- (mapped & symbols %in% no_sum) | amb_mar
  exact <- ambiguous & !amb_mar & labels == symbols
  status <- ifelse(!mapped, "unmapped_in_fit",
             ifelse(!ambiguous, "published", ifelse(exact, "published_exact_label", "ambiguous_symbol")))
  # Fit-row key: published features share their symbol; every other feature is
  # its own row keyed by its raw id (made unique against the symbols).
  published_syms <- unique(symbols[status %in% c("published", "published_exact_label")])
  own <- !(status %in% c("published", "published_exact_label"))
  own_ids <- raw_ids[own]
  blank <- is.na(own_ids) | !nzchar(own_ids) | own_ids == "NA"
  own_ids[blank] <- paste0("UNANNOT_", which(own)[blank])
  key <- symbols
  key[own] <- make.unique(c(published_syms, own_ids))[-seq_along(published_syms)]
  # Row order: published symbols (first appearance), then every own-row
  # feature in source order -- the A2 layout, so datasets without ambiguous
  # groups fit exactly the same matrix as before.
  x <- mat[!own, , drop = FALSE]; k <- key[!own]
  agg <- switch(scale,
    counts = rowsum(x, k, reorder = FALSE),
    linear = rowsum(x, k, reorder = FALSE),
    log = limma::avereps(x, ID = k),
    log2p1 = log2(rowsum(2^x - 1, k, reorder = FALSE) + 1))
  un <- mat[own, , drop = FALSE]; rownames(un) <- key[own]
  full <- rbind(agg, un)
  storage.mode(full) <- "double"
  colnames(full) <- colnames(mat)
  n_summed_away <- sum(!own) - length(published_syms)
  cls_n <- function(k) sum(groups$class == k)
  info <- list(
    n_features_raw = nrow(mat),
    n_unmapped_in_fit = sum(!mapped),
    n_features_mapped = sum(mapped),
    n_symbols_after_aggregation = length(published_syms),
    n_features_collapsed = n_summed_away,
    n_symbols_with_multiple_features = sum(groups$class %in% c("i_stable_ids", "ii_identical")),
    n_groups_i_stable_ids = cls_n("i_stable_ids"),
    n_groups_ii_identical = cls_n("ii_identical"),
    n_groups_ii_date_damaged = cls_n("ii_date_damaged"),
    n_groups_iii_symbol_labels = cls_n("iii_symbol_labels"),
    n_features_ambiguous_hidden = sum(status == "ambiguous_symbol"),
    n_features_ambiguous_mar = sum(amb_mar),
    n_features_disambiguated = if (is.null(resolved_by)) 0L else sum(!is.na(resolved_by)),
    n_symbols_hidden_ambiguous = length(setdiff(unique(c(no_sum, symbols[amb_mar])), published_syms)),
    n_fit_rows = nrow(full),
    aggregation = switch(scale, counts = "rowsum(counts)", linear = "rowsum(linear)",
                         log = "limma::avereps(log)", log2p1 = "log2(rowsum(2^x-1)+1)"))
  if (scale %in% c("counts", "linear")) {
    tot <- sum(mat); info$unmapped_signal_fraction <- if (tot > 0) sum(mat[!mapped, , drop = FALSE]) / tot else 0
  }
  list(mat = full, published = published_syms, info = info, groups = groups,
       feature_map = data.table(feature_id = raw_ids, label = labels, symbol = symbols,
                                resolved_by = if (is.null(resolved_by)) NA_character_ else resolved_by,
                                fit_row = key, status = status))
}

# ---- fits ----------------------------------------------------------------------

fit_edger_ql <- function(counts, design, coef) {
  y <- DGEList(counts = counts)
  keep <- filterByExpr(y, design); y <- y[keep, , keep.lib.sizes = FALSE]
  y <- calcNormFactors(y)
  y <- estimateDisp(y, design)
  fit <- glmQLFit(y, design)
  qlf <- glmQLFTest(fit, coef = coef)
  list(y = y, fit = fit, qlf = qlf)
}

fit_limma_matrix <- function(mat, design) {
  rv <- apply(mat, 1, var)
  mat <- mat[is.finite(rv) & rv > 1e-8, , drop = FALSE]
  list(mat = mat, fit = eBayes(lmFit(mat, design)))
}

# QL-adjusted coefficient Wald SE on the log2 scale (see compute_edger_se.R).
ql_wald_se <- function(fit, design, coef) {
  mu <- fit$fitted.values; disp <- fit$dispersion
  if (length(disp) == 1L) disp <- rep(disp, nrow(mu))
  qlScale <- fit$average.ql.dispersion
  if (!is.null(qlScale)) {
    if (length(qlScale) != 1L || !is.finite(qlScale) || qlScale <= 0) stop("invalid average.ql.dispersion")
    disp <- disp / qlScale
  }
  post <- if (!is.null(fit$var.post)) fit$var.post else fit$s2.post
  if (is.null(post) || length(post) != nrow(mu) || any(!is.finite(post) | post <= 0))
    stop("invalid posterior QL variance")
  if (length(disp) != nrow(mu) || any(!is.finite(disp) | disp < 0)) stop("invalid working dispersion")
  j <- match(coef, colnames(design))
  vapply(seq_len(nrow(mu)), function(i) {
    w <- mu[i, ] / (1 + disp[i] * mu[i, ])
    inv <- tryCatch(solve(crossprod(design * w, design)), error = function(e) NULL)
    if (is.null(inv)) return(NA_real_)
    v <- inv[j, j] * post[i]
    if (is.finite(v) && v > 0) sqrt(v) / log(2) else NA_real_
  }, numeric(1))
}

# ---- platform-independent text output ------------------------------------------
# Every text file the r460 bulk code writes is LF, whatever the OS: fwrite with
# eol = "\n"; write.table / writeLines / JSON through binary-mode connections
# (text-mode connections turn "\n" into "\r\n" on Windows). Hashes recorded in
# provenance are of these exact bytes.
write_tsv_lf <- function(x, path, ...) {
  fwrite(x, path, sep = "\t", quote = FALSE, na = "NA", eol = "\n", ...)
  invisible(path)
}
write_table_lf <- function(x, path, ...) {
  con <- if (grepl("\\.gz$", path)) gzfile(path, "wb") else file(path, "wb")
  on.exit(close(con))
  write.table(x, con, sep = "\t", quote = FALSE, row.names = FALSE, eol = "\n", ...)
  invisible(path)
}
write_lines_lf <- function(lines, path) {
  con <- if (grepl("\\.gz$", path)) gzfile(path, "wb") else file(path, "wb")
  on.exit(close(con))
  writeLines(enc2utf8(as.character(lines)), con, sep = "\n", useBytes = TRUE)
  invisible(path)
}
write_json_lf <- function(x, path, ...) {
  write_lines_lf(as.character(jsonlite::toJSON(x, ...)), path)
}

# ---- rule C: browser CPM -------------------------------------------------------

write_gz_tsv <- function(dt, path) {
  write_tsv_lf(dt, path, compress = "gzip")
}

# counts: the FULL fit matrix (aggregated symbols + unmapped rows).
# published: the rows to write (the symbols). fit_y: the DE fit's filtered,
# TMM-normalized DGEList when that fit covers every column of `counts`; else
# the same recipe (filterByExpr on `design`, keep.lib.sizes = FALSE, TMM) is
# run here once over all columns.
write_cpm_pair <- function(counts, raw_lib_sizes, design, stem, proc_dir, published = rownames(counts), fit_y = NULL) {
  stopifnot(identical(names(raw_lib_sizes), colnames(counts)), all(published %in% rownames(counts)))
  if (is.null(fit_y)) {
    y <- DGEList(counts = counts)
    keep <- filterByExpr(y, design)
    fit_y <- calcNormFactors(y[keep, , keep.lib.sizes = FALSE], method = "TMM")
    source_of_factors <- "whole-dataset fit (filterByExpr + TMM over all samples)"
  } else {
    stopifnot(identical(colnames(fit_y$counts), colnames(counts)))
    source_of_factors <- "DE fit"
  }
  eff <- fit_y$samples$lib.size * fit_y$samples$norm.factors
  pub <- counts[published, , drop = FALSE]
  cpm_raw <- sweep(pub, 2, raw_lib_sizes, "/") * 1e6
  cpm_tmm <- sweep(pub, 2, eff, "/") * 1e6
  paths <- c(raw = file.path(proc_dir, paste0(stem, "_CPM_raw.tsv.gz")),
             tmm = file.path(proc_dir, paste0(stem, "_CPM_TMM.tsv.gz")),
             norm = file.path(proc_dir, paste0(stem, "_cpm_normalization.tsv")))
  write_gz_tsv(data.table(gene_id = rownames(pub), as.data.table(cpm_raw)), paths[["raw"]])
  write_gz_tsv(data.table(gene_id = rownames(pub), as.data.table(cpm_tmm)), paths[["tmm"]])
  write_tsv_lf(data.table(sample = colnames(counts), raw_library_size = unname(raw_lib_sizes),
                    fit_library_size = colSums(counts), published_library_size = colSums(pub),
                    filtered_library_size = fit_y$samples$lib.size, tmm_norm_factor = fit_y$samples$norm.factors,
                    effective_library_size = eff), paths[["norm"]])
  list(paths = paths, n_genes = nrow(pub), n_genes_tmm_filter = nrow(fit_y),
       design = paste(colnames(design), collapse = " + "), factors = source_of_factors)
}

write_expression_matrix <- function(mat, stem, proc_dir, published = rownames(mat)) {
  p <- file.path(proc_dir, paste0(stem, "_expression.tsv.gz"))
  pub <- mat[published, , drop = FALSE]
  write_gz_tsv(data.table(gene_id = rownames(pub), as.data.table(pub)), p)
  p
}

# Columns feature_id, symbol, status. status: "mapped" = published under the
# symbol (alone or summed); "disambiguated_by_<stable_id|name|chr>" = a
# 1-Mar / 2-Mar label resolved by another column of its source row (A3.1) and
# published; "ambiguous_symbol" = rule A3 kept it in the fit as
# its own row but did not publish it; "dropped_no_symbol" = no public symbol,
# kept in the fit as its own row, not published (label kept from rule A1 so
# unaffected tables stay byte-identical).
write_feature_map <- function(feature_map, stem, proc_dir) {
  p <- file.path(proc_dir, paste0(stem, "_feature_map.tsv.gz"))
  st <- feature_map$status
  rb <- if ("resolved_by" %in% names(feature_map)) feature_map$resolved_by else rep(NA_character_, length(st))
  fm <- data.table(feature_id = feature_map$feature_id, symbol = feature_map$symbol,
                   status = ifelse(st == "unmapped_in_fit", "dropped_no_symbol",
                              ifelse(st == "ambiguous_symbol", "ambiguous_symbol",
                                ifelse(!is.na(rb), paste0("disambiguated_by_", rb), "mapped"))))
  write_gz_tsv(fm, p)
  p
}

# ---- provenance ----------------------------------------------------------------

pkg_version <- function(p) tryCatch(as.character(packageVersion(p)), error = function(e) NA_character_)

# fields: named list of scalar values (in order). inputs / outputs: named
# character vectors of file paths. generators: character vector of script paths.
write_provenance <- function(stem, proc_dir, generators, inputs = character(), outputs = character(),
                             fields = list()) {
  generators <- unique(c(generators[!is.na(generators) & nzchar(generators)],
                         file.path(de_repo_root(), "scripts", "lib", "de_common.R")))
  kv <- list(schema_version = "1", stem = stem, de_common_version = DE_COMMON_VERSION)
  for (i in seq_along(generators)) {
    key <- if (i == 1L) "generator" else sprintf("generator_%d", i)
    kv[[key]] <- repo_rel(generators[[i]])
    kv[[paste0(key, "_sha256")]] <- sha256_file(generators[[i]])
  }
  kv$r_version <- R.version.string
  for (p in c("edgeR", "limma", "data.table", "statmod", "jsonlite", "openssl"))
    kv[[paste0(p, "_version")]] <- pkg_version(p)
  ann <- annotation_record()
  for (k in names(ann)) kv[[paste0("annotation_", k)]] <- ann[[k]]
  if (!is.null(.ENS2SYM$sha256)) kv$annotation_mgi_ens2sym <- "scripts/lib/mmus_ens2sym.json"
  if (!is.null(.ENS2SYM$sha256)) kv$annotation_mgi_ens2sym_sha256 <- .ENS2SYM$sha256
  kv$rule_duplicates <- DE_RULE_DUPLICATES
  kv$rule_fractional <- DE_RULE_FRACTIONAL
  kv$rule_cpm <- DE_RULE_CPM
  kv$rule_mar_disambiguation <- DE_RULE_MAR_DISAMBIGUATION
  kv$text_output_policy <- "LF line endings on every platform (write_*_lf helpers in scripts/lib/de_common.R)"
  exception <- Sys.getenv("HYPO_RULE_EXCEPTION", "")
  if (nzchar(exception)) kv$rule_exception <- exception
  prep <- Sys.getenv("HYPO_PREP_GENERATOR", "")
  if (nzchar(prep) && file.exists(prep)) {
    kv$prep_generator <- repo_rel(prep); kv$prep_generator_sha256 <- sha256_file(prep)
  }
  for (k in names(fields)) kv[[k]] <- if (is.null(fields[[k]]) || !length(fields[[k]])) "NA" else paste(fields[[k]], collapse = ";")
  for (k in names(inputs)) {
    kv[[paste0("input_", k)]] <- repo_equivalent_path(inputs[[k]])
    kv[[paste0("input_", k, "_sha256")]] <- sha256_file(inputs[[k]])
  }
  for (k in names(outputs)) {
    kv[[paste0("output_", k)]] <- basename(outputs[[k]])
    kv[[paste0("output_", k, "_sha256")]] <- sha256_file(outputs[[k]])
  }
  si <- file.path(proc_dir, paste0(stem, "_sessionInfo.txt"))
  write_lines_lf(capture.output(print(sessionInfo())), si)
  kv$session_info <- basename(si)
  vals <- vapply(kv, function(v) gsub("[\t\r\n]+", " ", as.character(v)), character(1))
  prov <- file.path(proc_dir, paste0(stem, "_provenance.tsv"))
  kvt <- data.table(k = names(vals), v = unname(vals)); setnames(kvt, c("key", "value"))
  write_tsv_lf(kvt, prov)
  invisible(prov)
}

# ---- the config-row (run_dataset.R) front end ------------------------------------

read_expr_file <- function(path) {
  if (grepl("series_matrix", path)) {
    L <- readLines(gzfile(path))
    b <- grep("!series_matrix_table_begin", L); e <- grep("!series_matrix_table_end", L)
    if (!length(b) || !length(e)) stop("series_matrix table markers not found")
    return(read.delim(text = L[(b + 1):(e - 1)], check.names = FALSE, stringsAsFactors = FALSE))
  }
  con <- if (grepl("\\.gz$", path)) gzfile(path) else file(path)
  first <- readLines(con, n = 1); close(con)
  sep <- if (grepl("\t", first)) "\t" else if (grepl(",", first)) "," else ""
  read.delim(if (grepl("\\.gz$", path)) gzfile(path) else path,
             sep = sep, check.names = FALSE, stringsAsFactors = FALSE)
}

# A3.1 "unless" clause: a 1-Mar / 2-Mar label (MARCHF1/2 vs MTARC1/2) is
# resolved only by another column of the SAME source row that identifies the
# gene unambiguously, tried in this order:
#   stable_id  an Entrez / Ensembl column (by column name), mapped with the
#              organism annotation;
#   name       a gene-name / description column whose text matches the
#              official name (org.*.eg.db GENENAME) of exactly one candidate:
#              identical after normalization, or, for renamed genes, sharing
#              >= 50% of its word tokens (Jaccard, numbers excluded) with one
#              candidate and <= 20% with the other, and carrying the same
#              gene number;
#   chr        a chromosome column whose single chromosome equals the
#              annotated chromosome (org.*.eg.db CHR) of exactly one
#              candidate, the candidates lying on different chromosomes.
# A resolved feature takes the candidate's symbol (and a non-date label);
# anything else stays an ambiguous_symbol row. resolved_by is recorded per
# feature (feature_map status disambiguated_by_<method>) and in provenance.
STABLE_ID_COLUMN_RE <- "^(entrez|entrezid|entrez_id|entrez_gene_id|ncbi_gene_id|geneid|gene_id|ensembl|ensembl_id|ensembl_gene_id|ensemblid|ensembl_gene)$"
NAME_COLUMN_RE <- "^(name|gene_name|genename|gene_description|description|gene_desc|desc|product|gene_title|gene_fullname|full_name)$"
CHR_COLUMN_RE <- "^(chr|chrom|chromosome|seqname|seqnames|seqid)$"

mar_day <- function(x) {
  x <- tolower(trimws(x))
  out <- rep(NA_integer_, length(x))
  a <- grepl("^0*[12]-mar", x); out[a] <- as.integer(sub("^0*([12])-.*$", "\\1", x[a]))
  b <- grepl("^mar-0*[12]$", x); out[b] <- as.integer(sub("^mar-0*", "", x[b]))
  c <- grepl("^0*3/0*[12]/", x); out[c] <- as.integer(sub("^0*3/0*([12])/.*$", "\\1", x[c]))
  d <- grepl("^[0-9]{4}-0*3-0*[12]$", x); out[d] <- as.integer(sub("^[0-9]{4}-0*3-0*", "", x[d]))
  out
}

name_tokens <- function(x) {
  t <- strsplit(tolower(x), "[^a-z0-9]+")[[1L]]
  t[nzchar(t)]
}

resolve_ambiguous_mar <- function(labels, symbols, organism, columns = list()) {
  n <- length(labels)
  resolved_by <- rep(NA_character_, n)
  amb <- is_ambiguous_mar_label(labels)
  if (!any(amb)) return(list(symbols = symbols, labels = labels, resolved_by = resolved_by, note = "none"))
  pkg <- switch(organism, "Mus musculus" = "org.Mm.eg.db", "Rattus norvegicus" = "org.Rn.eg.db", NA_character_)
  if (is.na(pkg)) return(list(symbols = symbols, labels = labels, resolved_by = resolved_by,
                              note = sprintf("%d 1-Mar/2-Mar labels; no annotation for %s: hidden", sum(amb), organism)))
  suppressPackageStartupMessages(library(pkg, character.only = TRUE))
  note_annotation(paste0(pkg, "_version"), as.character(packageVersion(pkg)))
  db <- get(pkg)
  cols <- tolower(names(columns))
  stable_cols <- names(columns)[grepl(STABLE_ID_COLUMN_RE, cols)]
  name_cols <- names(columns)[grepl(NAME_COLUMN_RE, cols)]
  chr_cols <- names(columns)[grepl(CHR_COLUMN_RE, cols)]
  cand_syms <- unique(unlist(lapply(1:2, function(d) c(paste0("Marchf", d), paste0("Mtarc", d)))))
  ann <- suppressMessages(AnnotationDbi::select(db, keys = intersect(cand_syms, AnnotationDbi::keys(db, "SYMBOL")),
                                                keytype = "SYMBOL", columns = c("GENENAME", "CHR")))
  ann <- ann[!duplicated(ann$SYMBOL), ]
  details <- character()
  for (i in which(amb)) {
    day <- mar_day(labels[[i]])
    if (is.na(day)) next
    cands <- ann[ann$SYMBOL %in% c(paste0("Marchf", day), paste0("Mtarc", day)), ]
    pick <- NA_character_; how <- NA_character_; newlab <- NA_character_
    for (col in stable_cols) {
      v <- sub("\\.[0-9]+$", "", trimws(as.character(columns[[col]][[i]])))
      keytype <- if (grepl("^[0-9]+$", v)) "ENTREZID" else if (grepl("^ENS[A-Z]*G[0-9]+$", v)) "ENSEMBL" else NA_character_
      if (is.na(keytype)) next
      m <- normalize_gene(org_map(pkg, v, keytype))
      if (!is.na(m)) { pick <- m; how <- "stable_id"; newlab <- v; details <- c(details, sprintf("%s->%s via %s=%s", labels[[i]], m, col, v)); break }
    }
    if (is.na(pick)) for (col in name_cols) {
      txt <- trimws(as.character(columns[[col]][[i]]))
      if (is.na(txt) || !nzchar(txt)) next
      tt <- name_tokens(txt)
      exact <- vapply(cands$GENENAME, function(g) identical(name_tokens(g), tt), logical(1))
      if (sum(exact) == 1L) { pick <- cands$SYMBOL[exact]; how <- "name" }
      else {
        words <- setdiff(tt, tt[grepl("^[0-9]+$", tt)])
        jac <- vapply(cands$GENENAME, function(g) {
          gw <- name_tokens(g); gw <- gw[!grepl("^[0-9]+$", gw)]
          length(intersect(words, gw)) / length(union(words, gw))
        }, numeric(1))
        if (as.character(day) %in% tt && sum(jac >= 0.5) == 1L && sum(jac <= 0.2) == length(jac) - 1L) {
          pick <- cands$SYMBOL[jac >= 0.5]; how <- "name"
        }
      }
      if (!is.na(pick)) { newlab <- pick; details <- c(details, sprintf("%s->%s via %s=\"%s\"", labels[[i]], pick, col, txt)); break }
    }
    if (is.na(pick) && nrow(cands) > 1L && !anyDuplicated(cands$CHR) && !anyNA(cands$CHR)) for (col in chr_cols) {
      chrs <- unique(sub("^chr", "", trimws(strsplit(as.character(columns[[col]][[i]]), "[;,]")[[1L]]), ignore.case = TRUE))
      chrs <- chrs[nzchar(chrs)]
      if (length(chrs) == 1L && sum(cands$CHR == chrs) == 1L) {
        pick <- cands$SYMBOL[cands$CHR == chrs]; how <- "chr"; newlab <- pick
        details <- c(details, sprintf("%s->%s via %s=%s", labels[[i]], pick, col, chrs)); break
      }
    }
    if (!is.na(pick)) { symbols[[i]] <- pick; labels[[i]] <- newlab; resolved_by[[i]] <- how }
  }
  note <- sprintf("%d 1-Mar/2-Mar labels: %d resolved (%s), %d hidden as ambiguous_symbol%s",
                  sum(amb), sum(!is.na(resolved_by)),
                  if (any(!is.na(resolved_by))) paste(names(table(resolved_by)), table(resolved_by), sep = "=", collapse = ",") else "none",
                  sum(amb) - sum(!is.na(resolved_by)),
                  if (length(details)) paste0("; ", paste(details, collapse = "; ")) else "")
  list(symbols = symbols, labels = labels, resolved_by = resolved_by, note = note)
}

# Everything run_dataset.R did before testing, with rule A applied. Also used
# by compute_edger_se.R so DE and SE share one feature universe.
prepare_config_dataset <- function(r) {
  ss_path <- overlay_input_path(r$samplesheet)
  ss <- read.delim(ss_path, stringsAsFactors = FALSE)
  ss <- ss[ss$group %in% c("control", "case"), , drop = FALSE]
  ss$group <- factor(ss$group, levels = c("control", "case"))
  if (nlevels(droplevels(ss$group)) < 2) stop("samplesheet must contain both 'control' and 'case'")

  inpath <- overlay_input_path(r$input_path)
  if (!file.exists(inpath)) stop(sprintf("input not found: %s (status=%s)", inpath, r$status))
  df <- read_expr_file(inpath)
  idcol <- r$id_col
  ids_raw <- if (!is.na(idcol) && nzchar(idcol) && idcol != "NA" && idcol %in% colnames(df)) df[[idcol]] else df[[1]]
  ids_raw <- as.character(ids_raw)
  bad <- is.na(ids_raw) | ids_raw == "" | ids_raw == "NA"
  if (any(bad)) ids_raw[bad] <- paste0("UNANNOT_", which(bad))
  miss <- setdiff(ss$sample, colnames(df))
  if (length(miss)) stop(sprintf("samplesheet samples not in matrix columns: %s", paste(miss, collapse = ", ")))
  mat <- as.matrix(df[, ss$sample, drop = FALSE])
  mat <- matrix(as.numeric(mat), nrow = nrow(mat), dimnames = list(ids_raw, ss$sample))
  if (any(!is.finite(mat))) stop("non-finite expression values")

  symbols <- config_symbols(ids_raw, r$id_type, r$organism, r$id_map)
  symbols[bad] <- NA_character_
  extra <- setdiff(names(df), c(idcol, ss$sample))
  extra <- extra[!is.na(extra) & nzchar(extra) & !duplicated(extra)]
  mar <- resolve_ambiguous_mar(ids_raw, symbols, r$organism, setNames(lapply(extra, function(k) df[[k]]), extra))
  symbols <- mar$symbols; labels <- mar$labels

  if (r$input_kind == "counts") {
    if (any(mat < 0)) stop("negative counts")
    scale <- "counts"
  } else {
    # Every matrix-kind registry input is on a log scale (checked 2026-09-25:
    # maxima 11.7-22.8); refuse to guess if that ever stops being true.
    if (max(mat) > 50) stop("matrix input looks linear-scale; declare its scale before aggregating")
    scale <- "log"
  }
  ag <- aggregate_by_symbol(mat, symbols, scale, labels = labels, resolved_by = mar$resolved_by)
  ag$info$mar_resolution <- mar$note

  bv <- r$batch_var
  use_batch <- !is.na(bv) && nzchar(bv) && bv != "NA" && bv %in% colnames(ss) && length(unique(ss[[bv]])) > 1
  if (use_batch) {
    ss$.batch <- factor(ss[[bv]]); design <- model.matrix(~ .batch + group, data = ss)
  } else design <- model.matrix(~ group, data = ss)
  list(r = r, ss = ss, ss_path = ss_path, inpath = inpath, raw_lib_sizes = colSums(mat),
       mat = ag$mat, published = ag$published, agg = ag$info, feature_map = ag$feature_map, scale = scale,
       design = design, coef = "groupcase", fractional_cells = if (scale == "counts") sum(mat != round(mat)) else NA)
}

run_config_de <- function(prep) {
  if (prep$r$input_kind == "counts") {
    ft <- fit_edger_ql(prep$mat, prep$design, prep$coef)
    tt <- topTags(ft$qlf, n = Inf)$table
    de <- data.frame(id = rownames(tt), symbol = rownames(tt),
                     logFC = tt$logFC, stat = sign(tt$logFC) * tt$F,
                     pvalue = tt$PValue, padj = tt$FDR, method = "edgeR-QL", stringsAsFactors = FALSE)
    tested <- nrow(ft$y); fit_y <- ft$y
  } else {
    lf <- fit_limma_matrix(prep$mat, prep$design)
    tt <- topTable(lf$fit, coef = prep$coef, number = Inf, sort.by = "none")
    de <- data.frame(id = rownames(lf$mat), symbol = rownames(lf$mat),
                     logFC = tt$logFC, stat = tt$t,
                     pvalue = tt$P.Value, padj = tt$adj.P.Val, method = "limma", stringsAsFactors = FALSE)
    tested <- nrow(lf$mat); fit_y <- NULL
  }
  # Unmapped rows were part of the fit (normalization, priors, BH family);
  # they are not published.
  n_unmapped_tested <- sum(!(de$id %in% prep$published))
  de <- de[de$id %in% prep$published, ]
  de <- de[order(-abs(de$stat)), ]
  stopifnot(!anyDuplicated(de$symbol))
  de$direction <- ifelse(de$logFC < 0, "down", "up")
  list(de = de, n_tested = tested, n_unmapped_tested = n_unmapped_tested, y = fit_y)
}

PANEL <- c("IGFBP2", "IGFBP5", "IGFBP6", "IGFBP7", "IGF1R", "IRS2", "IGF1", "INSR", "PAPPA",
           "IGFBP1", "IGFBP3", "IGFBP4")

# DE table + panel + browser matrices + feature map + provenance for one
# config row. Returns the DE table and output paths.
write_config_outputs <- function(prep, res, stem, proc_dir, generators, extra_inputs = character()) {
  de <- res$de
  de_path <- file.path(proc_dir, paste0(stem, "_DE.tsv"))
  write_table_lf(de, de_path)
  pan <- de[toupper(de$symbol) %in% PANEL, c("symbol", "logFC", "stat", "pvalue", "padj", "direction")]
  pan$dataset <- rep(stem, nrow(pan))
  pan_path <- file.path(proc_dir, paste0(stem, "_panel.tsv"))
  write_table_lf(pan, pan_path)
  outputs <- c(de = de_path, panel = pan_path)
  cpm <- NULL
  if (prep$scale == "counts") {
    cpm <- write_cpm_pair(prep$mat, prep$raw_lib_sizes, prep$design, stem, proc_dir,
                          published = prep$published, fit_y = res$y)
    outputs <- c(outputs, cpm_raw = cpm$paths[["raw"]], cpm_tmm = cpm$paths[["tmm"]], cpm_normalization = cpm$paths[["norm"]])
  } else {
    outputs <- c(outputs, expression = write_expression_matrix(prep$mat, stem, proc_dir, prep$published))
  }
  outputs <- c(outputs, feature_map = write_feature_map(prep$feature_map, stem, proc_dir))
  a <- prep$agg
  write_provenance(stem, proc_dir, generators,
    inputs = c(matrix = prep$inpath, samplesheet = prep$ss_path, extra_inputs),
    outputs = outputs,
    fields = list(config_id = prep$r$id, organism = prep$r$organism, id_type = prep$r$id_type,
                  input_kind = prep$r$input_kind, input_scale = prep$scale, method = de$method[1],
                  design = paste(colnames(prep$design), collapse = " + "), coef = prep$coef,
                  samples_control = paste(prep$ss$sample[prep$ss$group == "control"], collapse = ","),
                  samples_case = paste(prep$ss$sample[prep$ss$group == "case"], collapse = ","),
                  input_fractional_cells = prep$fractional_cells,
                  n_features_raw = a$n_features_raw, n_unmapped_in_fit = a$n_unmapped_in_fit,
                  n_symbols_after_aggregation = a$n_symbols_after_aggregation,
                  n_features_collapsed = a$n_features_collapsed,
                  n_symbols_with_multiple_features = a$n_symbols_with_multiple_features,
                  n_groups_i_stable_ids = a$n_groups_i_stable_ids, n_groups_ii_identical = a$n_groups_ii_identical,
                  n_groups_ii_date_damaged = a$n_groups_ii_date_damaged, n_groups_iii_symbol_labels = a$n_groups_iii_symbol_labels,
                  n_features_ambiguous_hidden = a$n_features_ambiguous_hidden,
                  n_features_ambiguous_mar = a$n_features_ambiguous_mar,
                  n_features_disambiguated = a$n_features_disambiguated,
                  mar_resolution = if (is.null(a$mar_resolution)) "none" else a$mar_resolution,
                  n_symbols_hidden_ambiguous = a$n_symbols_hidden_ambiguous,
                  aggregation = a$aggregation,
                  unmapped_signal_fraction = if (is.null(a$unmapped_signal_fraction)) NA else signif(a$unmapped_signal_fraction, 6),
                  n_features_tested = res$n_tested, n_unmapped_tested = res$n_unmapped_tested,
                  fdr_family = "all tested fit rows, including unmapped rows that are not published",
                  n_de_rows = nrow(de),
                  n_fdr_lt_0.05 = sum(de$padj < 0.05, na.rm = TRUE),
                  cpm_tmm_filter_genes = if (is.null(cpm)) NA else cpm$n_genes_tmm_filter,
                  cpm_design = if (is.null(cpm)) NA else cpm$design,
                  cpm_tmm_factors = if (is.null(cpm)) NA else cpm$factors))
  invisible(list(de = de, de_path = de_path, outputs = outputs))
}
