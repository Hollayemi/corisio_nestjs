// src/products/global-products.controller.ts
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { ProductsService } from "./products.service.js";
import { ListProductsDto } from "./dto/list-products.dto.js";
import { ListGlobalProductsDto } from "./dto/list-global-products.dto.js";
import { DatabaseService } from "../database/database.service.js";
import type { Coords } from "../common/decorator/user-location.decorator.js";

@Controller("catalog/products")
export class GlobalProductsController {
  constructor(
    private products: ProductsService,
    private db: DatabaseService,
  ) {}

  @Get()
  async list(@Query() dto: ListGlobalProductsDto, here: Coords) {
    return {
      message: "OK",
      data: await this.products.listGlobal(dto, here),
    };
  }

  /**
   * Detail for a product in a specific store.
   * The URL carries both because slugs are only unique per store.
   */
  @Get("/:slug")
  async detail(
    // @Param("storeSlug") storeSlug: string,
    @Param("slug") slug: string,
  ) {
    // const store = await this.db.store.findUnique({
    //   where: { slug: storeSlug },
    //   select: { id: true, status: true },
    // });
    // if (!store || store.status !== "ACTIVE") {
    //   throw new NotFoundException("Store not found");
    // }
    return {
      message: "OK",
      data: await this.products.findBySlug(slug),
    };
  }

  @Get(":storeSlug/:slug/related")
  async related(
    @Param("storeSlug") storeSlug: string,
    @Param("slug") slug: string,
    @Query("limit") limit?: string,
  ) {
    const store = await this.db.store.findUnique({
      where: { slug: storeSlug },
      select: { id: true, status: true },
    });
    if (!store || store.status !== "ACTIVE") {
      throw new NotFoundException("Store not found");
    }
    const product = await this.products.findBySlug(slug);
    return {
      message: "OK",
      data: await this.products.related(
        product.id,
        store.id,
        limit ? parseInt(limit, 10) : 6,
      ),
    };
  }
}