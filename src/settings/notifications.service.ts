// src/admin-settings/notifications.service.ts
import { Injectable } from "@nestjs/common";
import { UpdateNotificationSettingsDto } from "./dto/update-notification-settings.dto.js";
import { serializeNotificationSettings } from "./settings.serializer.js";
import { DatabaseService } from "../database/database.service.js";

@Injectable()
export class AdminNotificationsService {
  constructor(private db: DatabaseService) {}

  /**
   * @param storeId null = platform-wide settings page
   *                string = settings for a specific store
   */
  async get(userId: string, storeId: string | null = null) {
    const [settings, prefs, storePrefs] = await Promise.all([
      this.db.adminNotificationSettings.findUnique({ where: { userId } }),
      this.db.notificationPreference.findMany({
        where: { userId, storeId: null },
      }),
      storeId
        ? this.db.notificationPreference.findMany({
            where: { userId, storeId },
          })
        : Promise.resolve([]),
    ]);

    return serializeNotificationSettings(settings, prefs, storePrefs, storeId);
  }

  async update(
    userId: string,
    dto: UpdateNotificationSettingsDto,
    storeId: string | null = null,
  ) {
    await this.db.$transaction(async (tx) => {
      // Quiet hours / sound are always user-level (no storeId)
      if (dto.quietHours !== undefined || dto.sound !== undefined) {
        await tx.adminNotificationSettings.upsert({
          where: { userId },
          update: {
            quietHoursOn: dto.quietHours?.enabled,
            quietStart: dto.quietHours?.startTime,
            quietEnd: dto.quietHours?.endTime,
            sound: dto.sound,
          },
          create: {
            userId,
            quietHoursOn: dto.quietHours?.enabled ?? false,
            quietStart: dto.quietHours?.startTime ?? "22:00",
            quietEnd: dto.quietHours?.endTime ?? "07:00",
            sound: dto.sound ?? "chime",
          },
        });
      }

      // Per-event preferences — either platform-wide (storeId null)
      // or scoped to the current store.
      if (dto.preferences?.length) {
        for (const pref of dto.preferences) {
          const preferenceWhere = {
            userId,
            ...(storeId === null ? { storeId: null } : { storeId }),
            key: pref.key,
          } as any;

          await tx.notificationPreference.upsert({
            where: {
              userId_storeId_key: preferenceWhere,
            },
            update: {
              email: pref.email,
              push: pref.push,
            },
            create: {
              userId,
              storeId,
              key: pref.key,
              email: pref.email ?? true,
              push: pref.push ?? true,
            },
          });
        }
      }
    });

    return this.get(userId, storeId);
  }
}