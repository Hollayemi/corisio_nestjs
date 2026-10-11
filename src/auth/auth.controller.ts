import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Post,
  Query,
  Redirect,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Throttle } from "@nestjs/throttler";

import {
  CreateStoreDto,
  ForgotPasswordDto,
  GoogleDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from "./dto/register.dto.js";
import { JwtAuthGuard } from "./guards/jwt-auth.guard.js";
import { CurrentUser } from "../common/decorator/current-user.decorator.js";
import { AuthService } from "./auth.service.js";


// With `trust proxy` configured in main.ts, Express resolves req.ip from
// X-Forwarded-For safely. Never read that header directly: callers can spoof it.
function clientIp(req: Request): string | undefined {
  return req.ip ?? req.socket?.remoteAddress ?? undefined;
}

// Stricter than the global limit: credential endpoints are brute-force targets.
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) { }

  // ─────────────────────────────────────────────
  // REGISTER / LOGIN
  // ─────────────────────────────────────────────

  @Throttle(AUTH_THROTTLE)
  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Throttle(AUTH_THROTTLE)
  @Post("login")
  login(
    @Body() dto: LoginDto,
    @Headers("user-agent") userAgent: string | undefined,
    @Req() req: Request,
  ) {
    return this.auth.login(dto, userAgent, clientIp(req));
  }

  @Throttle(AUTH_THROTTLE)
  @Post("google")
  google(
    @Body() dto: GoogleDto,
    @Headers("user-agent") userAgent: string | undefined,
    @Req() req: Request,
  ) {
    return this.auth.loginWithGoogle(dto.idToken, userAgent, clientIp(req));
  }

  // ─────────────────────────────────────────────
  // STORE SETUP (runs after register with accountType=STORE_OWNER)
  // ─────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post("stores")
  createStore(
    @CurrentUser() user: { id: string, sid: string },
    @Body() dto: CreateStoreDto,
    @Headers("user-agent") userAgent: string | undefined,
    @Req() req: Request,
  ) {
    return this.auth.createStore(user.id, user.sid, dto, userAgent, clientIp(req));
  }

  // ─────────────────────────────────────────────
  // PASSWORD RESET / EMAIL VERIFY
  // ─────────────────────────────────────────────

  @Throttle(AUTH_THROTTLE)
  @Post("forgot-password")
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Throttle(AUTH_THROTTLE)
  @Post("reset-password")
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Throttle(AUTH_THROTTLE)
  @Get("verify-email")
  @Redirect()
  async verify(@Query("token") token: string) {
    const ok = await this.auth.verifyEmail(token);

    // Send them somewhere useful either way.
    const base = process.env.FRONTEND_URL ?? "http://localhost:3000";
    const target = ok
      ? `${base}/login?verified=1`
      : `${base}/verify-email?error=invalid_token`;

    return { url: target, statusCode: 302 };
  }

  // ─────────────────────────────────────────────
  // SESSION
  // ─────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@CurrentUser() user: { id: string }) {
    const me = this.auth.me(user.id);
    return me;
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout")
  logout(@CurrentUser() user: { id: string; sid?: string | null }) {
    return this.auth.logout(user.id, user.sid ?? null);
  }
}