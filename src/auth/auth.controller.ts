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


function clientIp(req: Request): string | undefined {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]!.trim();
  }
  if (Array.isArray(fwd) && fwd.length > 0) {
    return fwd[0]!.split(",")[0]!.trim();
  }
  return req.ip ?? req.socket?.remoteAddress ?? undefined;
}

@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) { }

  // ─────────────────────────────────────────────
  // REGISTER / LOGIN
  // ─────────────────────────────────────────────

  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post("login")
  login(
    @Body() dto: LoginDto,
    @Headers("user-agent") userAgent: string | undefined,
    @Req() req: Request,
  ) {
    return this.auth.login(dto, userAgent, clientIp(req));
  }

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

  @Post("forgot-password")
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Post("reset-password")
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

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