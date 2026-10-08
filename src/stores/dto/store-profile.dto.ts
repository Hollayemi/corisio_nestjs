// src/stores/dto/store-profile.dto.ts
import { Type } from "class-transformer";
import {
  IsEmail,
  IsLatitude,
  IsLongitude,
  IsObject,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUrl,
  Matches,
  MinLength,
  ValidateNested,
} from "class-validator";

// ─── Opening hours ─────────────────────────────────────────

class OpeningDayDto {
  @IsOptional()
  closed?: boolean;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: "open must be HH:mm" })
  open: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: "close must be HH:mm" })
  close: string;
}

export class OpeningHoursDto {
  @ValidateNested() @Type(() => OpeningDayDto) mon: OpeningDayDto;
  @ValidateNested() @Type(() => OpeningDayDto) tue: OpeningDayDto;
  @ValidateNested() @Type(() => OpeningDayDto) wed: OpeningDayDto;
  @ValidateNested() @Type(() => OpeningDayDto) thu: OpeningDayDto;
  @ValidateNested() @Type(() => OpeningDayDto) fri: OpeningDayDto;
  @ValidateNested() @Type(() => OpeningDayDto) sat: OpeningDayDto;
  @ValidateNested() @Type(() => OpeningDayDto) sun: OpeningDayDto;
}

// ─── Social links ──────────────────────────────────────────

export class SocialLinksDto {
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() instagram?: string;
  @IsOptional() @IsString() facebook?: string;
  @IsOptional() @IsString() x?: string;
}

// ─── Update profile ────────────────────────────────────────

export class UpdateStoreProfileDto {
  @IsOptional() @IsString() @MinLength(2)
  name?: string;

  @IsOptional() @IsString()
  legalName?: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString()
  tagline?: string;

  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsString()
  phone?: string;

  @IsOptional() @IsString()
  whatsapp?: string;

  @IsOptional() @IsString() @Matches(/^[A-Z0-9]{2,6}$/i, {
    message: "orderPrefix must be 2-6 alphanumeric characters",
  })
  orderPrefix?: string;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => OpeningHoursDto)
  openingHours?: OpeningHoursDto;
}

// ─── Update location ───────────────────────────────────────

export class UpdateStoreLocationDto {
  @IsOptional() @IsString()
  label?: string;

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

  @IsOptional() @IsString()
  timezone?: string;
}