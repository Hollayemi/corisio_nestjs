import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";

import { CreateProductDto } from "./dto/create-product.dto.js";
import { UpdateProductDto } from "./dto/update-product.dto.js";
import { ListProductsDto } from "./dto/list-products.dto.js";
import { ProductsService } from "./products.service.js";
import { CloudinaryService } from "../cloudinary/cloudinary.js";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { StoreContextGuard } from "../auth/guards/store-context.guard.js";
import { StoreMemberGuard } from "../auth/guards/store-member.guard.js";

@UseGuards(JwtAuthGuard, StoreContextGuard, StoreMemberGuard)
@Controller("admin/inventory")
export class AdminProductsController {
  constructor(
    private products: ProductsService,
    private cloudinary: CloudinaryService,
  ) {}

  @Get()
  async list(@Req() req: any, @Query() dto: ListProductsDto) {
    return {
      message: "OK",
      data: await this.products.listAdmin(req.storeId, dto),
    };
  }

  @Get(":id")
  async detail(@Req() req: any, @Param("id") id: string) {
    return {
      message: "OK",
      data: await this.products.findOne(req.storeId, id),
    };
  }

  @Post()
  @UseInterceptors(FilesInterceptor("images", 8, { storage: memoryStorage() }))
  async create(
    @Req() req: any,
    @Body() dto: CreateProductDto,
    @UploadedFiles() images?: Express.Multer.File[],
  ) {
    if (!images?.length) {
      throw new BadRequestException("Product image required");
    }
    const urls = await this.cloudinary.uploadMany(images);
    return {
      message: "Product created",
      data: await this.products.create(req.storeId, {
        ...dto,
        unitPrice: Number(dto.unitPrice),
        weight: dto.weight != null ? Number(dto.weight) : undefined,
        stock: dto.stock != null ? Number(dto.stock) : undefined,
        reorderLevel:
          dto.reorderLevel != null ? Number(dto.reorderLevel) : undefined,
        images: urls,
      }),
    };
  }

  @Patch(":id")
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return {
      message: "Product updated",
      data: await this.products.update(req.storeId, id, dto),
    };
  }

  @Delete(":id")
  async remove(@Req() req: any, @Param("id") id: string) {
    return {
      message: "Product removed",
      data: await this.products.remove(req.storeId, id),
    };
  }

  @Post(":id/stock")
  async adjustStock(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { delta: number; reason: string; reference?: string },
  ) {
    return {
      message: "Stock adjusted",
      data: await this.products.adjustStock(
        req.storeId,
        id,
        body.delta,
        body.reason,
        body.reference,
      ),
    };
  }
}