#!/usr/bin/env Rscript

# Build a litter-level male-offspring contrast for GSE229440. Prenatal benzene
# exposure was assigned to dams, so litter (not each sibling library) is the
# independent experimental unit. Reverse-strand STAR counts are summed within
# each litter. The publication's OBFH14 RNA-seq outlier is excluded first.

script_arg <- grep("^--file=", commandArgs(FALSE), value = TRUE)
if (length(script_arg) != 1L) stop("cannot resolve this script's path")
script_dir <- dirname(normalizePath(sub("^--file=", "", script_arg)))
root <- normalizePath(file.path(script_dir, ".."))
dataset_dir <- file.path(root, "datasets", "GSE229440_mmus_hypothalamus_prenatal_benzene")
archive <- file.path(dataset_dir, "raw", "GSE229440_RAW.tar")
soft_path <- file.path(dataset_dir, "metadata", "GSE229440_family.soft.gz")

assert <- function(ok, message) if (!isTRUE(ok)) stop(message, call. = FALSE)
assert(file.exists(archive) && file.info(archive)$size == 12103680,
       "GSE229440_RAW.tar is missing or its byte size changed")
assert(file.exists(soft_path) && file.info(soft_path)$size == 6152,
       "GSE229440 family SOFT is missing or its byte size changed")

expected_inventory <- c(
  "GSM7163652_OBFH14.ReadsPerGene.out.tab.gz",
  "GSM7163653_OBFH16.ReadsPerGene.out.tab.gz",
  "GSM7163654_OBFH17.ReadsPerGene.out.tab.gz",
  "GSM7163655_OBFH23.ReadsPerGene.out.tab.gz",
  "GSM7163656_OBFH25.ReadsPerGene.out.tab.gz",
  "GSM7163657_OBFH26.ReadsPerGene.out.tab.gz",
  "GSM7163658_OBFH5.ReadsPerGene.out.tab.gz",
  "GSM7163659_OBFH6.ReadsPerGene.out.tab.gz",
  "GSM7163660_OBFH9.ReadsPerGene.out.tab.gz",
  "GSM7163661_OBMH12.ReadsPerGene.out.tab.gz",
  "GSM7163662_OBMH13.ReadsPerGene.out.tab.gz",
  "GSM7163663_OBMH20.ReadsPerGene.out.tab.gz",
  "GSM7163664_OBMH27.ReadsPerGene.out.tab.gz",
  "GSM7163665_OBMH3.ReadsPerGene.out.tab.gz",
  "GSM7163666_OBMH32.ReadsPerGene.out.tab.gz",
  "GSM7163667_OBMH4.ReadsPerGene.out.tab.gz",
  "GSM7163668_OCFH1.ReadsPerGene.out.tab.gz",
  "GSM7163669_OCFH11.ReadsPerGene.out.tab.gz",
  "GSM7163670_OCFH15.ReadsPerGene.out.tab.gz",
  "GSM7163671_OCFH28.ReadsPerGene.out.tab.gz",
  "GSM7163672_OCFH29.ReadsPerGene.out.tab.gz",
  "GSM7163673_OCFH30.ReadsPerGene.out.tab.gz",
  "GSM7163674_OCFH33.ReadsPerGene.out.tab.gz",
  "GSM7163675_OCFH8.ReadsPerGene.out.tab.gz",
  "GSM7163676_OCMH10.ReadsPerGene.out.tab.gz",
  "GSM7163677_OCMH18.ReadsPerGene.out.tab.gz",
  "GSM7163678_OCMH19.ReadsPerGene.out.tab.gz",
  "GSM7163679_OCMH2.ReadsPerGene.out.tab.gz",
  "GSM7163680_OCMH21.ReadsPerGene.out.tab.gz",
  "GSM7163681_OCMH22.ReadsPerGene.out.tab.gz",
  "GSM7163682_OCMH24.ReadsPerGene.out.tab.gz",
  "GSM7163683_OCMH31.ReadsPerGene.out.tab.gz",
  "GSM7163684_OCMH7.ReadsPerGene.out.tab.gz"
)
listed <- utils::untar(archive, list = TRUE)
assert(length(listed) == 33L && setequal(listed, expected_inventory),
       "GSE229440 archive inventory changed")

