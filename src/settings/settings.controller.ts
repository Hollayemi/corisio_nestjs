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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { StoreContextGuard } from "../auth/guards/store-context.guard.js";
import { StoreMemberGuard } from "../auth/guards/store-member.guard.js";
import { CurrentUser } from "../common/decorator/current-user.decorator.js";
import type { AuthUser } from "../auth/auth.types.js";

import { ProfileService } from "./profile.service.js";
import { SecurityService } from "./security.service.js";
import { AdminNotificationsService } from "./notifications.service.js";
import { TeamService } from "./team.service.js";

import { UpdateAdminProfileDto } from "./dto/update-profile.dto.js";
import { ChangeAdminPasswordDto } from "./dto/change-password.dto.js";
import { SetTwoFactorDto } from "./dto/set-two-factor.dto.js";
import { ListLoginActivityDto } from "./dto/list-login-activity.dto.js";
import { UpdateNotificationSettingsDto } from "./dto/update-notification-settings.dto.js";
import { InviteAdminUserDto } from "./dto/invite-admin.dto.js";
import { UpdateTeamStatusDto } from "./dto/update-team-status.dto.js";

// ─────────────────────────────────────────────────────────────
// PERSONAL SETTINGS (user-scoped — no store context needed)
// ─────────────────────────────────────────────────────────────

@UseGuards(JwtAuthGuard)
@Controller("admin/settings")
export class AdminSettingsController {
  constructor(
    private profile: ProfileService,
    private security: SecurityService,
    private notifications: AdminNotificationsService,
  ) { }

  // ─── Profile ─────────────────────────────────────────────

  @Get("profile")
  async getProfile(@CurrentUser() u: AuthUser) {
    return { message: "OK", data: await this.profile.get(u.id) };
  }

  @Patch("profile")
  @UseInterceptors(
    FileInterceptor("avatar", { limits: { fileSize: 4 * 1024 * 1024 } }),
  )
  async updateProfile(
    @CurrentUser() u: AuthUser,
    @Body() dto: UpdateAdminProfileDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (file) {
      const allowed = ["image/png", "image/jpeg", "image/jpg", "image/gif"];
      if (!allowed.includes(file.mimetype)) {
        throw new BadRequestException("Only PNG, JPG or GIF images are allowed");
      }
    }
    return {
      message: "Profile updated",
      data: await this.profile.update(u.id, dto, file),
    };
  }

  // ─── Security ────────────────────────────────────────────

  @Get("security")
  async getSecurity(@CurrentUser() u: AuthUser) {
    return { message: "OK", data: await this.security.get(u.id) };
  }

  @Post("security/password")
  async changePassword(
    @CurrentUser() u: AuthUser,
    @Body() dto: ChangeAdminPasswordDto,
  ) {
    return {
      message: "Password changed",
      data: await this.security.changePassword(u.id, dto),
    };
  }

  @Patch("security/two-factor")
  async setTwoFactor(
    @CurrentUser() u: AuthUser,
    @Body() dto: SetTwoFactorDto,
  ) {
    return {
      message: "Two-factor updated",
      data: await this.security.setTwoFactor(u.id, dto),
    };
  }

  @Get("security/sessions")
  async listSessions(@CurrentUser() u: AuthUser) {
    return {
      message: "OK",
      data: await this.security.listSessions(u.id, u.sid),
    };
  }

  @Delete("security/sessions/:id")
  async revokeSession(
    @CurrentUser() u: AuthUser,
    @Param("id") id: string,
  ) {
    return {
      message: "Session revoked",
      data: await this.security.revokeSession(u.id, id, u.sid),
    };
  }

  @Get("security/login-activity")
  async listLoginActivity(
    @CurrentUser() u: AuthUser,
    @Query() dto: ListLoginActivityDto,
  ) {
    return {
      message: "OK",
      data: await this.security.listLoginActivity(u.id, dto),
    };
  }

  // ─── Notifications (personal, platform-wide) ────────────

  @Get("notifications")
  async getNotifications(@CurrentUser() u: AuthUser) {
    return {
      message: "OK",
      data: await this.notifications.get(u.id, null),
    };
  }

  @Patch("notifications")
  async updateNotifications(
    @CurrentUser() u: AuthUser,
    @Body() dto: UpdateNotificationSettingsDto,
  ) {
    return {
      message: "Notification settings updated",
      data: await this.notifications.update(u.id, dto, null),
    };
  }
}

// ─────────────────────────────────────────────────────────────
// STORE SETTINGS (store-scoped — team + per-store notification overrides)
// ─────────────────────────────────────────────────────────────

@UseGuards(JwtAuthGuard, StoreContextGuard, StoreMemberGuard)
@Controller("admin/stores/current")
export class StoreSettingsController {
  constructor(
    private notifications: AdminNotificationsService,
    private team: TeamService,
  ) { }

  // ─── Per-store notification overrides ───────────────────

  @Get("notifications")
  async getStoreNotifications(
    @Req() req: any,
    @CurrentUser() u: AuthUser,
  ) {
    return {
      message: "OK",
      data: await this.notifications.get(u.id, req.storeId),
    };
  }

  @Patch("notifications")
  async updateStoreNotifications(
    @Req() req: any,
    @CurrentUser() u: AuthUser,
    @Body() dto: UpdateNotificationSettingsDto,
  ) {
    return {
      message: "Store notification settings updated",
      data: await this.notifications.update(u.id, dto, req.storeId),
    };
  }

  // ─── Team ────────────────────────────────────────────────

  @Get("team")
  async listTeam(@Req() req: any, @CurrentUser() u: AuthUser) {
    return {
      message: "OK",
      data: await this.team.list(req.storeId, u.id),
    };
  }

  @Post("team/invite")
  async invite(
    @Req() req: any,
    @CurrentUser() u: AuthUser,
    @Body() dto: InviteAdminUserDto,
  ) {
    return {
      message: "Invitation sent",
      data: await this.team.invite(req.storeId, dto, u.id),
    };
  }

  @Post("team/invitations/:id/resend")
  async resend(@Req() req: any, @Param("id") id: string) {
    return {
      message: "Invitation resent",
      data: await this.team.resend(req.storeId, id),
    };
  }

  @Patch("team/:memberId/status")
  async updateTeamStatus(
    @Req() req: any,
    @Param("memberId") memberId: string,
    @Body() dto: UpdateTeamStatusDto,
    @CurrentUser() u: AuthUser,
  ) {
    return {
      message: "Team member updated",
      data: await this.team.updateStatus(req.storeId, memberId, dto, u.id),
    };
  }

  @Delete("team/:memberId")
  async removeTeamMember(
    @Req() req: any,
    @Param("memberId") memberId: string,
    @CurrentUser() u: AuthUser,
  ) {
    return {
      message: "Team member removed",
      data: await this.team.remove(req.storeId, memberId, u.id),
    };
  }
}