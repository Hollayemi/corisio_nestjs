// src/products/public-products.controller.ts
import { Controller, Get, Param, Query } from "@nestjs/common";
import { ProductsService } from "./products.service.js";
import { ListProductsDto } from "./dto/list-products.dto.js";
import { DatabaseService } from "../database/database.service.js";

@Controller("stores/:storeSlug/catalog/products")
export class PublicProductsController {
  constructor(
    private products: ProductsService,
    private db: DatabaseService,
  ) {}

  private async resolveStoreId(storeSlug: string): Promise<string> {
    const store = await this.db.store.findUnique({
      where: { slug: storeSlug },
      select: { id: true, status: true },
    });
    if (!store || store.status !== "ACTIVE") {
      throw new Error("Store not found");
    }
    return store.id;
  }

  @Get()
  async list(@Param("storeSlug") storeSlug: string, @Query() dto: ListProductsDto) {
    const storeId = await this.resolveStoreId(storeSlug);
    return { message: "OK", data: await this.products.listPublic(dto, storeId) };
  }

  @Get(":slug")
  async detail(@Param("storeSlug") storeSlug: string, @Param("slug") slug: string) {
    const storeId = await this.resolveStoreId(storeSlug);
    return { message: "OK", data: await this.products.findBySlug(slug, storeId) };
  }

  @Get(":slug/related")
  async related(
    @Param("storeSlug") storeSlug: string,
    @Param("slug") slug: string,
    @Query("limit") limit?: string,
  ) {
    const storeId = await this.resolveStoreId(storeSlug);
    const product = await this.products.findBySlug(slug, storeId);
    return {
      message: "OK",
      data: await this.products.related(
        product.id,
        storeId,
        limit ? parseInt(limit, 10) : 6,
      ),
    };
  }
}