animals <- data.frame(
  sample = c(
    "GSM7163652", "GSM7163658", "GSM7163661", "GSM7163662",
    "GSM7163664", "GSM7163665", "GSM7163666",
    sprintf("GSM%d", 7163676:7163684)
  ),
  group = c(rep("case", 7L), rep("control", 9L)),
  condition = c(rep("prenatal_benzene_male", 7L), rep("filtered_air_male", 9L)),
  litter = c(2L, 2L, 3L, 2L, 3L, 3L, 1L, 3L, 2L, 2L, 1L, 2L, 1L, 3L, 3L, 1L),
  source_file = c(
    expected_inventory[1], expected_inventory[7], expected_inventory[10:11],
    expected_inventory[13:15], expected_inventory[25:33]
  ),
  expected_title = c(
    "male offspring / benzene exposed mother library#14",
    "male offspring / benzene exposed mother library#5",
    "male offspring / benzene exposed mother library#12",
    "male offspring / benzene exposed mother library#13",
    "male offspring / benzene exposed mother library#27",
    "male offspring / benzene exposed mother library#3",
    "male offspring / benzene exposed mother library#32",
    "male offspring / control mother library#10",
    "male offspring / control mother library#18",
    "male offspring / control mother library#19",
    "male offspring / control mother library#2",
    "male offspring / control mother library#21",
    "male offspring / control mother library#22",
    "male offspring / control mother library#24",
    "male offspring / control mother library#31",
    "male offspring / control mother library#7"
  ),
  analysis_keep = c(FALSE, rep(TRUE, 15L)),
  exclusion_reason = c(
    "publication excludes OBFH14 for greater than two-fold higher median Cook's distance",
    rep("", 15L)
  ),
  stringsAsFactors = FALSE
)
assert(length(unique(animals$litter[animals$analysis_keep & animals$group == "case"])) == 3L &&
         length(unique(animals$litter[animals$analysis_keep & animals$group == "control"])) == 3L,
       "retained male offspring no longer span three litters in each exposure arm")

soft <- readLines(gzfile(soft_path), warn = FALSE)
starts <- grep("^\\^SAMPLE = ", soft)
ends <- c(starts[-1L] - 1L, length(soft))
assert(length(starts) == 33L, "family SOFT no longer contains 33 samples")
for (i in seq_len(nrow(animals))) {
  block_index <- which(vapply(starts, function(j) {
    identical(soft[j], paste0("^SAMPLE = ", animals$sample[i]))
  }, logical(1)))
  assert(length(block_index) == 1L, paste("missing SOFT block for", animals$sample[i]))
  block <- soft[starts[block_index]:ends[block_index]]
  treatment <- if (animals$group[i] == "case") "Benzene" else "Control"
  required <- c(
    paste0("!Sample_title = ", animals$expected_title[i]),
    "!Sample_source_name_ch1 = hypothalamus",
    "!Sample_characteristics_ch1 = tissue: hypothalamus",
    "!Sample_characteristics_ch1 = genotype: C57BL/6JB",
    paste0("!Sample_characteristics_ch1 = litter: ", animals$litter[i]),
    "!Sample_characteristics_ch1 = Sex: Male",
    paste0("!Sample_characteristics_ch1 = treatment: ", treatment),
    "!Sample_library_strategy = RNA-Seq",
    paste0(
      "!Sample_supplementary_file_1 = ftp://ftp.ncbi.nlm.nih.gov/geo/samples/GSM7163nnn/",
      animals$sample[i], "/suppl/", animals$source_file[i]
    )
  )
  assert(all(required %in% block), paste("SOFT metadata changed for", animals$sample[i]))
}

