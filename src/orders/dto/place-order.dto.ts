import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import { IsNumberLike } from "../../common/decorator/number-or-string.js";

class PlaceOrderItemDto {
  @IsString() productId: string;
  @IsInt() @Min(1) quantity: number;
  @IsOptional() @IsString() variant?: string;
}

export class PlaceOrderDto {
  @IsString()
  storeId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlaceOrderItemDto)
  items: PlaceOrderItemDto[];

  @IsOptional()
  @IsString()
  addressId?: string;

  @IsNumberLike()
  phone: string;

  @IsIn(["DELIVERY", "PICKUP"])
  deliveryMethod: "DELIVERY" | "PICKUP";

  @IsOptional()
  @IsString()
  promoCode?: string;
}