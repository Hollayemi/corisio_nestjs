import { Module } from '@nestjs/common';
import { StoreProfileService } from './stores.service.js';
import { StoreProfileController } from './stores.controller.js';
import { DatabaseService } from '../database/database.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.js';
import { PublicStoresController } from './public-stores.controller.js';
import { PromotionFinderService } from '../promotions/promotion-finder.service.js';
import { StoreDiscoveryService } from './store-discovery.service.js';

@Module({
  controllers: [StoreProfileController, PublicStoresController],
  providers: [StoreProfileService, DatabaseService, CloudinaryService, PromotionFinderService, StoreDiscoveryService],
  exports: [StoreProfileService],
})
export class StoresModule {}
