// src/admin-settings/settings.module.ts
import { Module } from "@nestjs/common";
import {
  AdminSettingsController,
  StoreSettingsController,
} from "./settings.controller.js";

import { CloudinaryService } from "../cloudinary/cloudinary.js";
import { DatabaseService } from "../database/database.service.js";

import { AdminNotificationsService } from "./notifications.service.js";
import { SecurityService } from "./security.service.js";
import { ProfileService } from "./profile.service.js";
import { TeamService } from "./team.service.js";

import { StoreContextGuard } from "../auth/guards/store-context.guard.js";
import { StoreMemberGuard } from "../auth/guards/store-member.guard.js";

@Module({
  controllers: [AdminSettingsController, StoreSettingsController],
  providers: [
    TeamService,
    ProfileService,
    SecurityService,
    AdminNotificationsService,
    DatabaseService,
    CloudinaryService,
    StoreContextGuard,
    StoreMemberGuard,
  ],
})
export class SettingsModule {}