export type UserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  image: string | null;
  role: string;
  emailVerified: Date | null;
  pendingAccountType: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AddressRow = {
  id: string;
  fullName: string;
  address: string;
  region: string;
  phone: string;
  phone_sec: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeUserProfile(u: UserRow, memberships?: any[]) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone ?? "",
    avatarUrl: u.image ?? null,
    role: u.role,
    pendingAccountType: u.pendingAccountType,
    emailVerified: u.emailVerified?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    memberships: memberships?.map((m) => ({
      storeId: m.store.id,
      storeName: m.store.name,
      storeSlug: m.store.slug,
      role: m.role,
    })) ?? [],
  };
}

export function serializeSign(u: UserRow, sessionId?: string, memberships?: any[]) {
  return { 
    id: u.id,
    name: u.name,
    sid: sessionId ?? null,
    email: u.email,
    role: u.role,
    pendingAccountType: u.pendingAccountType,
    emailVerified: u.emailVerified?.toISOString() ?? null,
    memberships: memberships?.map((m) => ({
      storeId: m.store.id,
      storeName: m.store.name,
      storeSlug: m.store.slug,
      role: m.role,
    })) ?? null,
  };
}


export function serializeAddress(a: AddressRow) {
  return {
    id: a.id,
    fullName: a.fullName,
    address: a.address,
    region: a.region,
    phone: a.phone,
    phone_sec: a.phone_sec ?? undefined,
    isDefault: a.isDefault,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}