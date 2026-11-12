"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui";
import { Price } from "@/components/region";
import { Icon } from "@/components/icons";
import { rwf } from "@/lib/api";
import type { MakerProduct, MakerSpace } from "@/lib/maker";
import type { Commerce } from "@/lib/region";
import { ProductSheet } from "./product-sheet";

/**
 * Every piece as an image-first grid, one tap from the hero (loaded on first open). It is the list for shoppers who
 * prefer one, for keyboards and screen readers, and for devices without WebGL; tapping a piece opens its sheet and
 * closing that returns here.
 */
export function PiecesSheet({ maker, commerce, in3d, onClose }: { maker: MakerSpace; commerce?: Commerce | null; in3d: string[]; onClose: () => void }) {
  const [product, setProduct] = useState<MakerProduct | null>(null);
  return (
    <>
      <Sheet open={!product} onClose={onClose} title={`${maker.products.length} pieces`}>
        <ul aria-label="Collection" className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
          {maker.products.map((p) => {
            const img = p.variants[0]?.image;
            const has3d = in3d.includes(p.id);
            return (
              <li key={p.id} className="min-w-0">
                <button type="button" onClick={() => setProduct(p)} className="press block w-full text-left">
                  <span className="relative block aspect-[4/5] overflow-hidden rounded-[20px] bg-fill">
                    {img && <img src={img} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" />}
                    {has3d && (
                      <span className="absolute left-2 top-2 inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full bg-black/60 px-2 text-[11px] font-bold text-white backdrop-blur">
                        <Icon name="cube" className="size-3" /> 3D
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 block truncate text-sm font-semibold">{p.title}</span>
                  <span className="block truncate text-[13px] font-semibold tabular-nums text-gold">
                    {commerce && commerce.prices[p.id] != null ? <Price minor={commerce.prices[p.id]!} currency={commerce.currency} approxClassName="text-fg-muted" /> : rwf(p.priceRwf)}
                    {has3d && <span className="sr-only">, in 3D</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
      <ProductSheet maker={maker} product={product} commerce={commerce} onClose={() => setProduct(null)} />
    </>
  );
}
