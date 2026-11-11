/** One tab list for every host-admin screen, so the strip never changes shape between pages. */
export const ADMIN_TABS = ["Overview", "Verify", "Moderation", "Migration", "Flags & models", "Outbox", "Audit", "Pilot", "Agents & partners", "Regions"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

const ROUTES: Partial<Record<AdminTab, string>> = { Pilot: "/admin/pilot", "Agents & partners": "/admin/agents", Regions: "/admin/regions" };

/** Where a tab lives: its own route, or a panel of /admin. */
export const adminTabHref = (t: AdminTab) => ROUTES[t] ?? `/admin?tab=${encodeURIComponent(t)}`;