extract_dir <- tempfile("GSE229440_extract_")
dir.create(extract_dir)
on.exit(unlink(extract_dir, recursive = TRUE, force = TRUE), add = TRUE)
utils::untar(archive, exdir = extract_dir)
assert(setequal(list.files(extract_dir), expected_inventory),
       "extracted GSE229440 inventory differs from the archive listing")

star_summary_ids <- c("N_unmapped", "N_multimapping", "N_noFeature", "N_ambiguous")
animal_counts <- vector("list", nrow(animals))
names(animal_counts) <- animals$sample
reference_ids <- NULL
expected_retained_libraries <- c(
  16893811, 18080981, 20243456, 21033663, 18328225, 19294081,
  21483573, 15214128, 17798894, 16010284, 18405638, 18077772,
  16617252, 18959029, 17580894
)
expected_retained_detected <- c(
  26767L, 27244L, 27224L, 27442L, 27068L, 27354L,
  27369L, 26504L, 26764L, 26657L, 27073L, 26842L,
  26553L, 27448L, 26891L
)
retained_index <- 0L

for (i in seq_len(nrow(animals))) {
  path <- file.path(extract_dir, animals$source_file[i])
  d <- read.delim(
    gzfile(path), header = FALSE, sep = "\t", quote = "",
    comment.char = "", stringsAsFactors = FALSE, check.names = FALSE
  )
  assert(ncol(d) == 4L && nrow(d) == 55475L,
         paste("unexpected STAR-count dimensions in", animals$source_file[i]))
  assert(identical(as.character(d[[1]][1:4]), star_summary_ids),
         paste("STAR summary rows changed in", animals$source_file[i]))
  values <- as.matrix(d[, 2:4, drop = FALSE])
  storage.mode(values) <- "numeric"
  assert(!anyNA(values) && all(is.finite(values)) && all(values >= 0) &&
           all(values == round(values)),
         paste("non-integer or invalid counts in", animals$source_file[i]))
  gene_ids <- as.character(d[[1]][-(1:4)])
  gene_counts <- values[-(1:4), 3L]
  forward_counts <- values[-(1:4), 2L]
  assert(length(gene_ids) == 55471L && !anyDuplicated(gene_ids),
         paste("gene rows are invalid in", animals$source_file[i]))
  assert(sum(gene_counts) > 10 * sum(forward_counts),
         paste("reverse-strand count dominance changed in", animals$source_file[i]))
  if (is.null(reference_ids)) reference_ids <- gene_ids
  assert(identical(gene_ids, reference_ids),
         paste("gene order differs in", animals$source_file[i]))
  if (animals$analysis_keep[i]) {
    retained_index <- retained_index + 1L
    assert(sum(gene_counts) == expected_retained_libraries[retained_index] &&
             sum(gene_counts > 0) == expected_retained_detected[retained_index],
           paste("pinned count totals changed in", animals$source_file[i]))
  }
  animal_counts[[i]] <- gene_counts
}
assert(retained_index == 15L, "retained-animal inventory changed")

aggregates <- data.frame(
  sample = c(
    "control_male_litter1", "control_male_litter2", "control_male_litter3",
    "benzene_male_litter1", "benzene_male_litter2", "benzene_male_litter3"
  ),
  group = c(rep("control", 3L), rep("case", 3L)),
  condition = c(rep("filtered_air_male", 3L), rep("prenatal_benzene_male", 3L)),
  sex = "male",
  litter = rep(1:3, 2L),
  source_samples = c(
    "GSM7163679;GSM7163681;GSM7163684",
    "GSM7163677;GSM7163678;GSM7163680",
    "GSM7163676;GSM7163682;GSM7163683",
    "GSM7163666",
    "GSM7163658;GSM7163662",
    "GSM7163661;GSM7163664;GSM7163665"
  ),
  stringsAsFactors = FALSE
)
aggregates$source_animal_count <- lengths(strsplit(aggregates$source_samples, ";", fixed = TRUE))
assert(identical(as.integer(table(aggregates$group)[c("control", "case")]), c(3L, 3L)),
       "litter aggregation is no longer 3 control versus 3 case units")

