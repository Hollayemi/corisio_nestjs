import {
  Controller,
  Get,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Role } from "../generated/prisma/client.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../common/decorator/roles.decorator.js";
import { AdminOverviewService } from "./admin-overview.service.js";
import { GetTopProductsDto } from "./dto/get-top-products.dto.js";
import { StoreContextGuard, StoreMemberGuard } from "../auth/guards/store-context.guard.js";


@UseGuards(JwtAuthGuard, StoreContextGuard, RolesGuard, StoreMemberGuard)
// @Roles(Role.SUPER_ADMIN)
@Controller("admin/overview")
export class AdminOverviewController {
  constructor(private svc: AdminOverviewService) { }

  @Get()
  async summary() {
    return { message: "OK", data: await this.svc.summary() };
  }

  @Get("top-products")
  async topProducts(@Query() dto: GetTopProductsDto) {
    return { message: "OK", data: await this.svc.topProducts(dto) };
  }
}