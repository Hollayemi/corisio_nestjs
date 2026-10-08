// src/promotions/promotion.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { StoreContextGuard } from "../auth/guards/store-context.guard.js";
import { StoreMemberGuard } from "../auth/guards/store-member.guard.js";
import { PromotionsService } from "./promotion.service.js";
import { ListPromotionsDto } from "./dto/list-promotion.dto.js";
import { CreatePromotionDto } from "./dto/create-promotions.dto.js";
import { UpdatePromotionDto } from "./dto/update-promotion.dto.js";

@UseGuards(JwtAuthGuard, StoreContextGuard, StoreMemberGuard)
@Controller("admin/promotions")
export class PromotionsController {
  constructor(private promotions: PromotionsService) {}

  @Get("stats")
  async stats(@Req() req: any) {
    return { message: "OK", data: await this.promotions.stats(req.storeId) };
  }

  @Get()
  async list(@Req() req: any, @Query() dto: ListPromotionsDto) {
    return { message: "OK", data: await this.promotions.list(req.storeId, dto) };
  }

  @Get(":id")
  async findOne(@Req() req: any, @Param("id") id: string) {
    return { message: "OK", data: await this.promotions.findOne(req.storeId, id) };
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreatePromotionDto) {
    return {
      message: "Promotion created",
      data: await this.promotions.create(req.storeId, dto),
    };
  }

  @Patch(":id")
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: UpdatePromotionDto,
  ) {
    return {
      message: "Promotion updated",
      data: await this.promotions.update(req.storeId, id, dto),
    };
  }

  @Post(":id/pause")
  async pause(@Req() req: any, @Param("id") id: string) {
    return {
      message: "Promotion paused",
      data: await this.promotions.pause(req.storeId, id),
    };
  }

  @Post(":id/resume")
  async resume(@Req() req: any, @Param("id") id: string) {
    return {
      message: "Promotion resumed",
      data: await this.promotions.resume(req.storeId, id),
    };
  }

  @Delete(":id")
  async remove(@Req() req: any, @Param("id") id: string) {
    return {
      message: "Promotion deleted",
      data: await this.promotions.remove(req.storeId, id),
    };
  }
}



