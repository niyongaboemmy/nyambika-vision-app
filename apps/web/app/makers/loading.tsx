import { ShopperSkeleton } from "@/components/kit";

/** Route skeleton shaped like the final layout (streams instantly while the route loads). */
export default function Loading() {
  return <ShopperSkeleton variant="list" />;
}
