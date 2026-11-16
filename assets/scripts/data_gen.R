#' Simulate hierarchical crop yield data
#'
#' Generates the farm/soil-pH dataset used throughout the linear
#' mixed-effects models guide. Crop yield is measured on experimental
#' plots nested within farms, with each farm having both its own
#' baseline productivity (a varying intercept) and its own sensitivity
#' to soil pH (a varying slope). The two farm-level deviations are
#' negatively correlated, so that farms starting from a higher baseline
#' tend to gain less from an increase in pH.
#'
#' @param seed Integer. Random seed for reproducibility. Defaults to 123.
#'
#' @return A data frame with columns \code{farm_id} (character, farm
#'   label of the form \code{"Farm_01"}), \code{plot_id} (character,
#'   unique plot label), \code{soil_pH} (numeric, roughly 5.2 to 7.6),
#'   and \code{yield} (numeric, crop yield in kg/ha).
#'   The true parameter values baked in are: population intercept
#'   \eqn{\beta_0 = 30}, population slope \eqn{\beta_1 = 6}, between-farm
#'   intercept SD \eqn{\sigma_\alpha = 8}, between-farm slope SD
#'   \eqn{\sigma_b = 2.2}, intercept-slope correlation \eqn{\rho = -0.4},
#'   and residual SD \eqn{\sigma = 2}.
#'
#' @examples
#' df <- simulate_crop_yield()
#'
#' @export
simulate_crop_yield <- function(seed = 123, beta_1 = 6, sigma_b = 2.2) {
    set.seed(seed)

    beta_0 <- 30
    # (delete the `beta_1 <- 6` and `sigma_b <- 2.2` lines)

    # variance components
    sigma_alpha <- 8.0 # between-farm SD of intercepts
    rho <- -0.4 # correlation between a farm's intercept and slope
    sigma <- 2.0 # residual (within-plot) SD

    # deliberately unbalanced, so shrinkage differs across farms
    plots_per_farm <- c(14, 22, 10, 9, 8, 7, 6, 15, 4, 12, 5, 23, 9, 18, 23)
    n_farms <- length(plots_per_farm)

    # draw correlated farm-level deviations without needing MASS::mvrnorm:
    # build a correlated pair from two independent standard normals
    z_intercept <- rnorm(n_farms)
    z_slope <- rho * z_intercept + sqrt(1 - rho^2) * rnorm(n_farms)

    alpha_j <- sigma_alpha * z_intercept # farm departure from beta_0
    b_j <- sigma_b * z_slope # farm departure from beta_1

    farm_labels <- sprintf("Farm_%02d", seq_len(n_farms))

    out <- do.call(rbind, lapply(seq_len(n_farms), function(j) {
        n_j <- plots_per_farm[j]
        soil_pH <- runif(n_j, min = 5.2, max = 7.6)

        crop_yield <- (beta_0 + alpha_j[j]) +
            (beta_1 + b_j[j]) * soil_pH +
            rnorm(n_j, mean = 0, sd = sigma)

        data.frame(
            farm_id = farm_labels[j],
            plot_id = sprintf("%s_plot_%02d", farm_labels[j], seq_len(n_j)),
            soil_pH = soil_pH,
            crop_yield = crop_yield,
            stringsAsFactors = FALSE
        )
    }))

    rownames(out) <- NULL
    out
}
crop_yield_df <- simulate_crop_yield()
readr::write_csv(crop_yield_df,
    file = here::here("./assets/data/crop_yield_data.csv")
)

crop_ri <- simulate_crop_yield(beta_1 = 1, sigma_b = 0)

summary(lm(crop_yield ~ soil_pH, data = crop_ri))$coefficients
summary(lme4::lmer(crop_yield ~ soil_pH + (1 | farm_id), data = crop_ri))$coefficients


crop_rs <- simulate_crop_yield(seed = 4) # beta_1 = 6, sigma_b = 2.2

summary(lme4::lmer(crop_yield ~ soil_pH + (1 | farm_id), data = crop_rs))$coefficients
summary(lme4::lmer(crop_yield ~ soil_pH + (soil_pH | farm_id), data = crop_rs))$coefficients
