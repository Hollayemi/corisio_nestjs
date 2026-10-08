import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { Prisma } from "../generated/prisma/client.js";
import type { StoreSort } from "./dto/list-public-stores.dto.js";
import { Coords } from "../common/decorator/user-location.decorator.js";

export interface PublicStoreLocationRow {
  id: string;
  storeId: string;
  label: string;
  address: string;
  region: string;
  phone: string | null;
  latitude: number;
  longitude: number;
  distanceKm: number | null;
}

@Injectable()
export class StoreDiscoveryService {
  constructor(private db: DatabaseService) { }

  // ────────────────────────────────────────────────────────────
  // GET /catalog/stores
  // ────────────────────────────────────────────────────────────

  async listPublic(
    filters: {
      search?: string;
      category?: string;
      radiusKm?: number;
      sort?: StoreSort;
      limit?: number;
    },
    here: Coords,
  ) {
    const limit = Math.min(filters.limit ?? 100, 200);

    // ── Branch 1: no location → plain Prisma, sort by popularity
    if (!here) {
      return this.listStoresNoLocation(filters, limit);
    }

    // ── Branch 2: with location → PostGIS, sort by nearest (or other)
    return this.listStoresWithLocation(filters, here, filters.sort ?? "nearest", limit);
  }

  private async listStoresNoLocation(
    filters: { search?: string; category?: string },
    limit: number,
  ) {
    const where: Prisma.StoreWhereInput = { status: "ACTIVE" };

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { tagline: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    if (filters.category) {
      where.categories = { some: { category: { slug: filters.category } } };
    }

    // Popularity = delivered orders. Prisma can't order by an aggregate
    // on a relation, so fetch and sort in JS for now (small N).
    const stores = await this.db.store.findMany({
      where,
      include: {
        location: true,
        addresses: { orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] },
        categories: {
          include: { category: { select: { id: true, slug: true, name: true } } },
        },
        _count: { select: { orders: true } },
      },
    });

    // Sort by order count desc, then name
    stores.sort(
      (a, b) =>
        b._count.orders - a._count.orders || a.name.localeCompare(b.name),
    );

    const limited = stores.slice(0, limit);
    const storeIds = limited.map((s) => s.id);

    const [categories, topProducts] = await Promise.all([
      this.getCategoriesForStores(storeIds),
      this.getTopProductsForStores(storeIds),
    ]);

    return {
      items: limited.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        tagline: s.tagline ?? null,
        logo: s.logo ?? null,
        banner: s.banner ?? null,
        phone: s.phone,
        whatsapp: s.whatsapp ?? null,
        openingHours: (s.openingHours as any) ?? null,
        socialLinks: (s.socialLinks as any) ?? null,
        description: s.description,
        email: s.email,
        categories: categories.get(s.id) ?? [],
        locations: this.locationsFromStore(s, null),
        topProducts: topProducts.get(s.id) ?? [],
        rating: null,
        reviewCount: null,
        isOpen: null,
        distanceKm: null,
      })),
    };
  }

  /**
   * Shape the StoreLocation + StoreAddress into a PublicStoreLocationRow[]
   * without distances.
   */
  private locationsFromStore(
    store: {
      id: string;
      location: { id: string; label: string; address: string; region: string; phone: string | null; latitude: number; longitude: number } | null;
      addresses: Array<{ id: string; label: string; address: string; region: string; phone: string | null; latitude: number; longitude: number }>;
    },
    distanceKm: null,
  ) {
    const out: PublicStoreLocationRow[] = [];

    if (store.location) {
      out.push({
        id: store.location.id,
        storeId: store.id,
        label: store.location.label,
        address: store.location.address,
        region: store.location.region,
        phone: store.location.phone ?? null,
        latitude: store.location.latitude,
        longitude: store.location.longitude,
        distanceKm,
      });
    }

    for (const a of store.addresses) {
      out.push({
        id: a.id,
        storeId: store.id,
        label: a.label,
        address: a.address,
        region: a.region,
        phone: a.phone ?? null,
        latitude: a.latitude,
        longitude: a.longitude,
        distanceKm,
      });
    }

    return out;
  }

  private async listStoresWithLocation(
    filters: { search?: string; category?: string; radiusKm?: number },
    here: Coords & object,        // narrowed: non-null
    sort: StoreSort,
    limit: number,
  ) {
    const search = filters.search ? `%${filters.search}%` : null;
    const categorySlug = filters.category ?? null;
    const radiusMeters =
      filters.radiusKm != null ? Math.round(filters.radiusKm * 1000) : null;

    // Always a real point — we're in the "has location" branch.
    const center = Prisma.sql`ST_SetSRID(ST_MakePoint(${here.lng}, ${here.lat}), 4326)::geography`;

    // Sort resolution: nearest requires location (guaranteed here).
    // rating has no real aggregate yet — fall back to popular.
    const orderBy = (() => {
      switch (sort) {
        case "nearest":
          return Prisma.sql`n."distanceKm" ASC, s.name ASC`;
        case "rating":
        case "popular":
        default:
          return Prisma.sql`popularity DESC, s.name ASC`;
      }
    })();

    const rows = await this.db.$queryRaw<
      Array<{
        id: string;
        slug: string;
        name: string;
        tagline: string | null;
        logo: string | null;
        banner: string | null;
        phone: string | null;
        whatsapp: string | null;
        openingHours: unknown;
        socialLinks: unknown;
        description: string | null;
        email: string | null;
        distanceKm: number | null;
        popularity: number;
      }>
    >(Prisma.sql`
    WITH spots AS (
      SELECT "storeId", geog
      FROM "StoreLocation"
      WHERE geog IS NOT NULL
      UNION ALL
      SELECT "storeId", geog
      FROM "StoreAddress"
      WHERE geog IS NOT NULL
    ),
    nearest AS (
      SELECT DISTINCT ON (spot."storeId")
        spot."storeId",
        ST_Distance(spot.geog, ${center}) / 1000.0 AS "distanceKm"
      FROM spots spot
      ORDER BY spot."storeId", "distanceKm" ASC
    ),
    completed AS (
      SELECT "storeId", COUNT(*)::int AS popularity
      FROM "Order"
      WHERE status = 'DELIVERED'
      GROUP BY "storeId"
    )
    SELECT
      s.id, s.slug, s.name, s.tagline, s.logo, s.banner,
      s.phone, s.whatsapp, s."openingHours", s."socialLinks",
      s.description, s.email,
      n."distanceKm",
      COALESCE(c.popularity, 0) AS popularity
    FROM "Store" s
    LEFT JOIN nearest n ON n."storeId" = s.id
    LEFT JOIN completed c ON c."storeId" = s.id
    WHERE s.status = 'ACTIVE'
      AND (${search}::text IS NULL OR
           s.name ILIKE ${search} OR
           s.tagline ILIKE ${search} OR
           s.description ILIKE ${search})
      AND (${categorySlug}::text IS NULL OR EXISTS (
        SELECT 1 FROM "StoreCategory" sc
        JOIN "Category" c2 ON c2.id = sc."categoryId"
        WHERE sc."storeId" = s.id AND c2.slug = ${categorySlug}
      ))
      AND (${radiusMeters}::int IS NULL OR n."distanceKm" <= ${radiusMeters}::int / 1000.0)
    ORDER BY ${orderBy}
    LIMIT ${limit}
  `);

    if (rows.length === 0) return { items: [] };

    const storeIds = rows.map((r) => r.id);

    const [locations, categories, topProducts] = await Promise.all([
      this.getLocationsForStores(storeIds, here),
      this.getCategoriesForStores(storeIds),
      this.getTopProductsForStores(storeIds),
    ]);

    return {
      items: rows.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        tagline: s.tagline,
        logo: s.logo,
        banner: s.banner,
        phone: s.phone,
        whatsapp: s.whatsapp,
        openingHours: s.openingHours ?? null,
        socialLinks: s.socialLinks ?? null,
        description: s.description,
        email: s.email,
        categories: categories.get(s.id) ?? [],
        locations: locations.get(s.id) ?? [],
        topProducts: topProducts.get(s.id) ?? [],
        rating: null,
        reviewCount: null,
        isOpen: null,
        distanceKm: s.distanceKm,
      })),
    };
  }

  async getPublic(slug: string, here: Coords) {
  const store = await this.db.store.findUnique({
    where: { slug },
    include: {
      location: true,
      addresses: { orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] },
      categories: {
        include: { category: { select: { id: true, slug: true, name: true } } },
      },
    },
  });
  if (!store || store.status !== "ACTIVE") {
    throw new NotFoundException("Store not found");
  }

  // Location list — distances only when we know where the visitor is
  const locations = here
    ? await this.getLocationsForStores([store.id], here).then(
        (m) => m.get(store.id) ?? [],
      )
    : this.locationsFromStore(store, null);

  const products = await this.db.product.findMany({
    where: { storeId: store.id, status: "ACTIVE", stock: { gt: 0 } },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    take: 24,
    select: { id: true, slug: true, name: true, unitPrice: true, images: true },
  });

  return {
    id: store.id,
    slug: store.slug,
    name: store.name,
    tagline: store.tagline ?? null,
    logo: store.logo ?? null,
    banner: store.banner ?? null,
    description: store.description ?? null,
    email: store.email,
    phone: store.phone,
    whatsapp: store.whatsapp ?? null,
    socialLinks: (store.socialLinks as any) ?? null,
    openingHours: (store.openingHours as any) ?? null,
    timezone: store.location?.timezone ?? null,
    categories: store.categories.map((sc) => ({
      slug: sc.category.slug,
      name: sc.category.name,
    })),
    locations,
    products: products.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      price: Number(p.unitPrice),
      image: p.images[0] ?? null,
    })),
    rating: null,
    reviewCount: null,
    isOpen: null,
  };
}

  // ────────────────────────────────────────────────────────────
  // Batched helpers
  // ────────────────────────────────────────────────────────────

