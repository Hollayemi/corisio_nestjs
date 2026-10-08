import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { CloudinaryService } from "../cloudinary/cloudinary.js";
import { UpdateStoreProfileDto } from "./dto/store-profile.dto.js";
import { UpdateStoreLocationDto } from "./dto/store-profile.dto.js";
import {
  CreateStoreBranchDto,
  UpdateStoreBranchDto,
} from "./dto/store-branch.dto.js";
import {
  serializeStoreBranch,
  serializeStoreLocation,
  serializeStoreProfile,
} from "./serializers/store-profile.serializer.js";
import { Prisma } from "../generated/prisma/client.js";

const EMPTY_TO_NULL = (v: string | undefined) =>
  v === undefined ? undefined : v === "" ? null : v;

@Injectable()
export class StoreProfileService {
  constructor(
    private db: DatabaseService,
    private cloudinary: CloudinaryService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // Authorization
  // ────────────────────────────────────────────────────────────

  /**
   * Verifies the caller manages this store. Owners and Operations Managers
   * can edit everything here. Support and Inventory Managers cannot.
   */
  private async assertCanManageStore(userId: string, storeId: string) {
    const member = await this.db.storeMember.findFirst({
      where: {
        userId,
        storeId,
        status: "ACTIVE",
        role: { in: ["OWNER", "OPERATIONS_MANAGER"] },
      },
    });
    if (!member) {
      throw new ForbiddenException("You cannot manage this store's profile");
    }
    return member;
  }

  // ────────────────────────────────────────────────────────────
  // Profile
  // ────────────────────────────────────────────────────────────

  async getProfile(userId: string, storeId: string) {
    // Any active member can read the profile (SUPPORT, INVENTORY too)
    const member = await this.db.storeMember.findFirst({
      where: { userId, storeId, status: "ACTIVE" },
    });
    if (!member) throw new ForbiddenException("Not a member of this store");

    const store = await this.db.store.findUnique({
      where: { id: storeId },
      include: { location: true },
    });
    if (!store) throw new NotFoundException("Store not found");

    return serializeStoreProfile(store);
  }

  async updateProfile(
    userId: string,
    storeId: string,
    dto: UpdateStoreProfileDto,
  ) {
    await this.assertCanManageStore(userId, storeId);

    const store = await this.db.store.findUnique({ where: { id: storeId } });
    if (!store) throw new NotFoundException("Store not found");

    const updated = await this.db.store.update({
      where: { id: storeId },
      data: {
        name: dto.name ?? undefined,
        legalName: EMPTY_TO_NULL(dto.legalName),
        description: EMPTY_TO_NULL(dto.description),
        tagline: EMPTY_TO_NULL(dto.tagline),
        email: dto.email?.toLowerCase(),
        phone: dto.phone,
        whatsapp: EMPTY_TO_NULL(dto.whatsapp),
        orderPrefix: dto.orderPrefix?.toUpperCase(),
        socialLinks: dto.socialLinks
          ? (dto.socialLinks as Prisma.InputJsonValue)
          : undefined,
        openingHours: dto.openingHours
          ? (dto.openingHours as unknown as Prisma.InputJsonValue)
          : undefined,
      },
      include: { location: true },
    });

    return serializeStoreProfile(updated);
  }

  // ────────────────────────────────────────────────────────────
  // Location
  // ────────────────────────────────────────────────────────────

  async updateLocation(
    userId: string,
    storeId: string,
    dto: UpdateStoreLocationDto,
  ) {
    await this.assertCanManageStore(userId, storeId);

    const store = await this.db.store.findUnique({ where: { id: storeId } });
    if (!store) throw new NotFoundException("Store not found");

    const data = {
      label: dto.label ?? "Main",
      address: dto.address,
      region: dto.region,
      country: dto.country ?? "Nigeria",
      phone: dto.phone ?? null,
      latitude: dto.latitude,
      longitude: dto.longitude,
      timezone: dto.timezone ?? "Africa/Lagos",
    };

    // Upsert: creates on first save, updates thereafter
    const updated = await this.db.storeLocation.upsert({
      where: { storeId },
      update: data,
      create: { storeId, ...data },
    });

    return serializeStoreLocation(updated);
  }

  // ────────────────────────────────────────────────────────────
  // Media (logo / banner)
  // ────────────────────────────────────────────────────────────

  async uploadMedia(
    userId: string,
    storeId: string,
    kind: "logo" | "banner",
    file: Express.Multer.File,
  ) {
    await this.assertCanManageStore(userId, storeId);

    if (!file) throw new BadRequestException("No file provided");
    const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException("Only PNG, JPG or WEBP images are allowed");
    }

    const url = await this.cloudinary.upload(file, `store/${storeId}/${kind}`);

    await this.db.store.update({
      where: { id: storeId },
      data: kind === "logo" ? { logo: url } : { banner: url },
    });

    return { kind, url };
  }

