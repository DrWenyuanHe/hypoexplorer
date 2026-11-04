// Hand-written instead of `wrangler types` output so `npm run typecheck:guard`
// works offline and in CI without Wrangler configuration. Keep in step with
// ../wrangler.jsonc `vars` and the CF_GUARD_TOKEN secret.
export interface GuardEnv {
  /** "enforce" | "observe" (log only) | "off". */
  GUARD_MODE?: string;
  /** Month-to-date Class B operations at which the data host closes. */
  CLASS_B_MONTHLY_LIMIT?: string;
  ACCOUNT_ID?: string;
  ZONE_ID?: string;
  R2_BUCKET?: string;
  SHUTOFF_RULE_REF?: string;
  /** Secret: Account > Account Analytics > Read and Zone > Zone WAF > Edit. */
  CF_GUARD_TOKEN?: string;
}

/** The subset of the Workers runtime's ScheduledController this Worker reads. */
export interface ScheduledControllerLike {
  readonly scheduledTime: number;
  readonly cron: string;
}
