#' =====================================================================
#' Some instructions for an easy set up check pre-workshop!
#'   1. Open the workshop folder as a project (double-click
#'      mixed-effects-workshop.Rproj to open in RStudio,
#'      or open the folder in Positron/VS Code)
#'   2. Open this file and click "Source" (or run: source("setup.R"))
#'
#' It will install anything you're missing and run a quick test.
#' =====================================================================

cat("\nLet's check out your setup!\n\n")

# 1. R version -------------------------------------------------------
if (getRversion() < "4.2.0") {
    stop("You're running R ", getRversion(), ". Please update to R 4.2 or ",
         "newer (https://cran.r-project.org), then run this script again.")
}
cat("[Good to go!] R version", as.character(getRversion()), "\n")

# 2. Packages --------------------------------------------------------
pkgs <- c("lme4", "lmerTest", "ggplot2", "here")

is_installed <- function(p) requireNamespace(p, quietly = TRUE)
missing <- pkgs[!vapply(pkgs, is_installed, logical(1))]

if (length(missing) > 0) {
    cat("Installing:", paste(missing, collapse = ", "), "\n")
    install.packages(missing, repos = "https://cloud.r-project.org")
}

still_missing <- pkgs[!vapply(pkgs, is_installed, logical(1))]
if (length(still_missing) > 0) {
    stop("These packages didn't install: ",
         paste(still_missing, collapse = ", "),
         ". Please troubleshoot or come early to the session.")
}
cat("[Good to go!] Packages:", paste(pkgs, collapse = ", "), "\n")

# 4. Can we find the workshop files? ---------------------------------
data_path <- here::here("assets", "data", "crop_yield_data.csv")
if (!file.exists(data_path)) {
    stop("Couldn't find the workshop data at:\n  ", data_path,
         "\nMake sure you've opened the workshop folder as a project ",
         "(see the top of this file), then run this script again.")
}
crop <- read.csv(data_path)
cat("[Good to go!] Workshop data found (", nrow(crop), " rows)\n", sep = "")

source(here::here("assets", "scripts", "data_gen.R"))
invisible(simulate_crop_yield())
cat("[Good to go!] Simulation function loads\n")

cat("\nAll set! See you at the workshop.\n\n")