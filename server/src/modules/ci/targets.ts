import type { CiTarget, CiTargetOption } from '@devdigest/shared';

/**
 * Target registry (AC-3). Only GitHub Actions has a generator in this slice, so
 * only `gha` is listed; a later slice extends this array (and `CiTarget` already
 * carries the other enum values).
 */
const TARGETS: readonly CiTargetOption[] = [{ target: 'gha', label_key: 'ci.targets.gha' }];

export function listTargets(): CiTargetOption[] {
  return TARGETS.map((t) => ({ ...t }));
}

export function isSupportedTarget(target: CiTarget): boolean {
  return TARGETS.some((t) => t.target === target);
}
