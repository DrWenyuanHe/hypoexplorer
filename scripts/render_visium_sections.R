# Render the curated HYPOMAP Visium section images for the expression survey's
# Visium reference (scripts/build_visium_reference.mts).
#
#   Rscript scripts/render_visium_sections.R <humanHYPOMAP_spatial.rds> <out-dir> GENE [GENE ...]
#
# The builder runs this from `--fetch --sections` after checking the RDS; it can
# also be run by hand. Needs Seurat (VisiumV1 images), SeuratObject, Matrix,
# RANN and webp. Pixels are computed with array operations, not a graphics
# device, so they depend only on the data and these rules:
#   value   the authors' per-spot log1p(count / spot library x 1e4) (Seurat
#           LogNormalize) on a fixed 0-3 scale, higher values squished, as in
#           Tadross et al. 2025 Extended Data Fig. 3; coloured from light grey
#           (zero) through mint and teal to dark green
#   regions each spot coloured by the authors' grouped regional cluster, one
#           image per section, with label positions for the main nuclei
#   spot    a disc 1.25 x the 100 um spot spacing across, centred on the stored
#           low-resolution coordinates, so neighbouring spots touch and cover
#           the tissue; where discs overlap the higher value is shown
#   frame   each section cropped to its spots plus a margin on white, scaled so
#           the longer side is 560 px; WebP quality 55
#   order   the authors' anterior-to-posterior order, shown as Section 1-9
# Writes <out-dir>/frames.tsv (section number, image size, spots),
# <out-dir>/region-labels.tsv (section, region, x, y in image pixels),
# <out-dir>/legend.tsv (the value colour stops and each region's colour),
# <out-dir>/regions/section-<n>.webp and <out-dir>/<GENE>/section-<n>.webp.
# Capture-area names and donors are not written.
suppressPackageStartupMessages({ library(SeuratObject); library(Seurat); library(Matrix); library(webp) })

args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) >= 3)
obj <- readRDS(args[[1]])
out <- args[[2]]
genes <- args[-(1:2)]
ORDER <- c("slice5A", "sliceC1A", "slice6B", "sliceB1B", "slice2B", "slice4B", "slice7A", "slice3A", "slice8B")
stopifnot(setequal(ORDER, Images(obj)))
LONG_SIDE <- 560
MARGIN <- 0.03
WEBP_QUALITY <- 55
SPOT_FACTOR <- 1.25   # drawn diameter as a share of the 100 um spot spacing: neighbouring spots touch
# Light grey for zero, then mint, teal and dark green, interpolated linearly in RGB.
PALETTE <- colorRampPalette(c("#E9E9E9", "#B7D7CF", "#4FA593", "#16695C", "#06302A"))(256)
REGION_COLOURS <- c(
  POA = "#D4E4DA", MPOA = "#8FB9A8", LPOA = "#BFD8CB", SCN = "#F2B880", SON = "#E07A5F", PVN = "#C8553D",
  Periventricular = "#E3C0A8", ARC = "#3D5A80", ME = "#14213D", VMH = "#98C1D9", DMH = "#6D8EB0",
  LH = "#E2DCCB", "LH/RCN" = "#E8E3D4", LTN = "#AEB8C6", TMN = "#B39C82", MAM = "#7A6C5D",
  "Fx/LH" = "#EDE8DA", "Fx/OT/ac" = "#F1ECDF", OT = "#F1ECDF", Ventricular = "#8E6C9E", Vascular = "#B23A48",
  Thalamus = "#D9D9D9", Unassigned = "#ECECEC")
# Nuclei labelled on the regions images where a section holds at least LABEL_MIN_SPOTS of them.
LABELLED <- c("MPOA", "SCN", "SON", "PVN", "ARC", "ME", "VMH", "DMH", "TMN", "MAM")
LABEL_MIN_SPOTS <- 150
LABEL_GAP <- 120
rgb_of <- t(col2rgb(PALETTE)) / 255
region_rgb <- t(col2rgb(REGION_COLOURS)) / 255
rownames(region_rgb) <- names(REGION_COLOURS)

counts <- GetAssayData(obj, assay = "Spatial", layer = "counts")
missing <- setdiff(genes, rownames(counts))
if (length(missing)) stop("not in the panel: ", paste(missing, collapse = ", "))
library_size <- Matrix::colSums(counts)
region_of <- as.character(obj$regional_clusters_grouped)
names(region_of) <- colnames(obj)
stopifnot(setequal(unique(region_of), names(REGION_COLOURS)))

