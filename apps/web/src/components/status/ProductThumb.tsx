import { Package } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/api";

/** Product illustration (local placeholder art, not a photo of the real item). */
export function ProductThumb({ product, className }: { product: Pick<Product, "name" | "image_url" | "accent_color">; className?: string }) {
  const [failed, setFailed] = useState(false);
  const accent = product.accent_color ?? "#22d3ee";
  return (
    <div
      className={cn("relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-md border border-line", className)}
      style={{ background: `linear-gradient(145deg, ${accent}22, #0f182a 70%)` }}
    >
      {product.image_url && !failed ? (
        <img
          src={product.image_url}
          alt=""
          className="size-[78%] object-contain"
          onError={() => setFailed(true)}
          loading="lazy"
        />
      ) : (
        <Package className="size-1/2" style={{ color: accent }} aria-hidden />
      )}
      <span className="sr-only">{product.name}</span>
    </div>
  );
}
