// src/orders/orders.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PlaceOrderDto } from "./dto/place-order.dto.js";
import { ListOrdersDto } from "./dto/list-orders.dto.js";
import { CancelOrderDto } from "./dto/cancel-order.dto.js";
import { RateOrderDto } from "./dto/rate-order.dto.js";
import { RequestReturnDto } from "./dto/request-return.dto.js";
import {
  readTimeline,
  serializeOrderDetail,
  serializeOrderSummary,
  serializeOrderTracking,
  toFrontendStatus,
} from "./orders.serializer.js";
import { DatabaseService } from "../database/database.service.js";
import { PaystackService } from "../payments/paystack.service.js";
import { Prisma, PromotionStatus } from "../generated/prisma/client.js";
import { nextOrderNumber } from "../common/utils/code.util.js";
import { buildTimeline, canRate, closeTimeline, markRated } from "./order-timeline.js";

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private db: DatabaseService,
    private paystack: PaystackService,
    private config: ConfigService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // PLACE ORDER (customer) — always scoped to one store
  // ────────────────────────────────────────────────────────────

  async placeOrder(userId: string, dto: PlaceOrderDto) {
    if (!dto.items.length) {
      throw new BadRequestException("Cart is empty");
    }

    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    // ── 1. Resolve the store from slug ──
    const store = await this.db.store.findUnique({
      where: { id: dto.storeId },
    });
    console.log("Resolved store:", store);
    if (!store || store.status !== "ACTIVE") {
      throw new NotFoundException("Store not found or inactive");
    }
    const storeId = store.id;

    // ── 2. Address (delivery only) ──
    const isDelivery = dto.deliveryMethod === "DELIVERY";
    let addressRow: Awaited<ReturnType<typeof this.db.address.findFirst>> = null;
    let deliveryAddressText = "";

    if (isDelivery) {
      if (!dto.addressId) {
        throw new BadRequestException("addressId is required for delivery orders");
      }
      addressRow = await this.db.address.findFirst({
        where: { id: dto.addressId, userId },
      });
      if (!addressRow) throw new NotFoundException("Address not found");
      deliveryAddressText = `${addressRow.fullName}, ${addressRow.address}, ${addressRow.region}`;
    }

    // ── 3. Load products — must belong to THIS store ──
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.db.product.findMany({
      where: {
        id: { in: productIds },
        storeId,                       // ← tenant filter
      },
      include: { variants: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const lineItems: {
      productId: string;
      variantId: string | null;
      productName: string;
      variantLabel: string | null;
      image: string | null;
      unitLabel: string | null;
      unitPrice: Prisma.Decimal;
      quantity: number;
      lineTotal: Prisma.Decimal;
      categoryId: string;
    }[] = [];

    let subtotal = 0;

    for (const line of dto.items) {
      const product = byId.get(line.productId);
      if (!product || product.status !== "ACTIVE") {
        throw new BadRequestException(
          `Product "${line.productId}" is not available in this store`,
        );
      }

      let unitPrice = Number(product.unitPrice);
      let variantId: string | null = null;
      let variantLabel: string | null = null;
      let stock = product.stock;

      if (product.variantOption === "PARENT" && line.variant) {
        const variant =
          product.variants.find((v) => v.id === line.variant) ??
          product.variants.find((v) => v.label === line.variant);
        if (!variant) {
          throw new BadRequestException(
            `Variant "${line.variant}" not found for ${product.name}`,
          );
        }
        variantId = variant.id;
        variantLabel = variant.label;
        unitPrice = Number(variant.unitPrice);
        stock = variant.stock;
      }

      if (stock < line.quantity) {
        throw new BadRequestException(
          `Insufficient stock for ${product.name} (available: ${stock})`,
        );
      }

      const lineTotal = unitPrice * line.quantity;
      subtotal += lineTotal;

      lineItems.push({
        productId: product.id,
        variantId,
        productName: product.name,
        variantLabel,
        image: product.images?.[0] ?? null,
        unitLabel: product.unitType,
        unitPrice: new Prisma.Decimal(unitPrice),
        quantity: line.quantity,
        lineTotal: new Prisma.Decimal(lineTotal),
        categoryId: product.categoryId,
      });
    }

    // ── 4. Promo — must belong to THIS store ──
    let promo: any = null;
    let discount = 0;
    let deliveryWaived = false;

    if (dto.promoCode) {
      const now = new Date();
      promo = await this.db.promotion.findFirst({
        where: {
          storeId,                                     // ← tenant filter
          code: dto.promoCode.toUpperCase(),
          status: PromotionStatus.ACTIVE,
          startAt: { lte: now },
          OR: [{ endAt: null }, { endAt: { gte: now } }],
        },
      });

      if (!promo) throw new BadRequestException("Invalid or expired promo code");
      if (promo.usageLimit != null && (promo.usedCount ?? 0) >= promo.usageLimit) {
        throw new BadRequestException("Promo code usage limit reached");
      }
      if (
        promo.minimumOrderAmount != null &&
        subtotal < Number(promo.minimumOrderAmount)
      ) {
        throw new BadRequestException(
          `Minimum order of ₦${Number(promo.minimumOrderAmount).toLocaleString()} required for this promo`,
        );
      }

      let eligibleSubtotal = 0;
      if (promo.appliesTo === "ALL_ORDERS") {
        eligibleSubtotal = subtotal;
      } else if (promo.appliesTo === "CATEGORY") {
        eligibleSubtotal = lineItems
          .filter((li) => li.categoryId === promo.categoryId)
          .reduce((sum, li) => sum + Number(li.lineTotal), 0);
        if (eligibleSubtotal === 0) {
          throw new BadRequestException(
            "This promo does not apply to any items in your cart",
          );
        }
      } else if (promo.appliesTo === "SPECIFIC_PRODUCTS") {
        const allowed = new Set<string>(promo.productIds);
        eligibleSubtotal = lineItems
          .filter((li) => allowed.has(li.productId))
          .reduce((sum, li) => sum + Number(li.lineTotal), 0);
        if (eligibleSubtotal === 0) {
          throw new BadRequestException(
            "This promo does not apply to any items in your cart",
          );
        }
      }

      if (promo.discountType === "PERCENTAGE") {
        discount = (eligibleSubtotal * Number(promo.discountValue)) / 100;
        if (promo.maximumDiscount != null) {
          discount = Math.min(discount, Number(promo.maximumDiscount));
        }
      } else if (promo.discountType === "FIXED_AMOUNT") {
        discount = Math.min(Number(promo.discountValue), eligibleSubtotal);
      } else if (promo.discountType === "FREE_DELIVERY") {
        if (!isDelivery) {
          throw new BadRequestException(
            "This promo is for delivery orders only",
          );
        }
        deliveryWaived = true;
        discount = 0;
      }
    }

    // ── 5. Delivery zone (optional) ──
    // Instead of a flat fee, look up the store's zones and pick a match.
    // For now we still accept the store's configured flat fee as a fallback.
    const FLAT_DELIVERY = Number(this.config.get("DELIVERY_FEE") ?? 2500);
    let deliveryFee = isDelivery ? FLAT_DELIVERY : 0;
    if (deliveryWaived) deliveryFee = 0;

    // ── 6. Totals ──
    const roundedDiscount = Math.round(discount * 100) / 100;
    const total = Math.max(0, subtotal - roundedDiscount + deliveryFee);

    // ── 7. Per-store order number ──
    const orderNumber = await nextOrderNumber(
      this.db,
      storeId,
      store.orderPrefix ?? "ORD",
    );

    // ── 8. Transaction ──
    const order = await this.db.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          storeId,                                     // ← tenant FK
          orderNumber,
          userId,
          addressId: addressRow?.id ?? null,
          promoCodeId: promo?.id ?? null,
          subtotal: new Prisma.Decimal(subtotal),
          discount: new Prisma.Decimal(roundedDiscount),
          deliveryFee: new Prisma.Decimal(deliveryFee),
          total: new Prisma.Decimal(total),
          status: "PENDING",
          type: "SHOP",
          deliveryType: isDelivery ? "DELIVERY" : "PICKUP",
          receiverName: addressRow?.fullName ?? user.name,
          receiverPhone: String(dto.phone),
          contactEmail: user.email,
          deliveryAddress: deliveryAddressText || null,
          timeline: buildTimeline() as unknown as Prisma.InputJsonValue,
          items: { create: lineItems.map(({ categoryId, ...rest }) => rest) },
        },
        include: {
          items: true,
          rating: true,
          returnRequests: { orderBy: { requestedAt: "desc" }, take: 1 },
        },
      });

      for (const line of lineItems) {
        if (line.variantId) {
          await tx.productVariant.update({
            where: { id: line.variantId },
            data: { stock: { decrement: line.quantity } },
          });
        } else {
          await tx.product.update({
            where: { id: line.productId },
            data: { stock: { decrement: line.quantity } },
          });
        }
        await tx.stockMovement.create({
          data: {
            storeId,                                   // ← tenant FK
            productId: line.productId,
            delta: -line.quantity,
            reason: "order",
            reference: created.id,
          },
        });
      }

      if (promo && (roundedDiscount > 0 || deliveryWaived)) {
        await tx.promotion.update({
          where: { id: promo.id },
          data: {
            usedCount: { increment: 1 },
            totalDiscountGiven: { increment: new Prisma.Decimal(roundedDiscount) },
            totalOrdersAffected: { increment: 1 },
            totalSalesMade: { increment: new Prisma.Decimal(total) },
          },
        });
      }

      // ── Clear ONLY this store's cart for the user ──
      const cart = await tx.cart.findUnique({
        where: { userId_storeId: { userId, storeId } },
      });
      if (cart) {
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      }

      return created;
    });

    // ── 9. Payment init ──
    const reference = `${orderNumber}-${Date.now()}`;
    const amountKobo = Math.round(total * 100);

    let init;
    try {
      init = await this.paystack.initialize({
        email: user.email,
        amountKobo,
        reference,
        callbackUrl: `${this.config.get("API_URL")}/payments/verify?orderId=${order.id}`,
        metadata: { orderId: order.id, orderNumber, userId, storeId },
      });
    } catch (err: any) {
      this.logger.error(`Paystack init failed: ${err.message}`);
      throw new BadRequestException("Could not start payment. Please try again.");
    }

    // ── 10. Payment row ──
    await this.db.payment.create({
      data: {
        storeId,                                         // ← tenant FK
        orderId: order.id,
        userId,
        provider: "PAYSTACK",
        providerRef: init.reference,
        amount: new Prisma.Decimal(total),
        currency: store.currency ?? "NGN",
        status: "PENDING",
        metadata: {
          orderNumber,
          amountKobo,
          discount: roundedDiscount,
          deliveryFee,
          subtotal,
        },
      },
    });

    return {
      id: order.id,
      orderNumber,
      subtotal,
      discount: roundedDiscount,
      deliveryFee,
      total,
      payment: {
        reference: init.reference,
        authorizationUrl: init.authorizationUrl,
        amount: total,
        currency: store.currency ?? "NGN",
      },
    };
  }

  // ────────────────────────────────────────────────────────────
  // VERIFY PAYMENT
  // ────────────────────────────────────────────────────────────

  async verifyPayment(userId: string, reference: string) {
    const payment = await this.db.payment.findUnique({
      where: { providerRef: reference },
      include: { order: true },
    });
    if (!payment) throw new NotFoundException("Payment not found");
    if (payment.userId !== userId) throw new ForbiddenException("Not your payment");
    if (payment.status === "SUCCESS") {
      return { status: "SUCCESS", orderId: payment.orderId };
    }

    const result = await this.paystack.verify(reference);

    if (result.status === "success") {
      await this.db.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "SUCCESS",
            channel: result.channel,
            paidAt: result.paidAt ? new Date(result.paidAt) : new Date(),
          },
        });
        await tx.order.update({
          where: { id: payment.orderId! },
          data: { status: "PROCESSING" },        // paid → ready for store to pack
        });
      });
      return { status: "SUCCESS", orderId: payment.orderId };
    }

    if (result.status === "failed" || result.status === "abandoned") {
      await this.db.payment.update({
        where: { id: payment.id },
        data: {
          status: "FAILED",
          failureReason: result.raw?.gateway_response ?? result.status,
        },
      });
    }
    return { status: result.status.toUpperCase(), orderId: payment.orderId };
  }

  async handleWebhook(event: any) {
    this.logger.log(`Paystack webhook: ${event.event}`);
    if (event.event !== "charge.success") return;

    const reference: string = event.data.reference;
    const payment = await this.db.payment.findUnique({
      where: { providerRef: reference },
    });
    if (!payment || payment.status === "SUCCESS") return;

    const paidAt = event.data.paid_at
      ? new Date(event.data.paid_at)
      : new Date();

    await this.db.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "SUCCESS", channel: event.data.channel, paidAt },
      });
      await tx.order.update({
        where: { id: payment.orderId! },
        data: { status: "PROCESSING" },
      });
    });
  }

  // ────────────────────────────────────────────────────────────
  // LIST / DETAIL / TRACKING (customer)
  // ────────────────────────────────────────────────────────────

  async list(userId: string, dto: ListOrdersDto, storeId?: string) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 10;
    const skip = (page - 1) * pageSize;

    const where: Prisma.OrderWhereInput = {
      userId,
      ...(storeId ? { storeId } : {}),   // ← tenant filter when store is chosen
    };

    if (dto.tab === "cancelled") {
      where.status = { in: ["CANCELLED", "RETURNED", "REFUNDED"] };
    } else if (dto.tab === "orders") {
      where.status = { in: ["PENDING", "PROCESSING", "OUT_FOR_DELIVERY", "DELIVERED"] };
    } else if (dto.status?.length) {
      where.status = { in: mapFrontendStatuses(dto.status) as any };
    }

    const [total, rows] = await this.db.$transaction(
      [
        this.db.order.count({ where }),
        this.db.order.findMany({
          where,
          include: { items: { select: { quantity: true, lineTotal: true } } },
          orderBy: { placedAt: "desc" },
          skip,
          take: pageSize,
        }),
      ],
      { maxWait: 10000 },
    );

    return {
      orders: rows.map(serializeOrderSummary),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  private detailInclude = {
    items: true,
    rating: true,
    returnRequests: { orderBy: { requestedAt: "desc" as const }, take: 1 },
  };

  async findOne(userId: string, id: string, storeId?: string) {
    const order = await this.db.order.findFirst({
      where: { id, userId, ...(storeId ? { storeId } : {}) },
      include: this.detailInclude,
    });
    if (!order) throw new NotFoundException("Order not found");
    return serializeOrderDetail(order);
  }

  async tracking(userId: string, id: string, storeId?: string) {
    const order = await this.db.order.findFirst({
      where: { id, userId, ...(storeId ? { storeId } : {}) },
      include: { items: true, payments: true },
    });
    if (!order) throw new NotFoundException("Order not found");
    return serializeOrderTracking(order);
  }

  // ────────────────────────────────────────────────────────────
  // CANCEL (customer)
  // ────────────────────────────────────────────────────────────

  async cancel(userId: string, id: string, dto: CancelOrderDto) {
    const order = await this.db.order.findFirst({
      where: { id, userId },
      include: this.detailInclude,
    });
    if (!order) throw new NotFoundException("Order not found");

    if (order.status !== "PENDING") {
      throw new BadRequestException(
        `Cannot cancel an order that is ${toFrontendStatus(order.status)}`,
      );
    }

    const timeline = readTimeline(order.timeline);
    const shipped = timeline.some(
      (s) => s.stepId === "OUT_FOR_DELIVERY" && s.state === "DONE",
    );
    if (shipped) {
      throw new BadRequestException(
        "Order already out for delivery and cannot be cancelled",
      );
    }

    const updated = await this.db.$transaction(async (tx) => {
      for (const item of order.items) {
        if (item.variantId) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        } else {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
        await tx.stockMovement.create({
          data: {
            storeId: order.storeId,                 // ← tenant FK
            productId: item.productId,
            delta: item.quantity,
            reason: "cancel",
            reference: id,
          },
        });
      }

      const newTimeline = closeTimeline(timeline, `Order cancelled: ${dto.reason}`);

      return tx.order.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelReason: dto.reason,
          timeline: newTimeline as unknown as Prisma.InputJsonValue,
        },
        include: this.detailInclude,
      });
    });

    return serializeOrderDetail(updated);
  }

  // ────────────────────────────────────────────────────────────
  // RATE / RETURN (customer)
  // ────────────────────────────────────────────────────────────

  async rate(userId: string, id: string, dto: RateOrderDto) {
    const order = await this.db.order.findFirst({
      where: { id, userId },
      include: { rating: true },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== "DELIVERED") {
      throw new BadRequestException("You can only rate completed orders");
    }
    if (order.rating) {
      throw new BadRequestException("This order has already been rated");
    }

    const timeline = readTimeline(order.timeline);
    if (!canRate(timeline)) {
      throw new BadRequestException("This order cannot be rated yet");
    }

    const newTimeline = markRated(timeline);

    const [created] = await this.db.$transaction([
      this.db.orderRating.create({
        data: { orderId: id, userId, stars: dto.stars, comment: dto.comment },
      }),
      this.db.order.update({
        where: { id },
        data: { timeline: newTimeline as unknown as Prisma.InputJsonValue },
      }),
    ]);

    return {
      stars: created.stars,
      comment: created.comment ?? undefined,
      submittedAt: created.submittedAt.toISOString(),
    };
  }

  async requestReturn(userId: string, id: string, dto: RequestReturnDto) {
    const order = await this.db.order.findFirst({
      where: { id, userId },
      include: { items: true, returnRequests: true },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== "DELIVERED") {
      throw new BadRequestException("Only completed orders can be returned");
    }
    if (order.returnRequests.length > 0) {
      throw new BadRequestException("A return has already been requested");
    }

    if (dto.itemIds?.length) {
      const valid = new Set(order.items.map((i) => i.id));
      const bad = dto.itemIds.filter((x) => !valid.has(x));
      if (bad.length) throw new BadRequestException(`Invalid itemIds: ${bad.join(", ")}`);
    }

    const selected = dto.itemIds?.length
      ? order.items.filter((i) => dto.itemIds!.includes(i.id))
      : order.items;
    const refundAmount = selected.reduce((sum, i) => sum + Number(i.lineTotal), 0);

    const created = await this.db.returnRequest.create({
      data: {
        orderId: id,
        userId,
        status: "PENDING_REVIEW",
        reason: dto.reason,
        itemIds: dto.itemIds ?? [],
        refundAmount: new Prisma.Decimal(refundAmount),
      },
    });

    return {
      returnId: created.id,
      status: created.status.toLowerCase(),
      requestedAt: created.requestedAt.toISOString(),
    };
  }

  // ────────────────────────────────────────────────────────────
  // REORDER — must target the ORIGINAL store
  // ────────────────────────────────────────────────────────────

  async reorder(userId: string, id: string) {
    const order = await this.db.order.findFirst({
      where: { id, userId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException("Order not found");

    const storeId = order.storeId;

    // Verify the store is still active and the user can shop there
    const store = await this.db.store.findUnique({ where: { id: storeId } });
    if (!store || store.status !== "ACTIVE") {
      throw new BadRequestException("Store is no longer available");
    }

    const productIds = [...new Set(order.items.map((i) => i.productId))];
    const products = await this.db.product.findMany({
      where: { id: { in: productIds }, storeId },   // ← tenant filter
      include: { variants: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // ── Get or create the cart for (userId, storeId) ──
    const cart = await this.db.cart.upsert({
      where: { userId_storeId: { userId, storeId } },
      update: {},
      create: { userId, storeId },
    });

    const added: string[] = [];
    const unavailable: string[] = [];

    await this.db.$transaction(async (tx) => {
      for (const line of order.items) {
        const product = byId.get(line.productId);
        if (!product || product.status !== "ACTIVE") {
          unavailable.push(line.id);
          continue;
        }

        let stock = product.stock;
        if (line.variantId) {
          const v = product.variants.find((x) => x.id === line.variantId);
          if (!v) {
            unavailable.push(line.id);
            continue;
          }
          stock = v.stock;
        }

        if (stock < line.quantity) {
          unavailable.push(line.id);
          continue;
        }

        const existing = await tx.cartItem.findFirst({
          where: {
            cartId: cart.id,
            productId: line.productId,
            variantId: line.variantId,
          },
        });

        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: existing.quantity + line.quantity },
          });
        } else {
          await tx.cartItem.create({
            data: {
              cartId: cart.id,
              productId: line.productId,
              variantId: line.variantId,
              quantity: line.quantity,
            },
          });
        }
        added.push(line.id);
      }
    });

    return { cartItemsAdded: added.length, unavailableItemIds: unavailable };
  }
}

function mapFrontendStatuses(fe: string[]): string[] {
  const map: Record<string, string> = {
    "in-progress": "PROCESSING",
    completed: "DELIVERED",
    cancelled: "CANCELLED",
    returned: "RETURNED",
  };
  return fe.map((s) => map[s] ?? s);
}