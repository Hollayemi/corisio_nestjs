// src/auth/auth.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { OAuth2Client } from "google-auth-library";
import { randomBytes, createHash } from "crypto";

import { DatabaseService } from "../database/database.service.js";
import {
  RegisterDto,
  LoginDto,
  CreateStoreDto,
  AcceptInviteDto,
} from "./dto/register.dto.js";
import {
  Role,
  SignupAccountType,
  StoreMemberRole,
  StoreStatus,
} from "../generated/prisma/enums.js";
import { detectDevice } from "../common/utils/device.util.js";
import { NotificationsService } from "../notification/notifications.service.js";
import { serializeSign, serializeUserProfile, UserRow } from "../users/users.serializer.js";

const googleClient = new OAuth2Client(process.env.AUTH_GOOGLE_ID);

@Injectable()
export class AuthService {
  constructor(
    private db: DatabaseService,
    private jwt: JwtService,
    private notifications: NotificationsService,
  ) { }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  /**
   * JWT carries identity + session id only.
   * Authorization is resolved per-request from the DB.
   */

  private sign(u: UserRow, sessionId?: string, memberships?: any[]) {
    const payload = {
      id: u.id,
      sid: sessionId ?? null,
      role: u.role,
      defaultSlug: memberships?.[0]?.slug ?? null,
      memberships: memberships?.reduce((acc, m) => {
        acc[m.store.slug] = {
          storeId: m.store.id,
          storeName: m.store.name,
          storeSlug: m.store.slug,
          role: m.role,
        };
        return acc;
      }, {} as Record<string, any>) ?? {},
    };

    console.log("Signing JWT payload:", payload);
    return this.jwt.sign(payload);
  }

  private sanitize(user: any) {
    console.log("Sanitizing user:", user);
    if (!user) return user;
    const { passwordHash, twoFactorSecret, ...safe } = user;
    return safe;
  }

  private async createSession(
    user: { id: string },
    userAgent: string | undefined,
    ip: string | undefined,
  ) {
    const raw = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(raw).digest("hex");

    const session = await this.db.adminSession.create({
      data: {
        userId: user.id,
        tokenHash,
        device: detectDevice(userAgent) ?? "Unknown device",
        userAgent,
        ipAddress: ip,
      },
    });


    return { sessionId: session.id, rawToken: raw, tokenHash };
  }

  /**
   * Single source of truth for "where does this user go after auth?"
   * Keeps the frontend dumb — it just reads `next`.
   *
   * @param storeCount number of active store memberships (0 if not known)
   */
  private nextRouteAfterAuth(
    user: {
      role: Role;
      pendingAccountType?: SignupAccountType | null;
    },
    storeCount = 0,
  ): string {
    if (user.role === Role.SUPER_ADMIN || user.role === Role.SUPPORT) {
      return "/admin";
    }
    if (user.pendingAccountType === SignupAccountType.STORE_OWNER) {
      return "/store/setup";
    }
    if (storeCount > 0) {
      return "/admin";
    }
    return "/";
  }

  // ─────────────────────────────────────────────
  // REGISTER
  // ─────────────────────────────────────────────

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();

    const existing = await this.db.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException("Email already in use");

    const passwordHash = await bcrypt.hash(dto.password, 12);

    /**
     * Everyone starts as a CUSTOMER on the platform.
     * `pendingAccountType` records the signup intent so the frontend
     * knows where to route after auth (store setup vs. storefront).
     *
     * Actual store-owner privileges are granted by `createStore()`.
     */
    const user = await this.db.user.create({
      data: {
        name: dto.name,
        email,
        phone: dto.phone,
        passwordHash,
        role: Role.CUSTOMER,
        pendingAccountType: dto.accountType,
      },
    });

    // Email verification token
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    await this.db.passwordResetToken.create({
      data: { userId: user.id, token, expiresAt },
    });

    await this.notifications.notifyTemplate("AUTH_WELCOME", {
      userId: user.id,
      context: { firstName: user.name.split(" ")[0] },
    });

    await this.notifications.notifyTemplate("AUTH_EMAIL_VERIFICATION", {
      userId: user.id,
      context: {
        firstName: user.name.split(" ")[0],
        verifyUrl: `${process.env.API_URL}/auth/verify-email?token=${token}`,
      },
    });

    const { sessionId } = await this.createSession(user, undefined, undefined);

