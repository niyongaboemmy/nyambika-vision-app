"use client";

import type { startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import { api } from "./api";

/** Passkeys (E29, FR-ACC-02). OTP stays the fallback for every flow. */

export interface PasskeyView {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
  deviceType: string;
}

// Same test as @simplewebauthn's browserSupportsWebAuthn(); the library itself (~10 KB gz) loads on first use, so it
// stays out of the sign-in route's first-load JS (JS budget pass).
export const passkeysSupported = () => typeof window !== "undefined" && typeof globalThis.PublicKeyCredential === "function";
const webauthn = () => import("@simplewebauthn/browser");

/** A friendly default name: "Chrome on Android", "Safari on iPhone"… */
export function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "this device";
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} on ${os}`;
}

function friendly(e: unknown) {
  // WebAuthnError is matched by its `code` (ERROR_*) so the library class need not be loaded up front.
  const name = (e as Error)?.name;
  const code = (e as Partial<WebAuthnError>)?.code;
  if ((typeof code === "string" && code.startsWith("ERROR_")) || name === "NotAllowedError") {
    if (name === "NotAllowedError" || code === "ERROR_CEREMONY_ABORTED") return "Passkey cancelled. You can use a phone code instead.";
    if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return "This device already has a Nyambika passkey.";
  }
  return (e as Error).message || "Passkey didn't work. Use a phone code instead.";
}

export async function registerPasskey(name = deviceName()) {
  try {
    // The library loads in parallel with the options request, so it adds no round trip.
    const [optionsJSON, wa] = await Promise.all([api<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/auth/passkeys/register/options", { method: "POST" }), webauthn()]);
    const response = await wa.startRegistration({ optionsJSON });
    return await api<PasskeyView[]>("/auth/passkeys/register", { method: "POST", json: { response, name } });
  } catch (e) {
    throw new Error(friendly(e));
  }
}

export async function signInWithPasskey() {
  try {
    const [optionsJSON, wa] = await Promise.all([api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/auth/passkeys/login/options", { method: "POST" }), webauthn()]);
    const response = await wa.startAuthentication({ optionsJSON });
    await api("/auth/passkeys/login", { method: "POST", json: { response } });
  } catch (e) {
    throw new Error(friendly(e));
  }
}

const DISMISS_KEY = "nya_passkey_offer";
export function offerDismissed() {
  try {
    // Automated browsers (other crawls / e2e) expect sign-in to land straight on `next`; a crawl that
    // tests passkeys opts in with localStorage nya_passkey_offer_force=1.
    if (navigator.webdriver && localStorage.getItem("nya_passkey_offer_force") !== "1") return true;
    return Number(localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now() - 30 * 86400_000;
  } catch {
    return false;
  }
}
export function dismissOffer() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}
