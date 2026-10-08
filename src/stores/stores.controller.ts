import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { CurrentUser } from "../common/decorator/current-user.decorator.js";
import type { AuthUser } from "../auth/auth.types.js";
import {
  UpdateStoreLocationDto,
  UpdateStoreProfileDto,
} from "./dto/store-profile.dto.js";
import {
  CreateStoreBranchDto,
  UpdateStoreBranchDto,
} from "./dto/store-branch.dto.js";
import { StoreProfileService } from "./stores.service.js";

@UseGuards(JwtAuthGuard)
@Controller("stores/:storeId")
export class StoreProfileController {
  constructor(private stores: StoreProfileService) { }

  // ─── Profile ─────────────────────────────────────────────

  @Get("profile")
  async getProfile(
    @CurrentUser() u: AuthUser,
    @Param("storeId") storeId: string,
  ) {
    return {
      message: "OK",
      data: await this.stores.getProfile(u.id, storeId),
    };
  }

  @Patch("profile")
  async updateProfile(
    @CurrentUser() u: AuthUser,
    @Param("storeId") storeId: string,
    @Body() dto: UpdateStoreProfileDto,
  ) {
    return {
      message: "Store profile updated",
      data: await this.stores.updateProfile(u.id, storeId, dto),
    };
  }

  // ─── Location ────────────────────────────────────────────

  @Put("location")
  async updateLocation(
    @CurrentUser() u: AuthUser,
    @Param("storeId") storeId: string,
    @Body() dto: UpdateStoreLocationDto,
  ) {
    return {
      message: "Location updated",
      data: await this.stores.updateLocation(u.id, storeId, dto),
    };
  }

  // ─── Media ───────────────────────────────────────────────

  @Post("media/:kind")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadMedia(
    @CurrentUser() u: AuthUser,
    @Param("storeId") storeId: string,
    @Param("kind") kind: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (kind !== "logo" && kind !== "banner") {
      throw new BadRequestException("kind must be 'logo' or 'banner'");
    }
    if (!file) throw new BadRequestException("No file provided");

    return {
      message: "Media uploaded",
      data: await this.stores.uploadMedia(u.id, storeId, kind, file),
    };
  }

  @Delete("media/:kind")
  async removeMedia(
    @CurrentUser() u: AuthUser,
    @Param("storeId") storeId: string,
    @Param("kind") kind: string,
  ) {
    if (kind !== "logo" && kind !== "banner") {
      throw new BadRequestException("kind must be 'logo' or 'banner'");
    }
    return {
      message: "Media removed",
      data: await this.stores.removeMedia(u.id, storeId, kind),
    };
  }

  // ─── Branches ────────────────────────────────────────────

  @Get("branches")
  async listBranches(
    @CurrentUser() u: AuthUser,
    @Param("storeId") storeId: string,
  ) {
    return {
      message: "OK",
      data: await this.stores.listBranches(u.id, storeId),
    };
  }

  @Post("branches")
  async createBranch(
    @CurrentUser() u: AuthUser,
    @Param("storeId") storeId: string,
    @Body() dto: CreateStoreBranchDto,
  ) {
    return {
      message: "Branch created",
      data: await this.stores.createBranch(u.id, storeId, dto),
    };
  }

  @Patch("branches/:id")
  async updateBranch(
    @CurrentUser() u: AuthUser,
    @Param("storeId") storeId: string,
    @Param("id") id: string,
    @Body() dto: UpdateStoreBranchDto,
  ) {
    return {
      message: "Branch updated",
      data: await this.stores.updateBranch(u.id, storeId, id, dto),
    };
  }

  @Delete("branches/:id")
  async deleteBranch(
    @CurrentUser() u: AuthUser,
    @Param("storeId") storeId: string,
    @Param("id") id: string,
  ) {
    return {
      message: "Branch deleted",
      data: await this.stores.deleteBranch(u.id, storeId, id),
    };
  }
}