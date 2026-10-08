import { Type } from "class-transformer";
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from "class-validator";

const STORE_SORTS = ["nearest", "popular", "rating"] as const;
export type StoreSort = (typeof STORE_SORTS)[number];

export class ListPublicStoresDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() category?: string;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(500)
  radiusKm?: number;

  @IsOptional() @IsIn(STORE_SORTS)
  sort?: StoreSort;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number = 100;
}