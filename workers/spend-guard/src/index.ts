// hypoexplorer-spend-guard: a cron-only Worker that closes data.hypoexplorer.com
// when month-to-date R2 Class B operations reach CLASS_B_MONTHLY_LIMIT, and
// reopens it when they are below it again (the first run of each UTC month).
// It only toggles `enabled` on the zone custom rule hypoexplorer_data_shutoff;
// it serves no HTTP traffic. docs/EDGE_PROTECTION.md is the runbook.
//
// Only the default export: workerd rejects additional named exports from the
// entry module, so the logic lives in ./guard and ./decide.
import type { GuardEnv, ScheduledControllerLike } from './env';
import { runGuard } from './guard';

export default {
  async scheduled(controller: ScheduledControllerLike, env: GuardEnv): Promise<void> {
    await runGuard(env, new Date(controller.scheduledTime));
  },
};
