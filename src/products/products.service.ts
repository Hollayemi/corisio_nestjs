// src/products/products.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CreateProductDto } from "./dto/create-product.dto.js";
import { UpdateProductDto } from "./dto/update-product.dto.js";
import { ListProductsDto } from "./dto/list-products.dto.js";
import {
  ListGlobalProductsDto,
  ProductSort,
} from "./dto/list-global-products.dto.js";
import { DatabaseService } from "../database/database.service.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  serializeProduct,
  serializeProducts,
} from "./serializer/products.serializer.js";
import { slugify } from "../common/utils/slug.util.js";
import { nextCode } from "../common/utils/code.util.js";
import { PromotionFinderService } from "../promotions/promotion-finder.service.js";
import type{ Coords } from "../common/decorator/user-location.decorator.js";

@Injectable()
export class ProductsService {
  constructor(
    private db: DatabaseService,
    private promotionFinder: PromotionFinderService,
  ) {}

  private include = {
    category: { select: { id: true, name: true, slug: true } },
    variants: true,
    _count: { select: { orderItems: true } },
  } satisfies Prisma.ProductInclude;

  private storeInclude = {
    store: {
      select: {
        id: true,
        slug: true,
        name: true,
        logo: true,
        status: true,
      },
    },
  } satisfies Prisma.ProductInclude;

  // ────────────────────────────────────────────────────────────
  // PUBLIC — store-scoped (unchanged from before)
  // ────────────────────────────────────────────────────────────

  async listPublic(dto: ListProductsDto, storeId: string) {
    return this.listStoreScoped(dto, storeId);
  }

  async findBySlug(slug: string, storeId?: string) {
    const p = await this.db.product.findUnique({
      where: { slug  },
      include: this.include,
    });
    if (!p || p.status !== "ACTIVE") throw new NotFoundException("Product not found");

    const promotions = await this.promotionFinder.findActiveForProducts({
      storeId: p.id,
      ids: [p.id],
      categoryIds: [p.categoryId],
    });

    return serializeProduct(p, promotions);
  }

  async related(id: string, storeId: string, limit = 6) {
    const product = await this.db.product.findFirst({
      where: { id, storeId },
      select: { categoryId: true },
    });
    if (!product) throw new NotFoundException("Product not found");

    const rows = await this.db.product.findMany({
      where: { storeId, categoryId: product.categoryId, NOT: { id }, status: "ACTIVE" },
      include: this.include,
      take: limit,
    });

    const promotions = await this.promotionFinder.findActiveForProducts({
      storeId,
      ids: rows.map((r) => r.id),
      categoryIds: [...new Set(rows.map((r) => r.categoryId))],
    });

    return serializeProducts(rows, promotions);
  }

  // ────────────────────────────────────────────────────────────
  // GLOBAL — the landing page entry point
  // ────────────────────────────────────────────────────────────

  async listGlobal(dto: ListGlobalProductsDto, here: Coords) {
    const page = dto.page ?? 1;
    const perPage = Math.min(dto.perPage ?? 20, 100);
    const skip = (page - 1) * perPage;

    // ── Path A: no location → plain Prisma
    if (!here) {
      return this.listGlobalNoLocation(dto, page, perPage, skip);
    }

    // ── Path B: with location → PostGIS for ids + distances, Prisma for hydration
    return this.listGlobalWithLocation(dto, here, page, perPage, skip);
  }

  // ────────────────────────────────────────────────────────────
  // PATH A — no location headers
  // ────────────────────────────────────────────────────────────

  private async listGlobalNoLocation(
    dto: ListGlobalProductsDto,
    page: number,
    perPage: number,
    skip: number,
  ) {
    const where = this.buildPrismaWhere(dto);

    // `radiusKm` is meaningless without a location — ignore it silently.
    // `sort=nearest` also falls back to the default ordering.

    const orderBy = this.resolvePrismaSort(dto.sort);

    const [total, rows] = await this.db.$transaction([
      this.db.product.count({ where }),
      this.db.product.findMany({
        where,
        include: { ...this.include, ...this.storeInclude },
        orderBy,
        skip,
        take: perPage,
      }),
    ]);

    const promotions = await this.fetchPromotionsForRows(rows);

    return {
      items: rows.map((row) =>
        serializeProduct(row, promotions, { distanceKm: null }),
      ),
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      page,
    };
  }

  // ────────────────────────────────────────────────────────────
  // PATH B — with location headers
  // ────────────────────────────────────────────────────────────

