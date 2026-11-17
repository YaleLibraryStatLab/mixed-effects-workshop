#'  Welcome to the take-home problem!!
#'
#' Fill in every ___ as you go, working from top to bottom and running each
#' step before moving on. Every step ends with a little check, so you'll know
#' right away if there's a mistake hiding
#'
#' We're going back to our cold-stressed grass from the workshop. The data are
#' built into R as `CO2`:
#'   - 12 plants: 6 from Quebec and 6 from Mississippi
#'   - half the plants from each region were chilled overnight
#'   - CO2 uptake measured on every plant at 7 concentrations (84 rows)
#' The question: does chilling reduce how much CO2 a plant can take up?

library(lme4)
library(ggplot2)


#' Step 1: Meet the data -------------------------------------------------------
#' Before anything else, figure out what the grouping is and how big it is

str(CO2)

n_plants <- nlevels(CO2$___) # how many plants are there?
n_plants

# check!! you should have 12 plants, each measured 7 times
table(CO2$Plant)


#' Step 2: Look before you model -----------------------------------------------
#' One line per plant, split by treatment. Do plants differ in their baseline?
#' In how steeply they respond to concentration?

ggplot(CO2, aes(x = ___, y = uptake, group = ___, colour = Type)) +
  geom_line() +
  facet_wrap(~Treatment)

# now try log(conc) on the x-axis. Which looks closer to a straight line?
ggplot(CO2, aes(x = ___, y = uptake, group = Plant, colour = Type)) +
  geom_line() +
  facet_wrap(~Treatment)

# DOUBLE CHECK: you should see 12 lines, 6 in each panel


#' Step 3: A random-intercept model --------------------------------------------
#' Region (Type) and chilling (Treatment) are fixed effects we care about, and
#' plants are our grouping. Fill in the model:
#'   uptake_ij = b0 + b1 * log(conc_ij) + [Type * Treatment] + alpha_j + e_ij

fit_ri <- lmer(uptake ~ log(conc) + Type * Treatment + (1 | ___),
               data = CO2)
summary(fit_ri)

# check!! these should be 84 and 12. If not, look at your grouping term
nobs(fit_ri)
ngrps(fit_ri)


#' Step 4: Does chilling reduce uptake? ----------------------------------------
#' Remember: no p-values from lme4, so we'll use confidence intervals!
#' Careful with the interaction: `Treatmentchilled` is the effect of chilling
#' for QUEBEC plants. For Mississippi plants, add the interaction term too.

round(confint(fit_ri, parm = "beta_"), 2)

# chilling effect for Mississippi plants
fixef(fit_ri)[["Treatmentchilled"]] +
  fixef(fit_ri)[["___"]]

# check!! both chilling effects should be negative. Which region is hit harder?


#' Step 5: The ICC -------------------------------------------------------------
#' How much of the leftover variation is between plants?
#'   ICC = sigma^2_alpha / (sigma^2_alpha + sigma^2)

vc <- as.data.frame(VarCorr(fit_ri))
vc # look at this first: which row is the plant variance?

icc <- vc$vcov[___] / sum(vc$___)
icc

# check!! should be between 0 and 1 (we got about 0.10). Is that bigger or
# smaller than you expected from your plots in Step 2? Why might that be,
# given what's already in the model?


#' Step 6: Add a random slope --------------------------------------------------
#' Plants may respond differently to concentration. First center log(conc) so
#' the intercept means something, then let the slope vary by plant

CO2$log_conc_c <- log(CO2$conc) - mean(___)

fit_rs <- lmer(uptake ~ log_conc_c + Type * Treatment + (___ | Plant),
               data = CO2)
VarCorr(fit_rs)

# check!! look closely at the Corr column and any messages. What's going on?
# (hint: how many plants are we estimating 3 random-effect parameters from?)
isSingular(fit_rs)

# try dropping the correlation instead, with ||
fit_un <- lmer(uptake ~ log_conc_c + Type * Treatment + (log_conc_c ___ Plant),
               data = CO2)
VarCorr(fit_un)

# check!! this one should NOT be singular
isSingular(fit_un)


#' Step 7: Do we need the random slope? ----------------------------------------
#' Compare to a random-intercept model with the SAME fixed effects. Only the
#' random effects differ, so we compare the REML fits (no refitting!)

fit_ri_c <- lmer(uptake ~ log_conc_c + Type * Treatment + (1 | Plant),
                 data = CO2)

lrt <- anova(fit_ri_c, fit_un, refit = ___)$Chisq[2]
lrt

# the slope variance can't be negative, so we're on the boundary: halve it!
p_naive <- pchisq(lrt, df = ___, lower.tail = FALSE)
p_boundary <- 0.5 * p_naive
c(p_naive = p_naive, p_boundary = p_boundary)

# check!! p_boundary should be exactly half of p_naive. Keep the slope?


#' Step 8: Check the assumptions -----------------------------------------------
#' Residuals vs fitted, a QQ plot of the residuals, and a QQ plot of the
#' random effects

plot(___)
qqnorm(resid(fit_un)); qqline(resid(fit_un))
re <- ranef(fit_un)$Plant # one row per plant: intercept and slope deviations
qqnorm(re[, "(Intercept)"]); qqline(re[, "(Intercept)"])
qqnorm(re[, "___"]); qqline(re[, "log_conc_c"])

# check!! with only 12 plants, the random-effect QQ plots will be rough, so
# only look for big problems. Then look back at your Step 2 plots: is a straight line in log(conc)
# really right? Can you see that in the residuals? What might you try instead?


#' Step 9: What if we had ignored the plants? ----------------------------------
#' Fit the same fixed effects with plain old lm() and compare standard errors

fit_lm <- ___(uptake ~ log(conc) + Type * Treatment, data = CO2)

round(cbind(
  lm   = sqrt(diag(vcov(fit_lm))),
  lmer = sqrt(diag(vcov(fit_ri)))
), 2)

# check!! which standard errors got SMALLER when we ignored the plants, and
# which didn't? Think about which predictors vary WITHIN a plant and which
# only vary BETWEEN plants. Does this match what we saw in the slides?