frames <- list()
for (n in seq_along(ORDER)) {
  v <- obj[[ORDER[n]]]
  co <- GetTissueCoordinates(v)            # low-resolution image row / col, 1-based pixel space
  # Spots sit 100 um apart; the median nearest-neighbour distance is that spacing in image pixels.
  spacing <- median(RANN::nn2(co[, c("imagerow", "imagecol")], k = 2)$nn.dists[, 2])
  rr <- range(co$imagerow); cc <- range(co$imagecol)
  pad <- MARGIN * max(diff(rr), diff(cc))
  top <- rr[1] - pad; left <- cc[1] - pad
  scale <- LONG_SIDE / (max(diff(rr), diff(cc)) + 2 * pad)
  height <- round((diff(rr) + 2 * pad) * scale); width <- round((diff(cc) + 2 * pad) * scale)
  radius <- SPOT_FACTOR * spacing * scale / 2
  span <- ceiling(radius)
  offsets <- expand.grid(dr = -span:span, dc = -span:span)
  offsets <- offsets[offsets$dr^2 + offsets$dc^2 <= radius^2, ]
  frames[[n]] <- list(spots = rownames(co), height = height, width = width, offsets = offsets,
    pr = round((co$imagerow - top) * scale + 0.5), pc = round((co$imagecol - left) * scale + 0.5))
  cat(sprintf("Section %d: %d x %d px, %d spots, spot spacing %.3f low-res px, disc radius %.2f px\n",
    n, width, height, nrow(co), spacing, radius))
}

# Paint each spot's disc; where discs overlap, the spot with the higher rank wins.
paint <- function(f, rank, colour_of_rank) {
  best <- integer(f$height * f$width)
  for (k in seq_len(nrow(f$offsets))) {
    r <- f$pr + f$offsets$dr[k]; c <- f$pc + f$offsets$dc[k]
    ok <- r >= 1 & r <= f$height & c >= 1 & c <= f$width
    at <- (c[ok] - 1) * f$height + r[ok]
    best[at] <- pmax(best[at], rank[ok])
  }
  canvas <- array(1, c(f$height, f$width, 3))
  plane <- f$height * f$width
  hit <- which(best > 0)
  colours <- colour_of_rank[best[hit], , drop = FALSE]
  for (ch in 1:3) canvas[hit + (ch - 1) * plane] <- colours[, ch]
  canvas
}

dir.create(file.path(out, "regions"), recursive = TRUE, showWarnings = FALSE)
labels <- character()
for (n in seq_along(frames)) {
  f <- frames[[n]]
  region <- region_of[f$spots]
  rank <- seq_along(f$spots)               # stored spot order
  write_webp(paint(f, rank, region_rgb[region, , drop = FALSE]), file.path(out, "regions", sprintf("section-%d.webp", n)),
    quality = WEBP_QUALITY)
  # Larger regions are labelled first; a label closer than LABEL_GAP px to one already placed is dropped.
  sizes <- sapply(LABELLED, function(key) sum(region == key))
  placed <- NULL
  for (key in LABELLED[order(-sizes, seq_along(LABELLED))]) {
    own <- which(region == key)
    if (length(own) < LABEL_MIN_SPOTS) next
    # The region's own spot nearest its median position, so the label sits on the region.
    at <- own[which.min((f$pr[own] - median(f$pr[own]))^2 + (f$pc[own] - median(f$pc[own]))^2)]
    if (!is.null(placed) && any((placed[, 1] - f$pc[at])^2 + (placed[, 2] - f$pr[at])^2 < LABEL_GAP^2)) next
    placed <- rbind(placed, c(f$pc[at], f$pr[at]))
    labels <- c(labels, sprintf("%d\t%s\t%d\t%d", n, key, f$pc[at], f$pr[at]))
  }
}
cat("regions rendered\n")

for (gene in genes) {
  dir.create(file.path(out, gene), recursive = TRUE, showWarnings = FALSE)
  for (n in seq_along(frames)) {
    f <- frames[[n]]
    value <- log1p(counts[gene, f$spots] / library_size[f$spots] * 1e4)
    level <- pmin(pmax(round(pmin(value, 3) / 3 * 255), 0), 255) + 1
    # Rank spots by value (ties in stored order), so higher values stay visible.
    o <- order(value, seq_along(value))
    rank <- integer(length(value)); rank[o] <- seq_along(value)
    write_webp(paint(f, rank, rgb_of[level[o], , drop = FALSE]), file.path(out, gene, sprintf("section-%d.webp", n)),
      quality = WEBP_QUALITY)
  }
  cat(gene, "rendered\n")
}

# Binary connections, so the tables are LF-only on every platform (text mode writes CRLF on Windows).
write_lf <- function(lines, file) {
  con <- file(file.path(out, file), open = "wb")
  writeLines(lines, con, sep = "\n", useBytes = TRUE)
  close(con)
}
write_lf(c("section\twidth\theight\tspots", sprintf("%d\t%d\t%d\t%d", seq_along(frames),
  sapply(frames, `[[`, "width"), sapply(frames, `[[`, "height"), sapply(frames, function(f) length(f$spots)))), "frames.tsv")
write_lf(c("section\tregion\tx\ty", labels), "region-labels.tsv")
# The colours, for the page's colour bar and region legend.
write_lf(c("kind\tkey\tcolour", sprintf("stop\t%d\t%s", 0:4, c("#E9E9E9", "#B7D7CF", "#4FA593", "#16695C", "#06302A")),
  sprintf("region\t%s\t%s", names(REGION_COLOURS), REGION_COLOURS)), "legend.tsv")
cat("done\n")
