const userLast = new Map<string, number>();
let globalLast = 0;

const USER_COOLDOWN_MS = 3000;
const GLOBAL_COOLDOWN_MS = 800;

export function checkRateLimit(userId: string, now = Date.now()): boolean {
  const lastUser = userLast.get(userId) ?? 0;
  if (now - lastUser < USER_COOLDOWN_MS) return false;
  if (now - globalLast < GLOBAL_COOLDOWN_MS) return false;
  userLast.set(userId, now);
  globalLast = now;
  return true;
}

export function resetRateLimitForTests(): void {
  userLast.clear();
  globalLast = 0;
}
