# R 4.6.0 regeneration variant of scripts/run_mouse_fgsea.R (sealed original left byte-identical).
# Shared rules: scripts/lib/de_common.R; orchestrated by scripts/regenerate_bulk_de.R.
# Compute browsable FGSEA for mouse and rat GEO datasets, mirroring the macaque
# pipeline (data/raw/scripts/run_all_clusters.R). Ranks come from the COMMITTED
# per-dataset DE table (processed/<id>_DE.tsv, `stat` = signed QL F for edgeR-QL
# or moderated t for limma) — so NO edgeR re-run is needed, only fgsea over the
# four MSigDB collections for the dataset's configured organism. Writes
# <id>_FGSEA_<DB>.tsv next to
# the DE table, in the same schema the bundle builder reads.
#
# Run (from the repo root): Rscript scripts/regen-r460/run_fgsea_r460.R [ID ...] [--force]
# HYPO_OUT_ROOT=<staging dir> runs over the staged DE tables there instead.
suppressMessages({
  library(fgsea); library(msigdbr); library(data.table)
})

FGSEA_MIN <- 15L
FGSEA_MAX <- 500L
TIE_SEED <- 42L
FGSEA_SEED <- 42L
MSIGDB_AUTHORITY <- "HS" # repository standard: human MSigDB, ortholog-mapped by msigdbr
PROVENANCE_SCHEMA_VERSION <- "3"
SEED_POLICY <- "tie seed once; FGSEA seed reset before each collection"
TIE_JITTER_POLICY <- "runif(0,1e-7) before descending sort"
ORTHOLOG_CACHE_POLICY <- "clear target-species msigdbr ortholog cache before every collection fetch"
OUTPUT_HASH_POLICY <- "SHA-256 of exact published TSV bytes"
FULL_SCHEMA <- c("pathway", "pval", "padj", "NES", "size", "leadingEdge")
FOCAL_SCHEMA <- c("pathway", "pval", "padj", "log2err", "ES", "NES", "size", "leadingEdge", "dataset")
# The only macaque DE table is the explicitly out-of-scope single-cell dataset.
EXCLUDED_DATASETS <- "GSE201986"
GEO <- "geo_replication"   # scans datasets/ AND archive/ (recursive)
CFG <- fread(file.path(GEO, "config", "datasets.tsv"))

scriptArg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
GENERATOR_PATH <- normalizePath(if (length(scriptArg)) sub("^--file=", "", scriptArg[[1L]]) else "scripts/regen-r460/run_fgsea_r460.R")

sha256File <- function(path) {
  con <- file(path, "rb")
  on.exit(close(con))
  unclass(as.character(openssl::sha256(con)))
}

sha256Lines <- function(lines) {
  unclass(as.character(openssl::sha256(charToRaw(paste(lines, collapse = "\n")))))
}

membershipSha256 <- function(pathways) {
  pathwayNames <- sort(names(pathways))
  canonical <- vapply(
    pathwayNames,
    function(pathway) paste(pathway, paste(sort(unique(pathways[[pathway]])), collapse = ";"), sep = "\t"),
    character(1)
  )
  sha256Lines(canonical)
}

clearOrthologCache <- function(species) {
  if (MSIGDB_AUTHORITY != "HS" || species %in% c("Homo sapiens", "human")) return(invisible(NULL))
  speciesId <- babelgene::species(species)$taxon_id
  if (length(speciesId) != 1L || is.na(speciesId)) stop("could not resolve target-species taxonomy id")
  cache <- get("pkg_env", envir = asNamespace("msigdbr"), inherits = FALSE)
  key <- paste0("orthologs", speciesId)
  if (exists(key, envir = cache, inherits = FALSE)) rm(list = key, envir = cache)
  invisible(NULL)
}

