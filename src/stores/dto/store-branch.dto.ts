// src/stores/dto/store-branch.dto.ts
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

export class CreateStoreBranchDto {
  @IsString() @MinLength(2)
  label: string;

  @IsString() @MinLength(3)
  address: string;

  @IsString() @MinLength(2)
  region: string;

  @IsOptional() @IsString()
  country?: string;

  @IsOptional() @IsString()
  phone?: string;

  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;

  @IsOptional() @IsBoolean()
  isDefault?: boolean;
}

export class UpdateStoreBranchDto {
  @IsOptional() @IsString() @MinLength(2)
  label?: string;

  @IsOptional() @IsString() @MinLength(3)
  address?: string;

  @IsOptional() @IsString() @MinLength(2)
  region?: string;

  @IsOptional() @IsString()
  country?: string;

  @IsOptional() @IsString()
  phone?: string;

  @IsOptional() @IsLatitude()
  latitude?: number;

  @IsOptional() @IsLongitude()
  longitude?: number;

  @IsOptional() @IsBoolean()
  isDefault?: boolean;
}