import { ShopperSkeleton } from "@/components/kit";

/** Route skeleton shaped like the final layout (streams instantly while the route loads). */
export default function Loading() {
  return <div className="theme-media"><ShopperSkeleton variant="media" title={false} /></div>;
}
