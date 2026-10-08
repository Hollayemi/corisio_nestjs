import { DatabaseService } from "../../database/database.service.js";


// src/common/utils/code.util.ts
export async function nextCode(
  db: DatabaseService,
  name: string,
  prefix: string,
  pad: number,
  storeId?: string,
): Promise<string> {
  // For per-store counters, include storeId in the counter key
  // If storeId is undefined, this is a platform-level counter
  const where = storeId
    ? { storeId_name: { storeId, name } }
    : { storeId_name: { storeId: null as any, name } }; // falls back to null-keyed

  // Counter model has @@unique([storeId, name])
  const counter = await db.counter.upsert({
    where: where as any,
    create: { storeId: storeId ?? null, name, value: 1 },
    update: { value: { increment: 1 } },
  });

  return `${prefix}-${String(counter.value).padStart(pad, "0")}`;
}


import { randomBytes } from "crypto";
import { PrismaClient } from "../../generated/prisma/client.js";

export function generateCouponCode(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6)
    .padEnd(4, "X");
  const rand = randomBytes(3).toString("hex").toUpperCase();
  return `${slug}${rand}`;
}


/**
 * Generates the next order number: "LX-10482".
 * Uses the same Counter table as products — atomic, race-free.
 */
export async function nextOrderNumber(
  db: DatabaseService,
  storeId: string,
  prefix = "ORD",
): Promise<string> {
  // Atomic increment on the per-store counter row
  const counter = await db.counter.upsert({
    where: { storeId_name: { storeId, name: "order_number" } },
    create: { storeId, name: "order_number", value: 1 },
    update: { value: { increment: 1 } },
  });

  const padded = String(counter.value).padStart(5, "0");
  return `${prefix}-${padded}`;
}