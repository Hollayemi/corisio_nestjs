import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { PromotionFinderService } from "./promotion-finder.service.js";

@Controller("stores/:storeSlug/promotions")
export class PublicPromotionsController {
  constructor(
    private finder: PromotionFinderService,
    private db: DatabaseService,
  ) {}

  @Get("active")
  async active(@    Param("storeSlug") slug: string) {
    const store = await this.db.store.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });
    if (!store || store.status !== "ACTIVE") throw new NotFoundException();

    return { message: "OK", data: await this.finder.findAllActive(store.id) };
  }
}