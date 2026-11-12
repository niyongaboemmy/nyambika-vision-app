import { Skel } from "@/components/kit-static";

/** Maker Space: showroom hero, identity block, collection grid — same boxes as the page so nothing jumps. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="relative mx-auto min-h-dvh w-full max-w-[480px] overflow-hidden bg-ink lg:max-w-[1120px] lg:px-8 lg:pt-6">
      <Skel className="h-[clamp(380px,58dvh,500px)] w-full rounded-none rounded-b-[32px] lg:h-[520px] lg:rounded-[32px]" />
      <div className="space-y-3 px-4 pt-5 lg:px-0">
        <div className="flex items-center gap-3"><Skel className="size-12" /><Skel className="h-7 w-44 rounded-full" /></div>
        <Skel className="h-8 w-3/4 rounded-full" />
        <Skel className="h-5 w-full rounded-full" />
        <div className="grid grid-cols-2 gap-2"><Skel className="h-11" /><Skel className="h-11" /></div>
        <div className="grid grid-cols-2 gap-3 pt-4 sm:grid-cols-3 lg:grid-cols-4"><Skel className="aspect-[4/5]" /><Skel className="aspect-[4/5]" /></div>
      </div>
    </div>
  );
}