count_matrix <- matrix(
  0, nrow = length(reference_ids), ncol = nrow(aggregates),
  dimnames = list(reference_ids, aggregates$sample)
)
for (i in seq_len(nrow(aggregates))) {
  source_samples <- strsplit(aggregates$source_samples[i], ";", fixed = TRUE)[[1]]
  assert(all(source_samples %in% animals$sample[animals$analysis_keep]),
         paste("aggregate includes an excluded or unknown source for", aggregates$sample[i]))
  count_matrix[, i] <- Reduce(`+`, animal_counts[source_samples])
}
storage.mode(count_matrix) <- "numeric"
assert(all(count_matrix == round(count_matrix)) && all(count_matrix >= 0),
       "litter count matrix is not nonnegative integer counts")

expected_litter_libraries <- c(51668950, 51418660, 57059854, 19294081, 37137267, 57442869)
expected_litter_detected <- c(30872L, 30821L, 31282L, 27354L, 29490L, 31309L)
assert(identical(as.numeric(colSums(count_matrix)), expected_litter_libraries) &&
         identical(as.integer(colSums(count_matrix > 0)), expected_litter_detected),
       "pinned litter-level count totals changed")

qc <- aggregates
qc$source_files <- vapply(strsplit(qc$source_samples, ";", fixed = TRUE), function(gsms) {
  paste(animals$source_file[match(gsms, animals$sample)], collapse = ";")
}, character(1))
qc$source_gene_rows <- nrow(count_matrix)
qc$star_summary_rows_removed_per_source <- 4L
qc$selected_count_column <- 4L
qc$source_library_size <- vapply(strsplit(qc$source_samples, ";", fixed = TRUE), function(gsms) {
  sum(vapply(animal_counts[gsms], sum, numeric(1)))
}, numeric(1))
qc$library_size <- as.numeric(colSums(count_matrix))
qc$detected_genes <- as.integer(colSums(count_matrix > 0))
qc$integer_counts <- TRUE
qc$nonnegative_counts <- TRUE
qc$merged_gene_rows <- nrow(count_matrix)
qc$count_conservation_delta <- qc$library_size - qc$source_library_size
qc$analysis_keep <- TRUE
assert(all(qc$count_conservation_delta == 0), "litter aggregation does not conserve counts")

counts_path <- file.path(dataset_dir, "raw", "GSE229440_male_litter_counts.tsv.gz")
samplesheet_path <- file.path(dataset_dir, "metadata", "GSE229440_samplesheet.tsv")
qc_path <- file.path(dataset_dir, "processed", "GSE229440_preprocessing_qc.tsv")

out <- data.frame(gene_id = rownames(count_matrix), count_matrix,
                  check.names = FALSE, stringsAsFactors = FALSE)
con <- gzfile(counts_path, "wt")
write.table(out, con, sep = "\t", quote = FALSE, row.names = FALSE)
close(con)
write.table(aggregates, samplesheet_path, sep = "\t", quote = FALSE, row.names = FALSE)
write.table(qc, qc_path, sep = "\t", quote = FALSE, row.names = FALSE)

cat(sprintf(
  paste0(
    "GSE229440 prepared: %d genes x %d independent litters from 15 retained male offspring; ",
    "control=%d case=%d; libraries %.2fM-%.2fM; exact conservation; OBFH14 excluded\n"
  ),
  nrow(count_matrix), ncol(count_matrix), sum(aggregates$group == "control"),
  sum(aggregates$group == "case"), min(colSums(count_matrix)) / 1e6,
  max(colSums(count_matrix)) / 1e6
))
