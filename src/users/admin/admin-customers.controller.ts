import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ListAdminCustomersDto } from "../dto/list-admin-customers.dto.js";
import { GetAdminCustomerStatsDto } from "../dto/get-admin-customer-stats.dto.js";
import { UpdateAdminCustomerStatusDto } from "../dto/update-admin-customer-status.dto.js";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../auth/guards/roles.guard.js";
import { Role } from "../../generated/prisma/enums.js";
import { Roles } from "../../common/decorator/roles.decorator.js";
import { AdminCustomersService } from "./admin-customers.service.js";
import { StoreMemberGuard } from "../../auth/guards/store-member.guard.js";
import { StoreContextGuard } from "../../auth/guards/store-context.guard.js";

@UseGuards(JwtAuthGuard, StoreContextGuard, RolesGuard, StoreMemberGuard)
@Controller("admin/customers")
export class AdminCustomersController {
  constructor(private customers: AdminCustomersService) { }

  @Get("stats")
  async stats(@Query() dto: GetAdminCustomerStatsDto) {
    return { message: "OK", data: await this.customers.stats(dto) };
  }

  @Get()
  async list(@Query() dto: ListAdminCustomersDto) {
    return { message: "OK", data: await this.customers.list(dto) };
  }

  @Get(":id")
  async detail(@Param("id") id: string) {
    return { message: "OK", data: await this.customers.findOne(id) };
  }

  @Patch(":id/status")
  async updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateAdminCustomerStatusDto,
  ) {
    return {
      message: "Customer status updated",
      data: await this.customers.updateStatus(id, dto),
    };
  }
}