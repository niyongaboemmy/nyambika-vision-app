import { ScreenSkeleton } from "@/components/studio";

/** Host admin skeleton in the studio theme (the admin shell mounts with the page). */
export default function Loading() {
  return (
    <div className="theme-light st-app min-h-dvh px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-6xl"><ScreenSkeleton /></div>
    </div>
  );
}