  async removeMedia(
    userId: string,
    storeId: string,
    kind: "logo" | "banner",
  ) {
    await this.assertCanManageStore(userId, storeId);

    await this.db.store.update({
      where: { id: storeId },
      data: kind === "logo" ? { logo: null } : { banner: null },
    });

    return { kind };
  }

  // ────────────────────────────────────────────────────────────
  // Branches (StoreAddress)
  // ────────────────────────────────────────────────────────────

  async listBranches(userId: string, storeId: string) {
    // Any active member can read branches
    const member = await this.db.storeMember.findFirst({
      where: { userId, storeId, status: "ACTIVE" },
    });
    if (!member) throw new ForbiddenException("Not a member of this store");

    const rows = await this.db.storeAddress.findMany({
      where: { storeId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });

    return { items: rows.map(serializeStoreBranch) };
  }

  async createBranch(
    userId: string,
    storeId: string,
    dto: CreateStoreBranchDto,
  ) {
    await this.assertCanManageStore(userId, storeId);

    const makeDefault = dto.isDefault === true;

    const created = await this.db.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.storeAddress.updateMany({
          where: { storeId, isDefault: true },
          data: { isDefault: false },
        });
      }

      // First branch is automatically the default
      const count = await tx.storeAddress.count({ where: { storeId } });
      const finalIsDefault = makeDefault || count === 0;

      return tx.storeAddress.create({
        data: {
          storeId,
          label: dto.label,
          address: dto.address,
          region: dto.region,
          country: dto.country ?? "Nigeria",
          phone: dto.phone ?? null,
          latitude: dto.latitude,
          longitude: dto.longitude,
          isDefault: finalIsDefault,
        },
      });
    });

    return serializeStoreBranch(created);
  }

  async updateBranch(
    userId: string,
    storeId: string,
    branchId: string,
    dto: UpdateStoreBranchDto,
  ) {
    await this.assertCanManageStore(userId, storeId);

    const existing = await this.db.storeAddress.findFirst({
      where: { id: branchId, storeId },
    });
    if (!existing) throw new NotFoundException("Branch not found");

    const updated = await this.db.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.storeAddress.updateMany({
          where: { storeId, isDefault: true, NOT: { id: branchId } },
          data: { isDefault: false },
        });
      }

      return tx.storeAddress.update({
        where: { id: branchId },
        data: {
          label: dto.label ?? undefined,
          address: dto.address ?? undefined,
          region: dto.region ?? undefined,
          country: dto.country ?? undefined,
          phone: dto.phone === undefined ? undefined : dto.phone || null,
          latitude: dto.latitude ?? undefined,
          longitude: dto.longitude ?? undefined,
          isDefault: dto.isDefault ?? undefined,
        },
      });
    });

    return serializeStoreBranch(updated);
  }

  async deleteBranch(
    userId: string,
    storeId: string,
    branchId: string,
  ) {
    await this.assertCanManageStore(userId, storeId);

    const existing = await this.db.storeAddress.findFirst({
      where: { id: branchId, storeId },
    });
    if (!existing) throw new NotFoundException("Branch not found");

    await this.db.storeAddress.delete({ where: { id: branchId } });

    // If we deleted the default, promote the oldest remaining one
    if (existing.isDefault) {
      const next = await this.db.storeAddress.findFirst({
        where: { storeId },
        orderBy: { createdAt: "asc" },
      });
      if (next) {
        await this.db.storeAddress.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }

    return { id: branchId };
  }
}