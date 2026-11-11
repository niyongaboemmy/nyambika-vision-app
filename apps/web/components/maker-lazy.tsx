"use client";

import dynamic from "next/dynamic";

/*
 * Maker Space sections that render nothing until their own request answers (WhatsApp opt-in for signed-in
 * shoppers, a tailor's services), so they load after hydration instead of on the page's critical JS
 * (JS budget pass, docs/design/ui-audit.md §Performance).
 */
export const CollectionAlerts = dynamic(() => import("@/components/growth-offer").then((m) => m.CollectionAlerts), { ssr: false });
export const TailorServices = dynamic(() => import("@/components/tailor-services").then((m) => m.TailorServices), { ssr: false });
