import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { OrdersService } from "../orders/orders.service.js";
import { PaystackWebhookGuard } from "./paystack-webhook.guard.js";

// Server-to-server traffic from Paystack: authenticated by HMAC signature, so
// it must never be rate limited (a dropped webhook means a paid, unfulfilled order).
@SkipThrottle()
@Controller("webhooks/paystack")
export class PaystackWebhookController {
  constructor(private orders: OrdersService) {}

  @Post()
  @UseGuards(PaystackWebhookGuard)
  async handle(@Body() event: any) {
    await this.orders.handleWebhook(event);
    return { received: true };
  }
}