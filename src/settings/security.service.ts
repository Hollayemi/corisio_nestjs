import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { DatabaseService } from "../database/database.service.js";
import { ChangeAdminPasswordDto } from "./dto/change-password.dto.js";
import { SetTwoFactorDto } from "./dto/set-two-factor.dto.js";
import { ListLoginActivityDto } from "./dto/list-login-activity.dto.js";
import {
  serializeLoginActivity,
  serializeSecurity,
  serializeSession,
} from "./settings.serializer.js";

@Injectable()
export class SecurityService {
  constructor(private db: DatabaseService) {}

  async get(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    return serializeSecurity(user);
  }

  async changePassword(userId: string, dto: ChangeAdminPasswordDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException("Passwords do not match");
    }

    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) {
      throw new NotFoundException("User not found");
    }

    const ok = await bcrypt.compare(dto.oldPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException("Current password is incorrect");

    if (dto.oldPassword === dto.newPassword) {
      throw new BadRequestException("New password must be different");
    }

    const hash = await bcrypt.hash(dto.newPassword, 12);

    await this.db.$transaction([
      this.db.user.update({
        where: { id: userId },
        data: { passwordHash: hash, passwordChangedAt: new Date() },
      }),
      // Revoke every session — the user must log back in on all devices
      this.db.adminSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { passwordChangedAt: new Date().toISOString() };
  }

  async setTwoFactor(userId: string, dto: SetTwoFactorDto) {
    // v2: require TOTP verification before flipping the flag
    const user = await this.db.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: dto.enabled },
    });
    return serializeSecurity(user);
  }

  // ─── Sessions ──────────────────────────────────────────────

  async listSessions(userId: string, currentSessionId: string | null) {
    const rows = await this.db.adminSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastActiveAt: "desc" },
    });
    return { items: rows.map((s) => serializeSession(s, currentSessionId)) };
  }

  async revokeSession(
    userId: string,
    id: string,
    currentSessionId: string | null,
  ) {
    const session = await this.db.adminSession.findFirst({
      where: { id, userId, revokedAt: null },
    });
    if (!session) throw new NotFoundException("Session not found");

    await this.db.adminSession.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    return {
      id,
      wasCurrent: currentSessionId !== null && session.id === currentSessionId,
    };
  }

  // ─── Login activity ───────────────────────────────────────

  async listLoginActivity(userId: string, dto: ListLoginActivityDto) {
    const rows = await this.db.loginActivity.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: dto.limit ?? 20,
    });
    return { items: rows.map(serializeLoginActivity) };
  }
}