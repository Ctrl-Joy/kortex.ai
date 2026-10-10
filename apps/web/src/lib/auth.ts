import { useSyncExternalStore } from "react";
import type { Staff } from "@/types/api";

/** Staff session (signed bearer token from /api/auth/login). No credential is
 * stored in the source code; the token lives in localStorage for the demo. */

interface AuthState {
  token: string;
  staff: Staff;
  expiresAt: number;
}

const KEY = "kortex.staff";
const listeners = new Set<() => void>();
let current: AuthState | null = load();
let expiredFlag = false;

function load(): AuthState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthState;
    return parsed.expiresAt > Date.now() ? parsed : null;
  } catch {
    return null;
  }
}

function emit() {
  listeners.forEach((l) => l());
}

export const authStore = {
  get: () => current,
  set(token: string, staff: Staff, expiresInSeconds: number) {
    current = { token, staff, expiresAt: Date.now() + expiresInSeconds * 1000 };
    expiredFlag = false;
    localStorage.setItem(KEY, JSON.stringify(current));
    emit();
  },
  clear() {
    current = null;
    localStorage.removeItem(KEY);
    emit();
  },
  expire() {
    if (current) {
      expiredFlag = true;
      authStore.clear();
    }
  },
  wasExpired: () => expiredFlag,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function useAuth() {
  return useSyncExternalStore(authStore.subscribe, authStore.get, authStore.get);
}

/* Customer shopping-session credentials (per device). */
const SHOP_KEY = "kortex.shop";

export interface ShopCredentials {
  sessionId: string;
  token: string;
}

export const shopStore = {
  get(): ShopCredentials | null {
    try {
      const raw = localStorage.getItem(SHOP_KEY);
      return raw ? (JSON.parse(raw) as ShopCredentials) : null;
    } catch {
      return null;
    }
  },
  set(c: ShopCredentials) {
    localStorage.setItem(SHOP_KEY, JSON.stringify(c));
  },
  clear() {
    localStorage.removeItem(SHOP_KEY);
  },
};