validateFocalClosure <- function(dir, geoId) {
  full <- fread(file.path(dir, sprintf("%s_FGSEA_REACTOME.tsv", geoId)))
  focal <- fread(file.path(dir, sprintf("%s_fgsea.tsv", geoId)))
  if (!identical(names(full), FULL_SCHEMA) || !identical(names(focal), FOCAL_SCHEMA) ||
      anyDuplicated(full$pathway) || anyDuplicated(focal$pathway) ||
      any(focal$dataset != geoId)) {
    stop("focused or full Reactome FGSEA schema/identity invariants changed for ", geoId)
  }
  indices <- match(focal$pathway, full$pathway)
  shared <- FULL_SCHEMA
  if (anyNA(indices) || is.unsorted(indices, strictly = TRUE) || !isTRUE(all.equal(
    focal[, ..shared], full[indices, ..shared],
    check.attributes = FALSE, tolerance = 0
  ))) stop("focused and full Reactome FGSEA outputs diverged for ", geoId)
}

validateOutputSet <- function(dir, geoId) {
  for (nm in c("HALLMARK", "KEGG", "GO_BP", "REACTOME")) {
    path <- file.path(dir, sprintf("%s_FGSEA_%s.tsv", geoId, nm))
    result <- fread(path)
    if (!identical(names(result), FULL_SCHEMA) || anyDuplicated(result$pathway) ||
        anyNA(result$pathway) || any(!nzchar(result$pathway))) {
      stop("FGSEA output schema/identity invariants changed for ", geoId, " / ", nm)
    }
  }
  validateFocalClosure(dir, geoId)
}

rankVector <- function(path) {
  de <- tryCatch(fread(path), error = function(e) NULL)
  if (is.null(de) || !all(c("symbol", "stat") %in% names(de))) return(NULL)
  rk <- as.numeric(de$stat)
  names(rk) <- de$symbol
  rk <- rk[is.finite(rk) & !is.na(names(rk)) & names(rk) != ""]
  rk[!duplicated(names(rk))]
}

configuredOrganism <- function(geoId, dePath) {
  configured <- unique(CFG[CFG$id == geoId & !is.na(organism) & nzchar(organism), organism])
  if (length(configured) == 1L) return(configured)
  # A handful of archived or multi-contrast tables predate config rows. Their
  # directory names carry the repository's canonical organism code.
  codeMap <- c(
    mmus = "Mus musculus", rnor = "Rattus norvegicus", hsap = "Homo sapiens",
    btaur = "Bos taurus", drer = "Danio rerio", ggal = "Gallus gallus",
    sscro = "Sus scrofa", mmul = "Macaca mulatta"
  )
  normalized <- tolower(normalizePath(dePath, winslash = "/", mustWork = TRUE))
  matched <- names(codeMap)[vapply(names(codeMap), function(code) grepl(paste0("_", code, "_"), normalized, fixed = TRUE), logical(1))]
  if (length(matched) == 1L) return(unname(codeMap[[matched]]))
  character()
}

# msigdbr renamed category/subcategory -> collection/subcollection across versions;
# try the new API first, fall back to the old. KEGG legacy name also drifted.
gsList <- function(species, cat, subs = NULL) {
  fetch <- function(sub) {
    # msigdbr 26.1.0 caches orthologs by target species but not source
    # collection. Reusing a Hallmark-built cache silently truncates later C2/C5
    # mappings, so every collection must build its own complete projection.
    clearOrthologCache(species)
    tryCatch(msigdbr(db_species = MSIGDB_AUTHORITY, species = species, collection = cat, subcollection = sub),
             error = function(e) tryCatch(msigdbr(db_species = MSIGDB_AUTHORITY, species = species, category = cat, subcategory = sub),
                                          error = function(e2) NULL))
  }
  tb <- NULL
  for (sub in if (is.null(subs)) list(NULL) else subs) {
    tb <- fetch(sub)
    if (!is.null(tb) && nrow(tb) > 0) break
  }
  if (is.null(tb) || !nrow(tb)) return(list())
  pathways <- split(tb$gene_symbol, tb$gs_name)
  attr(pathways, "source_collection") <- cat
  attr(pathways, "source_subcollection") <- if (is.null(sub)) "(all)" else sub
  pathways
}

