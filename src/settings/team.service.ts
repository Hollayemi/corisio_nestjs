import { ASSIGNABLE_STAFF_ROLES } from './settings.constants.js';
// src/admin-settings/team.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import { InviteAdminUserDto } from "./dto/invite-admin.dto.js";
import { UpdateTeamStatusDto } from "./dto/update-team-status.dto.js";
import { serializeTeamMember } from "./settings.serializer.js";
import {
  ROLE_LABELS,
} from "./settings.constants.js";
import { DatabaseService } from "../database/database.service.js";

@Injectable()
export class TeamService {
  constructor(private db: DatabaseService) {}

  // ────────────────────────────────────────────────────────────
  // List team for a store
  // ────────────────────────────────────────────────────────────

  async list(storeId: string, currentUserId: string) {
    const [members, invitations] = await Promise.all([
      this.db.storeMember.findMany({
        where: { storeId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
              email: true,
              lastLoginAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.db.adminInvitation.findMany({
        where: {
          storeId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const items = [
      ...members.map((m) =>
        serializeTeamMember(
          {
            id: m.id,
            name: m.user.name,
            image: m.user.image,
            email: m.user.email,
            role: m.role,
            status: m.status,
            lastLoginAt: m.user.lastLoginAt,
          },
          { canManage: m.user.id !== currentUserId && m.role !== "OWNER" },
        ),
      ),
      ...invitations.map((inv) => ({
        id: `invite_${inv.id}`,
        fullName: inv.email.split("@")[0],
        avatar: null,
        email: inv.email,
        role: (inv.storeRole ?? "SUPPORT").toLowerCase(),
        roleLabel: inv.storeRole ? ROLE_LABELS[inv.storeRole] : "Support",
        lastActiveAt: null,
        status: "invited" as const,
        canManage: true,
      })),
    ];

    return { items };
  }

  // ────────────────────────────────────────────────────────────
  // Invite a staff member to a store
  // ────────────────────────────────────────────────────────────

  async invite(
    storeId: string,
    dto: InviteAdminUserDto,
    invitedById: string,
  ) {
    if (!ASSIGNABLE_STAFF_ROLES.includes(dto.role)) {
      throw new BadRequestException(
        "You cannot assign this role. Owners are set at store creation.",
      );
    }

    const email = dto.email.toLowerCase();

    // Already a member of this store?
    const existingUser = await this.db.user.findUnique({ where: { email } });
    if (existingUser) {
      const existingMember = await this.db.storeMember.findFirst({
        where: { userId: existingUser.id, storeId },
      });
      if (existingMember) {
        throw new ConflictException("This user is already a member of this store");
      }
    }

    // Pending invite already exists for this email + store?
    const existingInvite = await this.db.adminInvitation.findFirst({
      where: {
        email,
        storeId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (existingInvite) {
      throw new ConflictException("An invitation is already pending for this email");
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await this.db.adminInvitation.create({
      data: {
        email,
        token,
        storeId,                                 // ← tenant FK
        storeRole: dto.role,
        invitedById,
        expiresAt,
      },
    });

    // TODO: send email with `${FRONTEND_URL}/admin/accept-invite?token=${token}`

    return {
      id: `invite_${invitation.id}`,
      fullName: email.split("@")[0],
      avatar: null,
      email,
      role: dto.role.toLowerCase(),
      roleLabel: ROLE_LABELS[dto.role],
      lastActiveAt: null,
      status: "invited" as const,
      canManage: true,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Resend invitation
  // ────────────────────────────────────────────────────────────

  async resend(storeId: string, invitationId: string) {
    const invite = await this.db.adminInvitation.findFirst({
      where: { id: invitationId, storeId },       // ← tenant filter
    });
    if (!invite || invite.acceptedAt || invite.revokedAt) {
      throw new NotFoundException("Invitation not found");
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.db.adminInvitation.update({
      where: { id: invitationId },
      data: { token, expiresAt },
    });

    // TODO: send the email

    return { id: `invite_${invitationId}` };
  }

  // ────────────────────────────────────────────────────────────
  // Update member status (activate / suspend)
  // ────────────────────────────────────────────────────────────

  async updateStatus(
    storeId: string,
    memberId: string,
    dto: UpdateTeamStatusDto,
    currentUserId: string,
  ) {
    const member = await this.db.storeMember.findFirst({
      where: { id: memberId, storeId },           // ← tenant filter
      include: { user: true },
    });
    if (!member) throw new NotFoundException("Team member not found");

    if (member.userId === currentUserId) {
      throw new BadRequestException("You cannot change your own status");
    }
    if (member.role === "OWNER") {
      throw new ForbiddenException("You cannot suspend the store owner");
    }

    await this.db.storeMember.update({
      where: { id: memberId },
      data: {
        status: dto.status === "active" ? "ACTIVE" : "SUSPENDED",
      },
    });

    // Suspending a member should also kill their sessions so they can't
    // keep acting on this store. Sessions are platform-wide though, so
    // only revoke if this was their only active store membership.
    if (dto.status === "suspended") {
      const otherActive = await this.db.storeMember.count({
        where: {
          userId: member.userId,
          status: "ACTIVE",
          NOT: { id: memberId },
        },
      });
      if (otherActive === 0) {
        await this.db.adminSession.updateMany({
          where: { userId: member.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    }

    const refreshed = await this.db.storeMember.findUniqueOrThrow({
      where: { id: memberId },
      include: { user: true },
    });

    return serializeTeamMember(
      {
        id: refreshed.id,
        name: refreshed.user.name,
        image: refreshed.user.image,
        email: refreshed.user.email,
        role: refreshed.role,
        status: refreshed.status,
        lastLoginAt: refreshed.user.lastLoginAt,
      },
      { canManage: true },
    );
  }

  // ────────────────────────────────────────────────────────────
  // Remove member from store (does NOT delete the user)
  // ────────────────────────────────────────────────────────────

  async remove(storeId: string, memberId: string, currentUserId: string) {
    const member = await this.db.storeMember.findFirst({
      where: { id: memberId, storeId },
    });
    if (!member) throw new NotFoundException("Team member not found");

    if (member.userId === currentUserId) {
      throw new BadRequestException("You cannot remove yourself");
    }
    if (member.role === "OWNER") {
      throw new ForbiddenException("You cannot remove the store owner");
    }

    await this.db.storeMember.delete({ where: { id: memberId } });

    // If they no longer belong to any store, they're effectively a customer
    const remaining = await this.db.storeMember.count({
      where: { userId: member.userId },
    });
    if (remaining === 0) {
      // Optional: reset their platform role to CUSTOMER
      // await this.db.user.update({
      //   where: { id: member.userId },
      //   data: { role: "CUSTOMER" },
      // });
    }

    return { id: memberId };
  }
}