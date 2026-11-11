import type { PrismaService } from "../../common/prisma.service";
import { residencyRegion } from "../video/video-rules";

/**
 * Data-residency region for an inference call (E41 code): the shopper's own country, else the page's region, else RW.
 * Same order as the E39 video path; the gateway's E42 router only acts on it when routing is on (`in-region` policy).
 */
export async function inferenceRegion(prisma: PrismaService, userId: string, pageId: string | null | undefined) {
  const [prefs, page] = await Promise.all([
    prisma.shopperPrefs.findUnique({ where: { userId } }).catch(() => null),
    pageId ? prisma.pageRegion.findUnique({ where: { pageId } }).catch(() => null) : null,
  ]);
  return residencyRegion(prefs?.country, page?.region);
}
