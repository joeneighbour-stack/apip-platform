// ============================================================================
// ExpectedRService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 9 (calculate_expected_r)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.2.md Section 3.8
// ============================================================================

export interface ExpectedRInput {
  template: { templateAvgR: number; templateTrades: number };
  profile: { profileAvgR: number; profileTrades: number };
  trigger: { triggerProbability: number };
}

export interface ExpectedROutput {
  rawExpectedR: number;
  expectedR: number;
}

/**
 * Weighted average of [templateAvgR, profileAvgR], weighted by
 * min(trades, 100) each, including a component whenever its trades > 0.
 *
 * DELIBERATE DEPARTURE FROM THE NOTEBOOK, approved explicitly: the notebook
 * includes a component whenever trades > 0, even if that component's avgR
 * is NaN (a winning template/profile group can have nonzero trades but NaN
 * avgR -- every trade in the group had a null result). In the notebook this
 * lets NaN propagate through the whole weighted average. In production, a
 * recommendation's expectedR must never be NaN -- that's not a usable
 * output. A component whose avgR is NaN is therefore EXCLUDED from the
 * blend here, treated the same as a zero-trades component, rather than
 * poisoning the result. If both components end up excluded this way
 * (or both genuinely have zero trades), this correctly falls through to
 * the existing rawExpectedR = 0.0 case below -- the same fallback the
 * notebook already uses for "no real data available".
 * This needs its own V1.3 architecture amendment -- it is a validated
 * behaviour change, not a bug fix, and must not be conflated with one.
 */
export function calculateExpectedR(input: ExpectedRInput): ExpectedROutput {
  const { template, profile, trigger } = input;

  const components: { value: number; weight: number }[] = [];
  if (template.templateTrades > 0 && !Number.isNaN(template.templateAvgR)) {
    components.push({ value: template.templateAvgR, weight: Math.min(template.templateTrades, 100) });
  }
  if (profile.profileTrades > 0 && !Number.isNaN(profile.profileAvgR)) {
    components.push({ value: profile.profileAvgR, weight: Math.min(profile.profileTrades, 100) });
  }

  let rawExpectedR: number;
  if (components.length === 0) {
    rawExpectedR = 0.0;
  } else {
    const weightedSum = components.reduce((acc, c) => acc + c.value * c.weight, 0);
    const totalWeight = components.reduce((acc, c) => acc + c.weight, 0);
    rawExpectedR = weightedSum / totalWeight;
  }

  return { rawExpectedR, expectedR: rawExpectedR * trigger.triggerProbability };
}
