/** Studio skeletons: server-renderable (no hooks), shared by studio screens and route loading states. */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div data-skeleton aria-hidden className={`st-skel rounded-2xl ${className}`} />;
}

/** Content-shaped loading state for a whole studio screen. */
export function ScreenSkeleton({ variant = "bento" }: { variant?: "bento" | "grid" | "list" }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-4">
      <Skeleton className="h-8 w-48" />
      {variant === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-[4/5]" />)}
        </div>
      ) : variant === "list" ? (
        Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Skeleton className="col-span-2 h-40" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      )}
    </div>
  );
}
