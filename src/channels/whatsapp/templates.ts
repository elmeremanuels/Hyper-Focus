// Utility templates, submitted in Dutch (BOUWPLAN.md, 9.1). Only these may go out
// when the 24-hour window is closed.
export const TEMPLATES = {
  morningFocus: 'ochtend_focus',
  dayWrapup: 'dag_afronden',
  weeklyReview: 'weekreview',
  reentry: 'herstart',
} as const;

export type TemplateName = (typeof TEMPLATES)[keyof typeof TEMPLATES];
