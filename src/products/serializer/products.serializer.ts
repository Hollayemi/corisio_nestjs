import { Prisma } from "../../generated/prisma/client.js";
import {
  PromotionLike,
  pickBestPromotion,
  unitPromoPrice,
} from "../../promotions/promotion-calc.js";

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: {
    category: { select: { id: true; name: true; slug: true } };
    variants: true;
    _count: { select: { orderItems: true } };
    store: {
      select: {
        id: true;
        slug: true;
        name: true;
        logo: true;
        status: true;
      };
    };
  };
}>;

type SerializableProduct = Omit<ProductWithRelations, "store"> & {
  store?: ProductWithRelations["store"];
};


export function serializeProduct(
  p: SerializableProduct,
  candidates: PromotionLike[] = [],
  opts: { distanceKm?: number | null } = {},
) {
  const unitPrice = Number(p.unitPrice);

  const best = pickBestPromotion(candidates, {
    id: p.id,
    categoryId: p.categoryId,
    unitPrice,
  });

  const promoPrice = best ? unitPromoPrice(unitPrice, best) : unitPrice;
  const hasPromo = best != null && promoPrice < unitPrice;

  const result: any = {
    id: p.id,
    code: p.code,
    name: p.name,
    slug: p.slug,
    description: p.description,
    shortDescription: p.shortDescription,
    images: p.images,
    categoryId: p.categoryId,
    category: p.category,
    sku: p.sku,
    variantOption: p.variantOption,
    unitType: p.unitType,

    unitPrice,
    originalPrice: hasPromo ? unitPrice : null,
    promoPrice: hasPromo ? promoPrice : null,
    discountPercent: hasPromo
      ? Math.round(((unitPrice - promoPrice) / unitPrice) * 100)
      : 0,

    promotion: best
      ? {
        id: best.id,
        name: best.name,
        type: best.type,
        discountType: best.discountType,
        discountValue: Number(best.discountValue),
        code: best.code ?? null,
      }
      : null,

    weight: p.weight != null ? Number(p.weight) : null,
    stock: p.stock,
    reorderLevel: p.reorderLevel,
    status: p.status,
    isFeatured: p.isFeatured,
    tags: p.tags,
    displayOrder: p.displayOrder,
    variants: p.variants.map((v) => {
      const vPrice = Number(v.unitPrice);
      const vBest = best
        ? pickBestPromotion(candidates, {
          id: p.id,
          categoryId: p.categoryId,
          unitPrice: vPrice,
        })
        : null;
      const vPromo = vBest ? unitPromoPrice(vPrice, vBest) : vPrice;
      return {
        id: v.id,
        label: v.label,
        sku: v.sku,
        unitPrice: vPrice,
        promoPrice: vPromo < vPrice ? vPromo : null,
        stock: v.stock,
        isDefault: v.isDefault,
      };
    }),
    unitsSold: p._count?.orderItems ?? 0,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),

    /** km from the visitor's location to the product's store. Null when unknown. */
    distanceKm: opts.distanceKm ?? null,
  };

  if (p.store) {
    result.store = {
      id: p.store.id,
      slug: p.store.slug,
      name: p.store.name,
      logo: p.store.logo,
    };
  }

  return result;
}

export function serializeProducts(
  products: SerializableProduct[],
  candidates: PromotionLike[] = [],
) {
  return products.map((p) => serializeProduct(p, candidates));
}


// serializeCategory unchanged
export function serializeCategory(c: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  status: string;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
  _count?: { products: number };
}) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    image: c.image,
    status: c.status,
    displayOrder: c.displayOrder,
    productCount: c._count?.products ?? 0,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}