GS_CACHE <- new.env(parent = emptyenv())
getGeneSets <- function(species) {
  key <- make.names(species)
  if (exists(key, envir = GS_CACHE, inherits = FALSE)) return(get(key, envir = GS_CACHE))
  cat(sprintf("building gene sets (%s)…\n", species))
  gs <- list(
    HALLMARK = gsList(species, "H"),
    KEGG     = gsList(species, "C2", list("CP:KEGG_LEGACY", "CP:KEGG", "CP:KEGG_MEDICUS")),
    GO_BP    = gsList(species, "C5", list("GO:BP")),
    REACTOME = gsList(species, "C2", list("CP:REACTOME"))
  )
  for (nm in names(gs)) cat(sprintf("  %-9s %d sets\n", nm, length(gs[[nm]])))
  assign(key, gs, envir = GS_CACHE)
  gs
}

expectedProvenance <- function(dir, geoId, dePath, species, geneSets, rankGeneCount) {
  dbVersions <- unique(msigdbr_collections(db_species = MSIGDB_AUTHORITY)$db_version)
  if (length(dbVersions) != 1L) stop("MSigDB authority did not resolve to one database version")
  values <- c(
    schema_version = PROVENANCE_SCHEMA_VERSION,
    generator = "scripts/regen-r460/run_fgsea_r460.R",
    generator_sha256 = sha256File(GENERATOR_PATH),
    r_version = R.version.string,
    fgsea_version = as.character(packageVersion("fgsea")),
    msigdbr_version = as.character(packageVersion("msigdbr")),
    babelgene_version = as.character(packageVersion("babelgene")),
    msigdb_authority = MSIGDB_AUTHORITY,
    msigdb_db_version = dbVersions,
    target_species = species,
    de_sha256 = sha256File(dePath),
    rank_gene_count = as.character(rankGeneCount),
    rank_statistic = "DE.stat",
    tie_seed = as.character(TIE_SEED),
    fgsea_seed = as.character(FGSEA_SEED),
    seed_policy = SEED_POLICY,
    tie_jitter = TIE_JITTER_POLICY,
    ortholog_cache_policy = ORTHOLOG_CACHE_POLICY,
    output_hash_policy = OUTPUT_HASH_POLICY,
    min_pathway_size = as.character(FGSEA_MIN),
    max_pathway_size = as.character(FGSEA_MAX)
  )
  for (nm in names(geneSets)) {
    prefix <- tolower(nm)
    resultPath <- file.path(dir, sprintf("%s_FGSEA_%s.tsv", geoId, nm))
    result <- fread(resultPath)
    values <- c(values, setNames(c(
      attr(geneSets[[nm]], "source_collection"),
      attr(geneSets[[nm]], "source_subcollection"),
      as.character(length(geneSets[[nm]])),
      membershipSha256(geneSets[[nm]]),
      as.character(nrow(result)),
      sha256File(resultPath)
    ), paste0(prefix, c(
      "_source_collection", "_source_subcollection", "_pathway_count",
      "_membership_sha256", "_result_rows", "_result_sha256"
    ))))
  }
  focalPath <- file.path(dir, sprintf("%s_fgsea.tsv", geoId))
  focal <- fread(focalPath)
  c(values,
    focal_result_rows = as.character(nrow(focal)),
    focal_result_sha256 = sha256File(focalPath)
  )
}

validateCurrentSet <- function(dir, geoId, dePath, species, geneSets, rankGeneCount) {
  validateOutputSet(dir, geoId)
  provenancePath <- file.path(dir, sprintf("%s_FGSEA_provenance.tsv", geoId))
  actual <- fread(provenancePath, colClasses = "character")
  if (!identical(names(actual), c("key", "value")) || anyDuplicated(actual$key) ||
      anyNA(actual$key) || anyNA(actual$value) || any(!nzchar(actual$key)) || any(!nzchar(actual$value))) {
    stop("FGSEA provenance is missing, duplicated, or malformed for ", geoId)
  }
  expected <- expectedProvenance(dir, geoId, dePath, species, geneSets, rankGeneCount)
  expectedKeys <- names(expected)
  expectedValues <- unname(expected)
  if (!identical(actual$key, expectedKeys) || !identical(actual$value, expectedValues)) {
    shared <- intersect(actual$key, expectedKeys)
    actualByKey <- setNames(actual$value, actual$key)
    changed <- shared[actualByKey[shared] != expected[shared]]
    missing <- setdiff(expectedKeys, actual$key)
    extra <- setdiff(actual$key, expectedKeys)
    details <- c(
      if (length(changed)) paste0("changed: ", paste(changed, collapse = ", ")),
      if (length(missing)) paste0("missing: ", paste(missing, collapse = ", ")),
      if (length(extra)) paste0("extra: ", paste(extra, collapse = ", "))
    )
    stop("existing FGSEA output/provenance is stale for ", geoId, " (", paste(details, collapse = "; "), "); rerun with --force")
  }
}

