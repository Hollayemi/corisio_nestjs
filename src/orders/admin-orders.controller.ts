// src/admin-orders/admin-orders.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ListAdminOrdersDto } from "./dto/list-admin-orders.dto.js";
import { GetAdminOrderStatsDto } from "./dto/get-admin-order-stats.dto.js";
import { UpdateAdminOrderStatusDto } from "./dto/update-admin-order-status.dto.js";
import { CancelAdminOrderDto } from "./dto/cancel-admin-order.dto.js";
import { AdminOrdersService } from "./admin-orders.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { StoreContextGuard } from "../auth/guards/store-context.guard.js";
import { StoreMemberGuard } from "../auth/guards/store-member.guard.js";
import { CurrentUser } from "../common/decorator/current-user.decorator.js";

@UseGuards(JwtAuthGuard, StoreContextGuard, StoreMemberGuard)
@Controller("admin/orders")
export class AdminOrdersController {
  constructor(private orders: AdminOrdersService) { }

  @Get("stats")
  async stats(@Req() req: any, @Query() dto: GetAdminOrderStatsDto) {
    return { message: "OK", data: await this.orders.stats(req.storeId, dto) };
  }

  @Get()
  async list(@Req() req: any, @Query() dto: ListAdminOrdersDto) {
    return { message: "OK", data: await this.orders.list(req.storeId, dto) };
  }

  @Get(":id")
  async detail(@Req() req: any, @Param("id") id: string) {
    return { message: "OK", data: await this.orders.findOne(req.storeId, id) };
  }

  @Patch(":id/status")
  async updateStatus(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: UpdateAdminOrderStatusDto,
  ) {
    return {
      message: "Order status updated",
      data: await this.orders.updateStatus(req.storeId, id, dto, req.user.id),
    };
  }

  @Post(":id/cancel")
  async cancel(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: CancelAdminOrderDto,
  ) {
    return {
      message: "Order cancelled",
      data: await this.orders.cancel(req.storeId, id, dto, req.user.id),
    };
  }
}