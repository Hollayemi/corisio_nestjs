// src/products/dto/list-global-products.dto.ts
import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { ProductStatus } from "../../generated/prisma/enums.js";

const PRODUCT_SORTS = [
  "newest",
  "price_asc",
  "price_desc",
  "name_asc",
  "best-selling",
  "trending",
  "nearest",
] as const;

export type ProductSort = (typeof PRODUCT_SORTS)[number];

export class ListGlobalProductsDto {
  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @IsString()
  categoryId?: string;

  @IsOptional() @IsString()
  category?: string;

  @IsOptional() @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional() @IsBoolean() @Type(() => Boolean)
  isFeatured?: boolean;

  @IsOptional() @IsArray() @IsString({ each: true }) @Type(() => String)
  tags?: string[];

  /** Single-tag shortcut (e.g. `?tag=deal-of-the-day`). */
  @IsOptional() @IsString()
  tag?: string;

  @IsOptional() @IsNumber() @Type(() => Number)
  minPrice?: number;

  @IsOptional() @IsNumber() @Type(() => Number)
  maxPrice?: number;

  @IsOptional() @IsString()
  store?: string;

  /** Only products with an active promotion. */
  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  onSale?: boolean;

  /** Keep only products whose store has a location within N km. Requires location headers. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1)
  radiusKm?: number;

  @IsOptional() @IsIn(PRODUCT_SORTS)
  sort?: ProductSort;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  perPage?: number = 20;
}