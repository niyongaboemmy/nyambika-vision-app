"use client";

import { useSession } from "@/lib/session";

export default function StudioHome() {
  const { me } = useSession();
  const pages = (me?.roles ?? []).filter((r) => r.page);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Your pages</h1>
      {pages.length === 0 && (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-center text-stone-600">
          You don't manage a page yet.
        </div>
      )}
    </div>
  );
}
