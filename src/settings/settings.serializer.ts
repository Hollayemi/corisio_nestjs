import { Role, StoreMemberRole } from "../generated/prisma/client.js";
import {
  NOTIFICATION_GROUPS,
  ROLE_LABELS,
  SOUND_OPTIONS,
} from "./settings.constants.js";

// ─── Profile ────────────────────────────────────────────────

export function serializeProfile(user: {
  id: string;
  name: string;
  email: string;
  image: string | null;
  bio: string | null;
  role: Role;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.image ?? null,
    bio: user.bio ?? null,
    platformRole: user.role.toLowerCase(),
  };
}

// ─── Security ───────────────────────────────────────────────

export function serializeSecurity(user: {
  passwordChangedAt: Date | null;
  twoFactorEnabled: boolean;
}) {
  return {
    passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
    twoFactorEnabled: user.twoFactorEnabled,
  };
}

// ─── Sessions ───────────────────────────────────────────────

export function serializeSession(
  session: {
    id: string;
    device: string;
    createdAt: Date;
    lastActiveAt: Date;
  },
  currentSessionId: string | null,
) {
  return {
    id: session.id,
    device: session.device,
    isCurrent: currentSessionId !== null && session.id === currentSessionId,
    signedInAt: session.createdAt.toISOString(),
    lastActiveAt: session.lastActiveAt.toISOString(),
  };
}

// ─── Login activity ────────────────────────────────────────

export function serializeLoginActivity(row: {
  id: string;
  device: string | null;
  location: string | null;
  ipAddress: string | null;
  outcome: "SUCCESS" | "FAILED" | "LOCKED";
  createdAt: Date;
}) {
  return {
    id: row.id,
    device: row.device ?? "Unknown device",
    location: row.location ?? null,
    ipAddress: row.ipAddress ?? null,
    success: row.outcome === "SUCCESS",
    at: row.createdAt.toISOString(),
  };
}

// ─── Notifications ─────────────────────────────────────────
// src/admin-settings/settings.serializer.ts (partial)
type PrefRow = { key: string; email: boolean; push: boolean };

export function serializeNotificationSettings(
  settings: {
    quietHoursOn: boolean;
    quietStart: string;
    quietEnd: string;
    sound: string;
  } | null,
  platformPrefs: PrefRow[],
  storePrefs: PrefRow[],
  storeId: string | null,
) {
  const platformMap = new Map(platformPrefs.map((p) => [p.key, p]));
  const storeMap = new Map(storePrefs.map((p) => [p.key, p]));

  const groups = NOTIFICATION_GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    description: g.description,
    items: g.items.map((item) => {
      // Precedence: store override > platform default > hardcoded default
      const store = storeId ? storeMap.get(item.key) : undefined;
      const platform = platformMap.get(item.key);
      return {
        key: item.key,
        label: item.label,
        email:
          store?.email ?? platform?.email ?? item.defaults.email,
        push:
          store?.push ?? platform?.push ?? item.defaults.push,
        // Optional — helps the UI show "inherited" state
        inherited: !store && storeId !== null,
      };
    }),
  }));

  return {
    quietHours: {
      enabled: settings?.quietHoursOn ?? false,
      startTime: settings?.quietStart ?? "22:00",
      endTime: settings?.quietEnd ?? "07:00",
    },
    sound: settings?.sound ?? "chime",
    soundOptions: SOUND_OPTIONS,
    groups,
  };
}
// ─── Team ──────────────────────────────────────────────────

export function serializeTeamMember(
  member: {
    id: string;
    name: string;
    image: string | null;
    email: string;
    role: StoreMemberRole;
    lastLoginAt: Date | null;
    status: "ACTIVE" | "INVITED" | "SUSPENDED";
  },
  opts: { canManage: boolean },
) {
  return {
    id: member.id,
    fullName: member.name,
    avatar: member.image ?? null,
    email: member.email,
    role: member.role.toLowerCase(),
    roleLabel: ROLE_LABELS[member.role],
    lastActiveAt: member.lastLoginAt?.toISOString() ?? null,
    status: member.status.toLowerCase() as "active" | "invited" | "suspended",
    canManage: opts.canManage,
  };
}