import { Skel } from "@/components/kit";

/** Maker Space: banner, identity row, product rail — same boxes as the page so nothing jumps. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="relative mx-auto min-h-dvh w-full max-w-[480px] overflow-hidden bg-ink">
      <Skel className="h-56 w-full rounded-none" />
      <div className="space-y-3 px-5 pt-4">
        <div className="flex items-center gap-3"><Skel className="size-16 rounded-full" /><Skel className="h-7 w-48 rounded-full" /></div>
        <Skel className="h-14 w-full" />
        <div className="flex gap-3"><Skel className="h-72 w-48 shrink-0 rounded-3xl" /><Skel className="h-72 w-48 shrink-0 rounded-3xl" /></div>
      </div>
    </div>
  );
}
