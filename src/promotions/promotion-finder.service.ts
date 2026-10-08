import { Injectable } from "@nestjs/common";
import { PromotionLike } from "./promotion-calc.js";
import { DatabaseService } from "../database/database.service.js";

@Injectable()
export class PromotionFinderService {
  constructor(private db: DatabaseService) {}

  async findActiveForProducts(params: {
    storeId: string;
    ids: string[];
    categoryIds: string[];
  }): Promise<PromotionLike[]> {
    const now = new Date();
    return this.db.promotion.findMany({
      where: {
        storeId: params.storeId,
        status: "ACTIVE",
        startAt: { lte: now },
        OR: [{ endAt: null }, { endAt: { gte: now } }],
        AND: [
          {
            OR: [
              { appliesTo: "ALL_ORDERS" },
              { appliesTo: "CATEGORY", categoryId: { in: params.categoryIds } },
              {
                appliesTo: "SPECIFIC_PRODUCTS",
                productIds: { hasSome: params.ids },
              },
            ],
          },
        ],
      },
    });
  }

  /** All active promotions for ONE store — used by storefront banners. */
  async findAllActive(storeId: string): Promise<PromotionLike[]> {
    const now = new Date();
    return this.db.promotion.findMany({
      where: {
        storeId,                        // ← tenant filter
        status: "ACTIVE",
        startAt: { lte: now },
        OR: [{ endAt: null }, { endAt: { gte: now } }],
      },
      orderBy: { createdAt: "desc" },
    });
  }
}