import { Prisma } from "../../generated/prisma/client.js";

type StoreWithLocation = Prisma.StoreGetPayload<{
  include: { location: true };
}>;

export function serializeStoreProfile(store: StoreWithLocation) {
  return {
    id: store.id,
    slug: store.slug,
    name: store.name,
    legalName: store.legalName ?? null,
    description: store.description ?? null,
    tagline: store.tagline ?? null,
    logo: store.logo ?? null,
    banner: store.banner ?? null,
    email: store.email,
    phone: store.phone,
    whatsapp: store.whatsapp ?? null,
    status: store.status,
    orderPrefix: store.orderPrefix,
    currency: store.currency,
    socialLinks: (store.socialLinks as any) ?? null,
    openingHours: (store.openingHours as any) ?? null,
    location: store.location ? serializeStoreLocation(store.location) : null,
    updatedAt: store.updatedAt.toISOString(),
  };
}

type StoreLocationRow = Prisma.StoreLocationGetPayload<{}>;

export function serializeStoreLocation(loc: StoreLocationRow) {
  return {
    id: loc.id,
    label: loc.label,
    address: loc.address,
    region: loc.region,
    country: loc.country,
    phone: loc.phone ?? null,
    latitude: loc.latitude,
    longitude: loc.longitude,
    timezone: loc.timezone,
  };
}

type StoreBranchRow = Prisma.StoreAddressGetPayload<{}>;

export function serializeStoreBranch(branch: StoreBranchRow) {
  return {
    id: branch.id,
    label: branch.label,
    address: branch.address,
    region: branch.region,
    country: branch.country,
    phone: branch.phone ?? null,
    latitude: branch.latitude,
    longitude: branch.longitude,
    isDefault: branch.isDefault,
  };
}