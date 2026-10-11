import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { ProductsModule } from './products/products.module.js';
import { CloudinaryModule } from './cloudinary/cloudinary.module.js';
import { CloudinaryController } from './cloudinary/cloudinary.controller.js';
import { UsersModule } from './users/users.module.js';
import { CartModule } from './cart/cart.module.js';
import { PromotionsModule } from './promotions/promotion.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { OverviewModule } from './overview/overview.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { NotificationModule } from './notification/notification.module.js';
import { StoresModule } from './stores/stores.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath: '.env', isGlobal: true }),
    // Default: 120 requests/minute per IP. Auth routes tighten this with @Throttle.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    CloudinaryModule,
    UsersModule,
    CartModule,
    PromotionsModule,
    OrdersModule,
    PaymentsModule,
    OverviewModule,
    SettingsModule,
    NotificationModule,
    StoresModule,
    // To enable observability, load credentials from env, e.g.:
    // ObserveModule.forRoot({
    //   appKey: process.env.OBSERVE_APP_KEY!,
    //   appSecret: process.env.OBSERVE_APP_SECRET!,
    //   serviceId: 'luxol_backend',
    // }),
  ],
  controllers: [AppController, CloudinaryController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