  private async listGlobalWithLocation(
    dto: ListGlobalProductsDto,
    here: Coords & object,
    page: number,
    perPage: number,
    skip: number,
  ) {
    const search = dto.search ? `%${dto.search}%` : null;
    const tag = dto.tag ?? null;
    const tags = dto.tags?.length ? dto.tags : null;
    const categoryId = dto.categoryId ?? null;
    const categorySlug = dto.category ?? null;
    const minPrice = dto.minPrice ?? null;
    const maxPrice = dto.maxPrice ?? null;
    const storeSlug = dto.store ?? null;
    const isFeatured = dto.isFeatured ?? null;
    const onSale = dto.onSale ?? null;
    const status = dto.status ?? "ACTIVE";
    const radiusMeters = dto.radiusKm != null ? Math.round(dto.radiusKm * 1000) : null;

    // Center point, reused in every branch of the SQL
    const center = Prisma.sql`ST_SetSRID(ST_MakePoint(${here.lng}, ${here.lat}), 4326)::geography`;

    // ── WHERE fragment, shared by list + count
    const where = Prisma.sql`
      p.status = ${status}::"ProductStatus"
      AND p.stock > 0
      AND s.status = 'ACTIVE'
      AND loc.geog IS NOT NULL
      AND (${search}::text IS NULL OR (
        p.name ILIKE ${search} OR p.sku ILIKE ${search}
      ))
      AND (${tag}::text IS NULL OR ${tag}::text = ANY(p.tags))
      AND (${tags}::text[] IS NULL OR p.tags && ${tags}::text[])
      AND (${categoryId}::text IS NULL OR p."categoryId" = ${categoryId})
      AND (${categorySlug}::text IS NULL OR EXISTS (
        SELECT 1 FROM "Category" c
        WHERE c.id = p."categoryId" AND c.slug = ${categorySlug}
      ))
      AND (${minPrice}::numeric IS NULL OR p."unitPrice" >= ${minPrice})
      AND (${maxPrice}::numeric IS NULL OR p."unitPrice" <= ${maxPrice})
      AND (${storeSlug}::text IS NULL OR s.slug = ${storeSlug})
      AND (${isFeatured}::boolean IS NULL OR p."isFeatured" = ${isFeatured})
      AND (${radiusMeters}::int IS NULL OR ST_DWithin(loc.geog, ${center}, ${radiusMeters}::int))
      AND (${onSale}::boolean IS NOT TRUE OR EXISTS (
        SELECT 1 FROM "Promotion" pr
        WHERE pr."storeId" = s.id
          AND pr.status = 'ACTIVE'
          AND pr."startAt" <= now()
          AND (pr."endAt" IS NULL OR pr."endAt" >= now())
          AND (
            pr."appliesTo" = 'ALL_ORDERS'
            OR (pr."appliesTo" = 'CATEGORY' AND pr."categoryId" = p."categoryId")
            OR (pr."appliesTo" = 'SPECIFIC_PRODUCTS' AND p.id = ANY(pr."productIds"))
          )
      ))
    `;

    // ── ORDER BY, depends on sort
    const orderBy = this.buildSqlOrderBy(dto.sort);

    // ── The id query — returns id + distanceKm, ordered correctly
    const idRows = await this.db.$queryRaw<Array<{ id: string; distanceKm: number }>>(
      Prisma.sql`
        SELECT
          p.id,
          ST_Distance(loc.geog, ${center}) / 1000.0 AS "distanceKm"
        FROM "Product" p
        JOIN "Store" s ON s.id = p."storeId"
        JOIN "StoreLocation" loc ON loc."storeId" = s.id
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${perPage} OFFSET ${skip}
      `,
    );

    const [{ count }] = await this.db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "Product" p
        JOIN "Store" s ON s.id = p."storeId"
        JOIN "StoreLocation" loc ON loc."storeId" = s.id
        WHERE ${where}
      `,
    );

    if (idRows.length === 0) {
      return { items: [], total: Number(count), totalPages: 1, page };
    }

    const ids = idRows.map((r) => r.id);
    const distanceById = new Map(idRows.map((r) => [r.id, r.distanceKm]));

    // Hydrate full rows via Prisma
    const rows = await this.db.product.findMany({
      where: { id: { in: ids } },
      include: { ...this.include, ...this.storeInclude },
    });

    // Preserve SQL ordering
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => r != null);

    const promotions = await this.fetchPromotionsForRows(ordered);

    return {
      items: ordered.map((row) =>
        serializeProduct(row, promotions, {
          distanceKm: distanceById.get(row.id) ?? null,
        }),
      ),
      total: Number(count),
      totalPages: Math.max(1, Math.ceil(Number(count) / perPage)),
      page,
    };
  }

  // ────────────────────────────────────────────────────────────
  // SQL ORDER BY builders
  // ────────────────────────────────────────────────────────────

  private buildSqlOrderBy(sort?: ProductSort): Prisma.Sql {
    switch (sort) {
      case "price_asc":
        return Prisma.sql`p."unitPrice" ASC, p.id ASC`;
      case "price_desc":
        return Prisma.sql`p."unitPrice" DESC, p.id ASC`;
      case "name_asc":
        return Prisma.sql`p.name ASC, p.id ASC`;
      case "best-selling":
        return Prisma.sql`
          COALESCE((
            SELECT SUM(oi.quantity)
            FROM "OrderItem" oi
            WHERE oi."productId" = p.id
          ), 0) DESC,
          p.id ASC
        `;
      case "trending":
        return Prisma.sql`
          COALESCE((
            SELECT SUM(oi.quantity)
            FROM "OrderItem" oi
            JOIN "Order" o ON o.id = oi."orderId"
            WHERE oi."productId" = p.id
              AND o."placedAt" >= now() - interval '7 days'
          ), 0) DESC,
          COALESCE((
            SELECT SUM(oi.quantity)
            FROM "OrderItem" oi
            WHERE oi."productId" = p.id
          ), 0) DESC,
          p.id ASC
        `;
      case "nearest":
        return Prisma.sql`"distanceKm" ASC, p.id ASC`;
      case "newest":
      default:
        return Prisma.sql`p."createdAt" DESC, p.id ASC`;
    }
  }

  // ────────────────────────────────────────────────────────────
  // Prisma where + order (no-location path)
  // ────────────────────────────────────────────────────────────

  private buildPrismaWhere(dto: ListGlobalProductsDto): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = {
      status: dto.status ?? "ACTIVE",
      stock: { gt: 0 },
      store: {
        status: "ACTIVE",
        ...(dto.store ? { slug: dto.store } : {}),
      },
    };

    if (dto.isFeatured !== undefined) where.isFeatured = dto.isFeatured;
    if (dto.categoryId) where.categoryId = dto.categoryId;
    if (dto.category) where.category = { slug: dto.category };
    if (dto.tag) where.tags = { has: dto.tag };
    if (dto.tags?.length) where.tags = { hasSome: dto.tags };

    if (dto.minPrice != null || dto.maxPrice != null) {
      where.unitPrice = {};
      if (dto.minPrice != null) (where.unitPrice as any).gte = dto.minPrice;
      if (dto.maxPrice != null) (where.unitPrice as any).lte = dto.maxPrice;
    }

    if (dto.search) {
      where.OR = [
        { name: { contains: dto.search, mode: "insensitive" } },
        { sku: { contains: dto.search, mode: "insensitive" } },
        { code: { contains: dto.search, mode: "insensitive" } },
      ];
    }

    if (dto.onSale) {
      where.promotionLinks = { some: { promotion: { status: "ACTIVE" } } };
    }

    return where;
  }

  private resolvePrismaSort(
    sort?: ProductSort,
  ): Prisma.ProductOrderByWithRelationInput[] {
    switch (sort) {
      case "price_asc":
        return [{ unitPrice: "asc" }];
      case "price_desc":
        return [{ unitPrice: "desc" }];
      case "name_asc":
        return [{ name: "asc" }];
      case "newest":
        return [{ createdAt: "desc" }];
      // best-selling / trending / nearest require aggregates or distance.
      // When there's no location, degrade to newest.
      case "best-selling":
      case "trending":
      case "nearest":
      default:
        return [{ createdAt: "desc" }];
    }
  }

  // ────────────────────────────────────────────────────────────
  // Promotions — batched per store
  // ────────────────────────────────────────────────────────────

  private async fetchPromotionsForRows(
    rows: { id: string; categoryId: string; storeId: string }[],
  ) {
    if (rows.length === 0) return [];

    const byStore = new Map<string, { ids: string[]; categoryIds: string[] }>();
    for (const r of rows) {
      const bucket = byStore.get(r.storeId) ?? { ids: [], categoryIds: [] };
      bucket.ids.push(r.id);
      if (!bucket.categoryIds.includes(r.categoryId)) {
        bucket.categoryIds.push(r.categoryId);
      }
      byStore.set(r.storeId, bucket);
    }

    const all = await Promise.all(
      [...byStore.entries()].map(([storeId, bucket]) =>
        this.promotionFinder.findActiveForProducts({
          storeId,
          ids: bucket.ids,
          categoryIds: bucket.categoryIds,
        }),
      ),
    );

    return all.flat();
  }

  // ────────────────────────────────────────────────────────────
  // Everything below: unchanged (admin, store-scoped, CRUD, stock)
  // ────────────────────────────────────────────────────────────

  async listAdmin(storeId: string, dto: ListProductsDto) {
    return this.listStoreScoped(dto, storeId);
  }

  async findOne(storeId: string, id: string) {
    const p = await this.db.product.findFirst({
      where: { id, storeId },
      include: this.include,
    });
    if (!p) throw new NotFoundException("Product not found");

    const promotions = await this.promotionFinder.findActiveForProducts({
      storeId,
      ids: [p.id],
      categoryIds: [p.categoryId],
    });

    return serializeProduct(p, promotions);
  }

  private async listStoreScoped(dto: ListProductsDto, storeId: string) {
    const page = dto.page ?? 1;
    const perPage = dto.perPage ?? 20;
    const skip = (page - 1) * perPage;

    const where: Prisma.ProductWhereInput = { storeId };
    if (dto.status) where.status = dto.status;
    if (dto.isFeatured !== undefined) where.isFeatured = dto.isFeatured;
    if (dto.categoryId) where.categoryId = dto.categoryId;
    if (dto.category) where.category = { slug: dto.category };
    if (dto.tags?.length) where.tags = { hasSome: dto.tags };

    if (dto.minPrice != null || dto.maxPrice != null) {
      where.unitPrice = {};
      if (dto.minPrice != null) (where.unitPrice as any).gte = dto.minPrice;
      if (dto.maxPrice != null) (where.unitPrice as any).lte = dto.maxPrice;
    }

    if (dto.search) {
      where.OR = [
        { name: { contains: dto.search, mode: "insensitive" } },
        { sku: { contains: dto.search, mode: "insensitive" } },
        { code: { contains: dto.search, mode: "insensitive" } },
      ];
    }

    const orderBy = this.resolvePrismaSort(dto.sort as any);

    const [total, rows] = await this.db.$transaction([
      this.db.product.count({ where }),
      this.db.product.findMany({
        where,
        include: this.include,
        orderBy,
        skip,
        take: perPage,
      }),
    ]);

    const promotions = await this.promotionFinder.findActiveForProducts({
      storeId,
      ids: rows.map((r) => r.id),
      categoryIds: [...new Set(rows.map((r) => r.categoryId))],
    });

    return {
      items: serializeProducts(rows, promotions),
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      page,
    };
  }

  async create(storeId: string, dto: CreateProductDto) {
    const link = await this.db.storeCategory.findUnique({
      where: { storeId_categoryId: { storeId, categoryId: dto.categoryId } },
    });
    if (!link) {
      throw new ForbiddenException("This category is not enabled for your store");
    }

    const baseSlug = slugify(dto.slug ?? dto.name);
    const slug = await this.uniqueSlug(storeId, baseSlug);

    const sku =
      dto.sku ?? (await nextCode(this.db, "product_sku", "SKU", 6, storeId));
    const skuClash = await this.db.product.findUnique({
      where: { storeId_sku: { storeId, sku } },
    });
    if (skuClash) throw new ConflictException("SKU already exists in this store");

    const code = await nextCode(this.db, "product_code", "PRD", 4, storeId);

    const hasVariants =
      dto.variantOption === "PARENT" ||
      (dto.variants && dto.variants.length > 0);
    if (hasVariants && (!dto.variants || dto.variants.length === 0)) {
      throw new BadRequestException(
        "variantOption PARENT requires at least one variant",
      );
    }

    const created = await this.db.product.create({
      data: {
        storeId,
        code,
        name: dto.name,
        slug,
        description: dto.description ?? null,
        shortDescription: dto.shortDescription ?? null,
        images: dto.images ?? undefined,
        categoryId: dto.categoryId,
        sku,
        variantOption: dto.variantOption ?? "NONE",
        unitType: dto.unitType,
        unitPrice: new Prisma.Decimal(dto.unitPrice),
        weight: dto.weight != null ? new Prisma.Decimal(dto.weight) : null,
        stock: dto.stock ?? 0,
        reorderLevel: dto.reorderLevel ?? 5,
        status: dto.status ?? "ACTIVE",
        isFeatured: dto.isFeatured ?? false,
        tags: dto.tags ?? [],
        displayOrder: dto.displayOrder ?? 0,
        variants: dto.variants?.length
          ? {
              create: dto.variants.map((v) => ({
                label: v.label,
                sku: v.sku ?? `${sku}-${slugify(v.label)}`,
                unitPrice: new Prisma.Decimal(v.unitPrice),
                stock: v.stock ?? 0,
                isDefault: v.isDefault ?? false,
              })),
            }
          : undefined,
      },
      include: this.include,
    });

    return serializeProduct(created);
  }

  private async uniqueSlug(storeId: string, base: string): Promise<string> {
    let slug = base;
    let i = 1;
    while (
      await this.db.product.findUnique({
        where: { storeId_slug: { storeId, slug } },
      })
    ) {
      slug = `${base}-${i++}`;
    }
    return slug;
  }

  async update(storeId: string, id: string, dto: UpdateProductDto) {
    const existing = await this.db.product.findFirst({
      where: { id, storeId },
      include: { variants: true },
    });
    if (!existing) throw new NotFoundException("Product not found");

    if (dto.categoryId && dto.categoryId !== existing.categoryId) {
      const link = await this.db.storeCategory.findUnique({
        where: { storeId_categoryId: { storeId, categoryId: dto.categoryId } },
      });
      if (!link) {
        throw new ForbiddenException(
          "This category is not enabled for your store",
        );
      }
    }

    let slug: string | undefined;
    if (dto.slug || dto.name) {
      const base = slugify(dto.slug ?? dto.name ?? existing.name);
      slug = base;
      let i = 1;
      while (
        await this.db.product.findFirst({
          where: { storeId, slug, NOT: { id } },
          select: { id: true },
        })
      ) {
        slug = `${base}-${i++}`;
      }
    }

    if (dto.sku && dto.sku !== existing.sku) {
      const skuClash = await this.db.product.findFirst({
        where: { storeId, sku: dto.sku, NOT: { id } },
        select: { id: true },
      });
      if (skuClash) throw new ConflictException("SKU already in use");
    }

    const updated = await this.db.$transaction(async (tx) => {
      if (dto.variants) {
        await tx.productVariant.deleteMany({ where: { productId: id } });
      }

      return tx.product.update({
        where: { id },
        data: {
          name: dto.name ?? undefined,
          slug: slug ?? undefined,
          description:
            dto.description === undefined ? undefined : dto.description,
          shortDescription:
            dto.shortDescription === undefined
              ? undefined
              : dto.shortDescription,
          images: dto.images === undefined ? undefined : dto.images,
          categoryId: dto.categoryId ?? undefined,
          sku: dto.sku ?? undefined,
          variantOption: dto.variantOption ?? undefined,
          unitType: dto.unitType ?? undefined,
          unitPrice:
            dto.unitPrice != null ? new Prisma.Decimal(dto.unitPrice) : undefined,
          weight:
            dto.weight === undefined
              ? undefined
              : dto.weight == null
                ? null
                : new Prisma.Decimal(dto.weight),
          stock: dto.stock ?? undefined,
          reorderLevel: dto.reorderLevel ?? undefined,
          status: dto.status ?? undefined,
          isFeatured: dto.isFeatured ?? undefined,
          tags: dto.tags ?? undefined,
          displayOrder: dto.displayOrder ?? undefined,
          variants: dto.variants?.length
            ? {
                create: dto.variants.map((v) => ({
                  label: v.label,
                  sku:
                    v.sku ?? `${dto.sku ?? existing.sku}-${slugify(v.label)}`,
                  unitPrice: new Prisma.Decimal(v.unitPrice),
                  stock: v.stock ?? 0,
                  isDefault: v.isDefault ?? false,
                })),
              }
            : undefined,
        },
        include: this.include,
      });
    });

    return serializeProduct(updated);
  }

  async remove(storeId: string, id: string) {
    const existing = await this.db.product.findFirst({
      where: { id, storeId },
      include: { _count: { select: { orderItems: true } } },
    });
    if (!existing) throw new NotFoundException("Product not found");

    if (existing._count.orderItems > 0) {
      const soft = await this.db.product.update({
        where: { id },
        data: { status: "INACTIVE" },
        include: this.include,
      });
      return {
        id,
        softDeleted: true,
        product: serializeProduct(soft),
        message:
          "Product has order history; marked INACTIVE instead of deleted.",
      };
    }

    await this.db.product.delete({ where: { id } });
    return { id, softDeleted: false };
  }

  async adjustStock(
    storeId: string,
    productId: string,
    delta: number,
    reason: string,
    reference?: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, storeId },
      });
      if (!product) throw new NotFoundException("Product not found");

      const nextStock = product.stock + delta;
      if (nextStock < 0) throw new BadRequestException("Stock cannot go negative");

      await tx.product.update({
        where: { id: productId },
        data: { stock: nextStock },
      });

      await tx.stockMovement.create({
        data: { storeId, productId, delta, reason, reference: reference ?? null },
      });

      return { productId, stock: nextStock };
    });
  }
}