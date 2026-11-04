# Read every selected source count as an IEEE double and apply the retained prep's
# round(x), digits=0. Output is consumed in memory by the independent Python audit.
x <- scan(file("stdin"), what = double(), quiet = TRUE)
stopifnot(length(x) > 0L, all(is.finite(x)), all(x >= 0))
stopifnot(identical(round(c(0.5, 1.5, 2.5, 3.5, 4.5)), c(0, 2, 2, 4, 4)))
writeLines(format(round(x), scientific = FALSE, trim = TRUE, digits = 17L))
cat(R.version.string, "\nround(x), digits=0; IEEE 60559 nearest with ties to even\n", file = stderr())
