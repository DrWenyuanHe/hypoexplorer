#!/usr/bin/env Rscript

# Manual integration test for the actual runner's non-force integrity gate.
# All mutations happen in an isolated temporary workspace, never in datasets.
main <- function() {
  fileArg <- grep("^--file=", commandArgs(FALSE), value = TRUE)[[1L]]
  scriptDir <- dirname(normalizePath(sub("^--file=", "", fileArg)))
  root <- normalizePath(file.path(scriptDir, ".."))
  runner <- file.path(scriptDir, "run_mouse_fgsea.R")
  id <- "GSE124693"
  relativeDir <- file.path("geo_replication", "datasets", "GSE124693_mmus_agrp_ribotag_fasting", "processed")
  sourceDir <- file.path(root, relativeDir)
  fixture <- tempfile("fgsea-integrity-", tmpdir = tempdir())
  dir.create(fixture)
  fixture <- normalizePath(fixture, winslash = "/")
  safeTempRoot <- paste0(normalizePath(tempdir(), winslash = "/"), "/")
  if (!startsWith(fixture, safeTempRoot) || fixture == sub("/$", "", safeTempRoot)) stop("unsafe fixture path")
  originalWd <- getwd()
  on.exit({
    setwd(originalWd)
    if (!startsWith(fixture, safeTempRoot)) stop("fixture cleanup escaped temporary root")
    unlink(fixture, recursive = TRUE, force = TRUE)
  }, add = TRUE)
  targetDir <- file.path(fixture, relativeDir)
  dir.create(targetDir, recursive = TRUE)
  configDir <- file.path(fixture, "geo_replication", "config")
  dir.create(configDir, recursive = TRUE)
  stopifnot(file.copy(file.path(root, "geo_replication", "config", "datasets.tsv"), configDir))
  collections <- c("HALLMARK", "KEGG", "GO_BP", "REACTOME")
  filenames <- c(paste0(id, "_DE.tsv"), paste0(id, "_FGSEA_", collections, ".tsv"),
                 paste0(id, "_fgsea.tsv"), paste0(id, "_FGSEA_provenance.tsv"))
  stopifnot(all(file.copy(file.path(sourceDir, filenames), targetDir)))
  setwd(fixture)
  rscript <- file.path(R.home("bin"), "Rscript.exe")
  if (!file.exists(rscript)) rscript <- file.path(R.home("bin"), "Rscript")
  runExpect <- function(status, pattern, label) {
    output <- suppressWarnings(system2(rscript, c(shQuote(runner), id), stdout = TRUE, stderr = TRUE))
    observed <- attr(output, "status")
    if (is.null(observed)) observed <- 0L
    if (observed != status || !any(grepl(pattern, output, fixed = TRUE))) {
      stop(label, " did not fail/pass as expected:\n", paste(output, collapse = "\n"))
    }
    cat("PASS:", label, "\n")
  }
  runExpect(0L, "skip (validated current set)", "untouched complete set")
  focalNames <- read.delim(file.path(targetDir, paste0(id, "_fgsea.tsv")))$pathway
  for (collection in collections) {
    name <- paste0(id, "_FGSEA_", collection, ".tsv")
    path <- file.path(targetDir, name)
    lines <- readLines(path, warn = FALSE)
    candidates <- which(!vapply(strsplit(lines[-1L], "\t", fixed = TRUE), function(cells) cells[[1L]] %in% focalNames, logical(1))) + 1L
    index <- candidates[[1L]]
    cells <- strsplit(lines[[index]], "\t", fixed = TRUE)[[1L]]
    cells[[6L]] <- paste0(cells[[6L]], ";__AUDIT_TAMPER__")
    lines[[index]] <- paste(cells, collapse = "\t")
    writeLines(lines, path, useBytes = TRUE)
    runExpect(1L, paste0(tolower(collection), "_result_sha256"), paste(collection, "non-focal output mutation"))
    stopifnot(file.copy(file.path(sourceDir, name), path, overwrite = TRUE))
  }
  provenanceName <- paste0(id, "_FGSEA_provenance.tsv")
  provenancePath <- file.path(targetDir, provenanceName)
  lines <- readLines(provenancePath, warn = FALSE)
  index <- grep("^go_bp_membership_sha256\\t", lines)
  lines[index] <- paste("go_bp_membership_sha256", paste(rep("0", 64L), collapse = ""), sep = "\t")
  writeLines(lines, provenancePath, useBytes = TRUE)
  runExpect(1L, "go_bp_membership_sha256", "altered collection-membership provenance")
  stopifnot(file.copy(file.path(sourceDir, provenanceName), provenancePath, overwrite = TRUE))
  stopifnot(file.remove(provenancePath))
  runExpect(1L, "legacy FGSEA set has no complete provenance", "legacy set cannot be grandfathered")
  stopifnot(file.copy(file.path(sourceDir, provenanceName), provenancePath))
  stopifnot(file.remove(file.path(targetDir, paste0(id, "_FGSEA_KEGG.tsv"))))
  runExpect(1L, "partial FGSEA output set exists", "partial set cannot be accepted")
  cat("FGSEA runner integrity integration tests passed (8 cases).\n")
}

main()