# Optional dataset-id filter: `Rscript scripts/regen-r460/run_fgsea_r460.R GSE252779` rebuilds
# just that set. Pass `--force` to replace an existing complete output set. No
# dataset arguments = every DE table found, as before.
args <- commandArgs(trailingOnly = TRUE)
force <- "--force" %in% args
only <- args[!startsWith(args, "--")]
# HYPO_OUT_ROOT=<dir> (the staging overlay of scripts/lib/de_common.R) scans the
# DE tables under <dir>/<dataset dir>/processed/ instead of geo_replication/ and
# writes every FGSEA output next to them; the repository is not touched.
OUT_ROOT <- Sys.getenv("HYPO_OUT_ROOT", "")
SCAN_ROOT <- if (nzchar(OUT_ROOT)) OUT_ROOT else GEO
deFiles <- list.files(SCAN_ROOT, pattern = "_DE\\.tsv$", recursive = TRUE, full.names = TRUE)
if (length(only)) deFiles <- deFiles[sub("_DE\\.tsv$", "", basename(deFiles)) %in% only]
cat(sprintf("found %d DE tables%s\n", length(deFiles),
            if (length(only)) sprintf(" (filtered to %s)", paste(only, collapse = ", ")) else ""))

for (f in deFiles) {
  geoId <- sub("_DE\\.tsv$", "", basename(f))
  if (geoId %in% EXCLUDED_DATASETS) {
    cat("skip (explicitly out-of-scope macaque single-cell dataset):", geoId, "\n")
    next
  }
  outdir <- dirname(f)
  fullNames <- sprintf("%s_FGSEA_%s.tsv", geoId, c("HALLMARK", "KEGG", "GO_BP", "REACTOME"))
  currentNames <- c(fullNames, sprintf("%s_fgsea.tsv", geoId), sprintf("%s_FGSEA_provenance.tsv", geoId))
  currentPaths <- file.path(outdir, currentNames)
  rk <- rankVector(f)
  if (is.null(rk)) {
    if (any(file.exists(currentPaths))) stop("existing FGSEA outputs have no valid ranked DE input: ", geoId)
    cat("skip (schema):", f, "\n")
    next
  }
  if (length(rk) < FGSEA_MIN) {
    if (any(file.exists(currentPaths))) stop("existing FGSEA outputs have too few ranked genes: ", geoId)
    cat("skip (too few genes):", f, "\n")
    next
  }
  configured <- configuredOrganism(geoId, f)
  if (length(configured) != 1L || is.na(configured) || !nzchar(configured)) {
    if (any(file.exists(currentPaths))) stop("existing FGSEA outputs have no unique configured organism: ", geoId)
    cat("skip (organism not uniquely configured):", geoId, "\n")
    next
  }
  if (!force && all(file.exists(currentPaths))) {
    GS <- getGeneSets(configured)
    validateCurrentSet(outdir, geoId, f, configured, GS, length(rk))
    cat("skip (validated current set):", geoId, "\n")
    next
  }
  provenancePath <- file.path(outdir, sprintf("%s_FGSEA_provenance.tsv", geoId))
  if (!force && !file.exists(provenancePath) && all(file.exists(file.path(outdir, fullNames)))) {
    stop("legacy FGSEA set has no complete provenance; rerun with --force to migrate: ", geoId)
  }
  if (!force && any(file.exists(currentPaths))) {
    stop("partial FGSEA output set exists; inspect it and rerun with --force: ", geoId)
  }
  GS <- getGeneSets(configured)
  set.seed(TIE_SEED)
  rk <- rk + runif(length(rk), 0, 1e-7)   # break ties, matching macaque
  rk <- sort(rk, decreasing = TRUE)

  results <- list()
  reactomeResult <- NULL
  for (nm in names(GS)) {
    if (!length(GS[[nm]])) next
    set.seed(FGSEA_SEED)
    res <- tryCatch(
      fgsea(pathways = GS[[nm]], stats = rk, minSize = FGSEA_MIN, maxSize = FGSEA_MAX,
            BPPARAM = BiocParallel::SerialParam()),
      error = function(e) { cat("  fgsea error", nm, conditionMessage(e), "\n"); NULL })
    if (is.null(res) || !nrow(res)) next
    res <- as.data.frame(res)
    res$leadingEdge <- vapply(res$leadingEdge, paste, collapse = ";", FUN.VALUE = character(1))
    if (nm == "REACTOME") reactomeResult <- res
    published <- res[, c("pathway", "pval", "padj", "NES", "size", "leadingEdge")]
    results[[nm]] <- published
  }
  if (!setequal(names(results), names(GS)) || is.null(reactomeResult)) {
    stop("one or more FGSEA collections did not produce an output for ", geoId)
  }

  focal <- reactomeResult[
    grepl("IGF_TRANSPORT_AND_UPTAKE", reactomeResult$pathway) |
      grepl("SIGNALING_BY_TYPE_1.*IGF1R|TYPE_1_INSULIN_LIKE_GROWTH_FACTOR_1_RECEPTOR", reactomeResult$pathway),
    c("pathway", "pval", "padj", "log2err", "ES", "NES", "size", "leadingEdge")
  ]
  focal$dataset <- geoId

  # Stage every collection, the focal view, and provenance before replacing any
  # committed result. A compute/validation failure therefore cannot leave a
  # mixture of generations on disk.
  stageDir <- tempfile(pattern = paste0(".", geoId, "_fgsea_"), tmpdir = outdir)
  dir.create(stageDir)
  tryCatch({
    for (nm in names(results)) {
      # LF on every platform (fwrite defaults to CRLF on Windows).
      fwrite(results[[nm]], file.path(stageDir, sprintf("%s_FGSEA_%s.tsv", geoId, nm)), sep = "\t", eol = "\n")
    }
    fwrite(focal, file.path(stageDir, sprintf("%s_fgsea.tsv", geoId)), sep = "\t", eol = "\n")
    validateOutputSet(stageDir, geoId)
    provenanceValues <- expectedProvenance(stageDir, geoId, f, configured, GS, length(rk))
    provenance <- data.table(provenance_key = names(provenanceValues), value = unname(provenanceValues))
    setnames(provenance, "provenance_key", "key")
    fwrite(provenance, file.path(stageDir, sprintf("%s_FGSEA_provenance.tsv", geoId)), sep = "\t", eol = "\n")
    validateCurrentSet(stageDir, geoId, f, configured, GS, length(rk))

    staged <- file.path(stageDir, currentNames)
    destinations <- file.path(outdir, currentNames)
    existed <- file.exists(destinations)
    backupDir <- file.path(stageDir, "backup")
    dir.create(backupDir)
    if (any(existed) && !all(file.copy(destinations[existed], backupDir))) {
      stop("could not back up the existing FGSEA set for ", geoId)
    }
    published <- FALSE
    tryCatch({
      copied <- file.copy(staged, destinations, overwrite = TRUE)
      if (!all(copied)) stop("could not publish every staged FGSEA output for ", geoId)
      validateCurrentSet(outdir, geoId, f, configured, GS, length(rk))
      published <- TRUE
    }, error = function(e) {
      if (any(existed)) file.copy(file.path(backupDir, basename(destinations[existed])), destinations[existed], overwrite = TRUE)
      if (any(!existed)) unlink(destinations[!existed], force = TRUE)
      stop(e)
    })
    if (!published) stop("FGSEA publication did not complete for ", geoId)
  }, finally = unlink(stageDir, recursive = TRUE, force = TRUE))

  n <- sum(vapply(results, nrow, integer(1)))
  cat(sprintf("%-16s %5d genes -> %d pathway rows\n", geoId, length(rk), n))
}
cat("done.\n")