private async getLocationsForStores(
  storeIds: string[],
  here: Coords & object,       // only called from the with-location path
): Promise<Map<string, PublicStoreLocationRow[]>> {
  if (storeIds.length === 0) return new Map();

  const center = Prisma.sql`ST_SetSRID(ST_MakePoint(${here.lng}, ${here.lat}), 4326)::geography`;

  const rows = await this.db.$queryRaw<PublicStoreLocationRow[]>(Prisma.sql`
    SELECT
      spot.id, spot."storeId", spot.label, spot.address, spot.region, spot.phone,
      spot.latitude, spot.longitude,
      ST_Distance(spot.geog, ${center}) / 1000.0 AS "distanceKm"
    FROM (
      SELECT "storeId", id, 'Main' AS label, address, region, phone,
             latitude, longitude, geog
      FROM "StoreLocation"
      WHERE "storeId" IN (${Prisma.join(storeIds)}) AND geog IS NOT NULL
      UNION ALL
      SELECT "storeId", id, label, address, region, phone,
             latitude, longitude, geog
      FROM "StoreAddress"
      WHERE "storeId" IN (${Prisma.join(storeIds)}) AND geog IS NOT NULL
    ) spot
    ORDER BY spot."storeId", "distanceKm" ASC
  `);

  const map = new Map<string, PublicStoreLocationRow[]>();
  for (const r of rows) {
    const arr = map.get(r.storeId) ?? [];
    arr.push(r);
    map.set(r.storeId, arr);
  }
  return map;
}

  private async getCategoriesForStores(storeIds: string[]) {
    const rows = await this.db.storeCategory.findMany({
      where: { storeId: { in: storeIds } },
      include: { category: { select: { slug: true, name: true } } },
    });

    const map = new Map<string, Array<{ slug: string; name: string }>>();
    for (const r of rows) {
      const arr = map.get(r.storeId) ?? [];
      arr.push({ slug: r.category.slug, name: r.category.name });
      map.set(r.storeId, arr);
    }
    return map;
  }

  private async getTopProductsForStores(storeIds: string[]) {
    if (storeIds.length === 0) return new Map();

    const rows = await this.db.$queryRaw<
      Array<{
        storeId: string;
        id: string;
        slug: string;
        name: string;
        price: number;
        image: string | null;
      }>
    >(Prisma.sql`
      SELECT "storeId", id, slug, name, price, image FROM (
        SELECT
          p."storeId", p.id, p.slug, p.name,
          p."unitPrice"::float AS price,
          p.images[1] AS image,
          ROW_NUMBER() OVER (
            PARTITION BY p."storeId"
            ORDER BY COALESCE((
              SELECT SUM(oi.quantity)
              FROM "OrderItem" oi
              WHERE oi."productId" = p.id
            ), 0) DESC, p."createdAt" DESC
          ) AS rn
        FROM "Product" p
        WHERE p."storeId" IN (${Prisma.join(storeIds)})
          AND p.status = 'ACTIVE'
          AND p.stock > 0
      ) ranked
      WHERE rn <= 4
    `);

    const map = new Map<
      string,
      Array<{ id: string; slug: string; name: string; price: number; image: string | null }>
    >();
    for (const r of rows) {
      const arr = map.get(r.storeId) ?? [];
      arr.push({
        id: r.id,
        slug: r.slug,
        name: r.name,
        price: r.price,
        image: r.image,
      });
      map.set(r.storeId, arr);
    }
    return map;
  }
}