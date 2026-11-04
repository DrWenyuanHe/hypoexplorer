/** Shared badge states. Missing evidence must never render as a passing check. */
export type QualityStatus = 'pass' | 'review' | 'fail' | 'not_assessed' | 'not_applicable';

export interface QualityCheck {
  id: string;
  label: string;
  status: QualityStatus;
  note: string;
  evidence?: string[];
  /** Checks are required unless explicitly marked otherwise. */
  required?: boolean;
}

export interface QualityAssessment {
  status: QualityStatus;
  checks: QualityCheck[];
  scope: string;
  policyVersion: string;
}

export function aggregateQualityChecks(checks: readonly QualityCheck[]): QualityStatus {
  const required = checks.filter((check) => check.required !== false && check.status !== 'not_applicable');
  if (!required.length) return 'not_applicable';
  if (required.some((check) => check.status === 'fail')) return 'fail';
  if (required.some((check) => check.status === 'review')) return 'review';
  if (required.some((check) => check.status === 'not_assessed')) return 'not_assessed';
  return 'pass';
}
