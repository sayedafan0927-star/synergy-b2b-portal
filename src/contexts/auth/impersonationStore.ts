import type { Profile } from './types';

const IMPERSONATED_PROFILE_KEY = 'synergy:impersonated_profile';
const DEACTIVATION_NOTICE_KEY = 'synergy:deactivation_notice';

export function getStoredImpersonation(): Profile | null {
  if (typeof window === 'undefined') return null;
  const stored = sessionStorage.getItem(IMPERSONATED_PROFILE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function saveStoredImpersonation(target: Profile | null): void {
  if (typeof window === 'undefined') return;
  if (target) {
    sessionStorage.setItem(IMPERSONATED_PROFILE_KEY, JSON.stringify(target));
  } else {
    sessionStorage.removeItem(IMPERSONATED_PROFILE_KEY);
  }
}

export function getStoredDeactivationNotice(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(DEACTIVATION_NOTICE_KEY);
}

export function saveStoredDeactivationNotice(msg: string | null): void {
  if (typeof window === 'undefined') return;
  if (msg) {
    sessionStorage.setItem(DEACTIVATION_NOTICE_KEY, msg);
  } else {
    sessionStorage.removeItem(DEACTIVATION_NOTICE_KEY);
  }
}
