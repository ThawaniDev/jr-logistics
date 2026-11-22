/**
 * SWR keys of the app chrome: the wallet chip and the notification bell in the top bar, and the live counters of the sidebar.
 * The shell subscribes to them with a 60 s poll; `useAction` revalidates them after every successful action so that
 * "publish a request" moves the balance, and "approve a withdrawal" the counter, at once and not a minute later.
 */
export const CHROME_KEYS = {
  notifications: "/notifications?unread=1",
  wallet: "/wallet",
  stats: "/admin/stats",
  overview: "/business/overview",
  incomingOrders: "/integrations/orders?state=open&pageSize=1",
} as const;

const KEYS: readonly string[] = Object.values(CHROME_KEYS);
export const isChromeKey = (k: unknown): boolean => typeof k === "string" && KEYS.includes(k);