    return {
      message: "Account created",
      data: {
        user: this.sanitize(user),
        accessToken: this.sign(user, sessionId),
        next: this.nextRouteAfterAuth(user),
      },
    };
  }

  // ─────────────────────────────────────────────
  // LOGIN
  // ─────────────────────────────────────────────

  async login(
    dto: LoginDto,
    userAgent: string | undefined,
    ip: string | undefined,
  ) {
    const email = dto.email.toLowerCase();
    const device = detectDevice(userAgent);

    const user = await this.db.user.findUnique({ where: { email } });

    // ── Invalid credentials (user missing or no password set)
    if (!user || !user.passwordHash) {
      await this.db.loginActivity.create({
        data: {
          userId: user?.id ?? null,
          email,
          outcome: "FAILED",
          device,
          ipAddress: ip,
          reason: "Invalid credentials",
        },
      });
      throw new UnauthorizedException("Invalid credentials");
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.db.loginActivity.create({
        data: {
          userId: user.id,
          email,
          outcome: "FAILED",
          device,
          ipAddress: ip,
          reason: "Invalid credentials",
        },
      });
      throw new UnauthorizedException("Invalid credentials");
    }

    if (!user.isActive) {
      await this.db.loginActivity.create({
        data: {
          userId: user.id,
          email,
          outcome: "FAILED",
          device,
          ipAddress: ip,
          reason: "Account disabled",
        },
      });
      throw new ForbiddenException("Account disabled");
    }

    // ── Success
    await this.db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.db.loginActivity.create({
      data: {
        userId: user.id,
        email,
        outcome: "SUCCESS",
        device,
        ipAddress: ip,
        reason: "Logged in successfully",
      },
    });

    const { sessionId } = await this.createSession(user, userAgent, ip);

    // Resolve store memberships so the frontend knows what dashboards exist
    const memberships = await this.db.storeMember.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      include: {
        store: {
          select: { id: true, slug: true, name: true, logo: true, status: true },
        },
      },
    });

    await this.notifications.notifyTemplate("AUTH_NEW_DEVICE_LOGIN", {
      userId: user.id,
      context: {
        firstName: user.name.split(" ")[0],
        device: device ?? "Unknown device",
        ip: ip ?? "Unknown",
      },
    });

    return {
      message: "Logged in",
      data: {
        user: serializeUserProfile(user),
        accessToken: this.sign(user, sessionId, memberships),
        memberships: memberships.map((m) => ({
          storeId: m.store.id,
          storeSlug: m.store.slug,
          storeName: m.store.name,
          storeLogo: m.store.logo,
          storeStatus: m.store.status,
          role: m.role,
        })),
        next: this.nextRouteAfterAuth(user, memberships.length),
      },
    };
  }

  // ─────────────────────────────────────────────
  // GOOGLE
  // ─────────────────────────────────────────────

  async loginWithGoogle(
    idToken: string,
    userAgent: string | undefined,
    ip: string | undefined,
  ) {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.AUTH_GOOGLE_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.sub)
      throw new UnauthorizedException("Invalid Google token");

    const email = payload.email.toLowerCase();

    let user = await this.db.user.findUnique({ where: { email } });

    if (!user) {
      user = await this.db.user.create({
        data: {
          name: payload.name ?? email.split("@")[0],
          email,
          image: payload.picture,
          emailVerified: new Date(),
          role: Role.CUSTOMER,
          // pendingAccountType stays null — Google sign-in has no type step.
          oauthAccounts: {
            create: {
              provider: "google",
              providerAccountId: payload.sub,
            },
          },
        },
      });
    } else {
      await this.db.oAuthAccount.upsert({
        where: {
          provider_providerAccountId: {
            provider: "google",
            providerAccountId: payload.sub,
          },
        },
        update: {},
        create: {
          userId: user.id,
          provider: "google",
          providerAccountId: payload.sub,
        },
      });
    }

    if (!user.isActive) throw new ForbiddenException("Account disabled");

    await this.db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.db.loginActivity.create({
      data: {
        userId: user.id,
        email,
        outcome: "SUCCESS",
        device: detectDevice(userAgent),
        ipAddress: ip,
        reason: "Logged in with Google",
      },
    });

    const { sessionId } = await this.createSession(user, userAgent, ip);

    const memberships = await this.db.storeMember.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      include: {
        store: {
          select: { id: true, slug: true, name: true, logo: true, status: true },
        },
      },
    });

    return {
      message: "Logged in with Google",
      data: {
        user: this.sanitize(user),
        accessToken: this.sign(user, sessionId, memberships),
        memberships: memberships.map((m) => ({
          storeId: m.store.id,
          storeSlug: m.store.slug,
          storeName: m.store.name,
          storeLogo: m.store.logo,
          storeStatus: m.store.status,
          role: m.role,
        })),
        next: this.nextRouteAfterAuth(user, memberships.length),
      },
    };
  }

  // ─────────────────────────────────────────────
  // STORE SETUP (runs after registration)
  // ─────────────────────────────────────────────

  async createStore(
    userId: string,
    sid: string,
    dto: CreateStoreDto,
    userAgent: string | undefined,
    ip: string | undefined,
  ) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    // A user can only own one store for now — relax later if needed.
    const existing = await this.db.storeMember.findFirst({
      where: {
        userId,
        role: StoreMemberRole.OWNER,
        store: { status: { not: StoreStatus.CLOSED } },
      },
    });
    if (existing) {
      throw new ConflictException("You already own a store");
    }

    const slug = await this.uniqueStoreSlug(dto.name);

    const [store, membership] = await this.db.$transaction(async (tx) => {
      const store = await tx.store.create({
        data: {
          slug,
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          status: StoreStatus.PENDING,
          location: {
            create: {
              label: "Main",
              address: dto.address,
              region: dto.region,
              latitude: dto.latitude,
              longitude: dto.longitude,
              phone: dto.phone,
            },
          },
          settings: { create: {} },
        },
      });

      const membership = await tx.storeMember.create({
        data: {
          storeId: store.id,
          userId,
          role: StoreMemberRole.OWNER,
          status: "ACTIVE",
          acceptedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          storeId: store.id,
          actorId: userId,
          action: "store.create",
          entityType: "Store",
          entityId: store.id,
          after: { name: store.name, slug: store.slug },
          ip,
          userAgent,
        },
      });

      // Clear the signup intent and promote platform role so
      // store-dashboard guards can recognise this user.
      await tx.user.update({
        where: { id: userId },
        data: {
          pendingAccountType: null,
          role: user.role === Role.CUSTOMER ? Role.HAS_STORE : user.role,
        },
      });

      return [store, membership ];
    });

    // Optional: notify the user their store is under review
    // await this.notifications.notifyTemplate("STORE_CREATED_PENDING_REVIEW", {
    //   userId,
    //   context: { storeName: result.name, firstName: user.name.split(" ")[0] },
    // });

    return {
      message: "Store submitted for review",
      data: {
        accessToken: this.sign(user, sid, [membership]),
        store: {
          id: store.id,
          slug: store.slug,
          name: store.name,
          status: store.status,
        },
      },
    };
  }

  private async uniqueStoreSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "store";

    let slug = base;
    let i = 1;
    while (await this.db.store.findUnique({ where: { slug } })) {
      slug = `${base}-${i++}`;
    }
    return slug;
  }

  // ─────────────────────────────────────────────
  // ACCEPT INVITATION
  // ─────────────────────────────────────────────

  async acceptInvite(
    token: string,
    dto: AcceptInviteDto,
    userAgent: string | undefined,
    ip: string | undefined,
  ) {
    // 1. Load + validate invitation
    const invite = await this.db.adminInvitation.findUnique({
      where: { token },
      include: { store: true },
    });

    if (!invite) throw new NotFoundException("Invitation not found");
    if (invite.acceptedAt) throw new ConflictException("Invitation already used");
    if (invite.revokedAt) throw new ConflictException("Invitation revoked");
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException("Invitation expired");
    }

    const isStoreInvite = invite.storeId !== null;
    if (isStoreInvite && !invite.storeRole) {
      throw new BadRequestException("Malformed store invitation");
    }
    if (!isStoreInvite && !invite.platformRole) {
      throw new BadRequestException("Malformed platform invitation");
    }
    if (isStoreInvite && invite.store?.status === StoreStatus.CLOSED) {
      throw new BadRequestException("Store is no longer active");
    }

    const email = invite.email.toLowerCase();

    let user = await this.db.user.findUnique({ where: { email } });
    let isNewUser = false;

    if (!user) {
      if (!dto.password || dto.password.length < 8) {
        throw new BadRequestException(
          "Password is required to create an account",
        );
      }
      const passwordHash = await bcrypt.hash(dto.password, 12);
      user = await this.db.user.create({
        data: {
          name: dto.name ?? email.split("@")[0],
          email,
          phone: dto.phone,
          passwordHash,
          emailVerified: new Date(),
          role: Role.CUSTOMER,
        },
      });
      isNewUser = true;
    }

    if (!user.isActive) {
      throw new ForbiddenException("Account disabled");
    }

    // 4. Apply the invitation
    const userId = user.id;
    const memberships = await this.db.$transaction(async (tx) => {
      if (isStoreInvite) {
        await tx.storeMember.upsert({
          where: {
            storeId_userId: {
              storeId: invite.storeId!,
              userId,
            },
          },
          update: {
            role: invite.storeRole!,
            status: "ACTIVE",
            acceptedAt: new Date(),
          },
          create: {
            storeId: invite.storeId!,
            userId,
            role: invite.storeRole!,
            status: "ACTIVE",
            acceptedAt: new Date(),
          },
        });

        // Promote platform role if they're still a plain customer
        await tx.user.updateMany({
          where: { id: userId, role: Role.CUSTOMER },
          data: { role: Role.HAS_STORE },
        });
      } else {
        // Platform-level invitation (super admin / support)
        await tx.user.update({
          where: { id: userId },
          data: { role: invite.platformRole! },
        });
      }

      await tx.adminInvitation.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });

      if (isStoreInvite) {
        return tx.storeMember.findMany({
          where: { userId, status: "ACTIVE" },
        });
      }

      return [];
    });

    // 5. If this was a new user, issue a session so they're logged in
    if (isNewUser) {
      const { sessionId } = await this.createSession(user, userAgent, ip);

      await this.db.loginActivity.create({
        data: {
          userId: user.id,
          email,
          outcome: "SUCCESS",
          device: detectDevice(userAgent),
          ipAddress: ip,
          reason: "Accepted invitation",
        },
      });

      // Re-read so the returned user reflects the role upgrade
      const refreshed = await this.db.user.findUniqueOrThrow({
        where: { id: user.id },
      });



      return {
        message: "Invitation accepted",
        data: {
          user: this.sanitize(refreshed),
          accessToken: serializeSign(refreshed, sessionId, memberships),
          next: "/dashboard",
        },
      };
    }

    // Existing user — they still need to log in normally
    return {
      message: "Invitation accepted. Please log in.",
      data: {
        storeId: invite.storeId ?? null,
        role: invite.storeRole ?? invite.platformRole,
      },
    };
  }

  // ─────────────────────────────────────────────
  // PASSWORD RESET / VERIFY
  // ─────────────────────────────────────────────

  async forgotPassword(email: string) {
    const user = await this.db.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) return { message: "If that email exists, a reset link was sent" };

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60);

    await this.db.passwordResetToken.create({
      data: { userId: user.id, token, expiresAt },
    });

    await this.notifications.notifyTemplate("AUTH_PASSWORD_RESET", {
      userId: user.id,
      context: {
        firstName: user.name.split(" ")[0],
        resetUrl: `${process.env.FRONTEND_URL}/reset-password?token=${token}`,
      },
    });

    return { message: "If that email exists, a reset link was sent" };
  }

  async verifyEmail(token: string) {
    const record = await this.db.passwordResetToken.findUnique({
      where: { token },
    });
    if (!record || record.usedAt || record.expiresAt < new Date())
      throw new NotFoundException("Invalid or expired token");

    await this.db.$transaction([
      this.db.user.update({
        where: { id: record.userId },
        data: { emailVerified: new Date(), isActive: true },
      }),
      this.db.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return true;
  }

  async resetPassword(token: string, password: string) {
    const record = await this.db.passwordResetToken.findUnique({
      where: { token },
    });
    if (!record || record.usedAt || record.expiresAt < new Date())
      throw new NotFoundException("Invalid or expired token");

    const passwordHash = await bcrypt.hash(password, 12);

    await this.db.$transaction([
      this.db.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.db.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { message: "Password updated" };
  }

  // ─────────────────────────────────────────────
  // ME / VALIDATE
  // ─────────────────────────────────────────────

  async me(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: {
        storeMemberships: {
          where: { status: "ACTIVE" },
          include: {
            store: {
              select: {
                id: true,
                slug: true,
                name: true,
                logo: true,
                status: true,
              },
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException("User not found");

    console.log("User memberships:", user);

    return {
      message: "OK",
      data: {
        ...this.sanitize(user),
        memberships: user.storeMemberships.map((m) => ({
          storeId: m.store.id,
          storeSlug: m.store.slug,
          storeName: m.store.name,
          storeLogo: m.store.logo,
          storeStatus: m.store.status,
          role: m.role,
        })),
      },
    };
  }

  /**
   * Called by the JWT strategy on every authenticated request.
   * Verifies the user is active and the session (if any) hasn't
   * been revoked. Returns the user + `sid` so `logout` and guards
   * can use it.
   *
   * NOTE: memberships are NOT loaded here — that's the job of
   * StoreContextGuard / StoreMemberGuard, which resolve the
   * single store a request is operating on.
   */
  async validate(payload: { id: string; sid?: string | null, memberships?: { [key: string]: unknown } }) {
    const user = await this.db.user.findUnique({
      where: { id: payload.id },
    });

    if (!user || !user.isActive) throw new UnauthorizedException();

    if (payload.sid) {
      const session = await this.db.adminSession.findUnique({
        where: { id: payload.sid },
      });
      if (!session || session.revokedAt) {
        throw new UnauthorizedException("Session revoked");
      }
      await this.db.adminSession.update({
        where: { id: session.id },
        data: { lastActiveAt: new Date() },
      });
    }

    return { ...user, memberships: payload.memberships ?? {}, sid: payload.sid ?? null };
  }

  async logout(userId: string, sid: string | null) {
    if (sid) {
      await this.db.adminSession.updateMany({
        where: { id: sid, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else {
      // Revoke all sessions for the user
      await this.db.adminSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { message: "Logged out" };
  }
}