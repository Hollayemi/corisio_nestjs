import { Module } from "@nestjs/common";
import { ProductsService } from "./products.service.js";
import {
  
  PublicProductsController,
} from "./products.controller.js";
import { DatabaseService } from "../database/database.service.js";
import { CloudinaryService } from "../cloudinary/cloudinary.js";
import { PromotionFinderService } from "../promotions/promotion-finder.service.js";
import { AdminProductsController } from "./admin-products.controller.js";
import { GlobalProductsController } from "./global-products.controller.js";

@Module({
  controllers: [PublicProductsController, AdminProductsController, GlobalProductsController],
  providers: [ProductsService, DatabaseService, PromotionFinderService, CloudinaryService],
  exports: [ProductsService],
})
export class ProductsModule {}