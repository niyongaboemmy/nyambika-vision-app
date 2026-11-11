"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Sheet } from "@/components/ui";
import { PassportLink, Price } from "@/components/region";
import { rwf } from "@/lib/api";
import { waLink, type MakerProduct, type MakerSpace } from "@/lib/maker";
import type { Commerce } from "@/lib/region";
import { track } from "@/lib/track";

// Maker Space product sheet (split from client.tsx, JS budget pass). The 3D section and checkout load on first open.
const Garment3dSection = dynamic(() => import("@/components/xr-maker").then((m) => m.Garment3dSection), { ssr: false });
const RegionBuy = dynamic(() => import("@/components/region-buy").then((m) => m.RegionBuy), { ssr: false });

export function ProductSheet({ maker, product, commerce, onClose }: { maker: MakerSpace; product: MakerProduct | null; commerce?: Commerce | null; onClose: () => void }) {
  const router = useRouter();
  const [vi, setVi] = useState(0);
  if (!product) return null;
  const v = product.variants[Math.min(vi, product.variants.length - 1)];
  const tryOn = () => router.push(`/looks/try?variant=${v.id}`);
  return (
    <Sheet open onClose={onClose}>
      <div className="flex gap-4">
        {v.image && <img src={v.image} alt={product.title} className="h-40 w-32 rounded-2xl object-cover" />}
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="font-display text-xl font-black">{product.title}</h3>
          <p className="font-semibold text-gold">{commerce && commerce.prices[product.id] != null ? <Price minor={commerce.prices[product.id]!} currency={commerce.currency} approxClassName="block text-sm text-txt/70" /> : rwf(product.priceRwf)}{product.madeToOrder ? " · made to measure" : ""}</p>
          {product.makers.length > 0 && <p className="text-sm text-mut">Made by {product.makers.join(", ")}, {maker.name}</p>}
          <p className="text-sm text-mut">{product.madeToOrder ? `Ready in ${product.leadTimeDays} days` : v.inStock ? "In stock" : "Out of stock"}</p>
          <div className="flex flex-wrap gap-2 pt-1" role="radiogroup" aria-label="Colour">
            {product.variants.map((x, j) => (
              <button key={x.id} role="radio" aria-checked={j === vi} aria-label={x.colourName} onClick={() => setVi(j)} className={`hit size-8 rounded-full border-2 ${j === vi ? "border-gold" : "border-white/30"}`} style={{ background: x.colourHex }} />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button onClick={tryOn} disabled={product.readiness !== "READY"}>✨ Try on me</Button>
        <a
          className="glass inline-flex min-h-12 items-center justify-center rounded-2xl font-semibold"
          href={waLink(maker.whatsapp, `Muraho ${maker.name}! I'd like "${product.title}" (${v.colourName}). ${typeof window !== "undefined" ? window.location.origin : ""}/m/${maker.handle}`)}
          target="_blank"
          rel="noreferrer"
          onClick={() => track("maker_contacted", { pageId: maker.id, productId: product.id, channel: "whatsapp" })}
        >
          💬 Order on WhatsApp
        </a>
      </div>
      {product.readiness !== "READY" && <p className="mt-2 text-center text-xs text-mut">Try-on isn't available for this item yet.</p>}
      {commerce && (commerce.wallets.length > 0 || commerce.card.enabled) && commerce.prices[product.id] != null && (
        <div className="mt-2 grid grid-cols-2 gap-2"><RegionBuy maker={maker} product={product} variantIndex={vi} commerce={commerce} /></div>
      )}
      {commerce?.passports.includes(product.id) && <div className="mt-3"><PassportLink productId={product.id} /></div>}
      <Garment3dSection productId={product.id} title={product.title} variantId={v.id} />
      {product.studio.length > 0 && (
        <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto">
          {product.studio.filter(Boolean).map((src) => (
            <figure key={src} className="relative shrink-0">
              <img src={src!} alt={`${product.title} on an AI model`} className="h-40 w-24 rounded-xl object-cover" />
              <figcaption className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px]">AI model</figcaption>
            </figure>
          ))}
        </div>
      )}
    </Sheet>
  );
}
