"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ScreenSkeleton } from "@/components/studio";
import { useSession } from "@/lib/session";

/** Member Page Manager root: light warm theme + sign-in guard. The page shell lives in [pageId]/layout (FR-PAGE-11). */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  const { me, loading } = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!loading && !me) router.replace(`/signin?next=${encodeURIComponent(path)}`);
  }, [loading, me, router, path]);
  return (
    <div className="theme-light st-app min-h-dvh overflow-x-clip text-cocoa">
      {loading || !me ? (
        <div className="mx-auto max-w-3xl px-4 py-8">
          <ScreenSkeleton />
        </div>
      ) : (
        children
      )}
    </div>
  );
}
