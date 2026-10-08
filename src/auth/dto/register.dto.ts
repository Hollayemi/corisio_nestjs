import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { IsNumberLike } from '../../common/decorator/number-or-string.js';
import { Role, SignupAccountType } from '../../generated/prisma/client.js';

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

// ─────────────────────────────────────────────
// REGISTER — one step, one form
// ─────────────────────────────────────────────

export class RegisterDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_RULE, {
    message: 'Password must contain at least one letter and one number',
  })
  password: string;

  @IsEnum(SignupAccountType)
  accountType: SignupAccountType;
}

// ─────────────────────────────────────────────
// LOGIN — no store context at all
// ─────────────────────────────────────────────

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;

  @IsOptional()
  @IsEnum(Role)
  type?: Role;
}

// ─────────────────────────────────────────────
// GOOGLE OAUTH
// ─────────────────────────────────────────────

export class GoogleDto {
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @IsOptional()
  @IsEnum(Role)
  accountType?: Role;
}

// ─────────────────────────────────────────────
// STORE SETUP — runs AFTER registration
// ─────────────────────────────────────────────

export class CreateStoreDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsNotEmpty()
  region: string;

  @IsNumberLike()
  latitude: number;

  @IsNumberLike()
  longitude: number;

  @IsOptional()
  @IsString()
  description?: string;
}

// ─────────────────────────────────────────────
// PASSWORD RESET
// ─────────────────────────────────────────────

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_RULE)
  password: string;

  @IsString()
  @IsNotEmpty()
  confirmPassword: string;
}

// ─────────────────────────────────────────────
// REFRESH / LOGOUT
// ─────────────────────────────────────────────

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class LogoutDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class AcceptInviteDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
}