/**
 * Universal links (iOS) and App Links (Android) for the native shell (E38). Kept in one place so
 * the `.well-known` files and the docs agree. The Capacitor app id is `rw.nyambika.app`.
 */
export const APP_ID = "rw.nyambika.app";

/** Paths the app opens directly: maker spaces, looks, agent mandates, circle polls, orders. */
export const APP_LINK_PATHS = ["/m/*", "/looks/*", "/confirm/*", "/c/*", "/orders/*", "/custom/*", "/circle/*", "/wardrobe/*"] as const;

const isProd = () => process.env.NODE_ENV === "production";

/** Apple Team ID (10 chars). A clearly fake placeholder outside production so local checks work. */
export function appleTeamId(): string | null {
  const v = process.env.APPLE_TEAM_ID?.trim();
  if (v && /^[A-Z0-9]{10}$/.test(v)) return v;
  return isProd() ? null : "DEVTEAM000";
}

/** SHA-256 fingerprints of the Play app-signing and upload certificates (comma separated). */
export function androidFingerprints(): string[] {
  const list = (process.env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
  if (list.length || isProd()) return list;
  return [Array.from({ length: 32 }, () => "00").join(":")];
}

export function appleAppSiteAssociation(teamId: string) {
  const appID = `${teamId}.${APP_ID}`;
  return {
    applinks: {
      details: [
        {
          appIDs: [appID],
          components: [
            // Never hijack API, admin or studio links into the shopper app.
            { "/": "/api/*", exclude: true },
            ...APP_LINK_PATHS.map((p) => ({ "/": p })),
          ],
        },
      ],
    },
    // Passkeys (E29) inside the app share the website's credentials.
    webcredentials: { apps: [appID] },
    activitycontinuation: { apps: [appID] },
  };
}

export function assetLinks(fingerprints: string[]) {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
      target: { namespace: "android_app", package_name: APP_ID, sha256_cert_fingerprints: fingerprints },
    },
  ];
}
