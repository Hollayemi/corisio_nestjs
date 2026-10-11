import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger, ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor.js";
import { HttpExceptionFilter } from "./common/filters/http-exception.filters.js";
import { AppModule } from "./app.module.js";

/**
 * CORS_ORIGINS is a comma-separated allow-list, e.g.
 *   CORS_ORIGINS=https://corisio-demo.vercel.app,https://app.corisio.com
 * If unset: localhost only outside production, no cross-origin access in production.
 */
function resolveCorsOrigin(): (string | RegExp)[] | false {
  const configured = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  if (process.env.NODE_ENV === "production") return false;
  return [/^https?:\/\/localhost(:\d+)?$/];
}

async function bootstrap() {
  // rawBody: true keeps the unparsed request body on req.rawBody, which the
  // Paystack webhook guard needs to verify the HMAC signature.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Number of reverse proxies in front of the app, so req.ip is the real
  // client address and X-Forwarded-For can't be spoofed by the caller.
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));

  app.use(helmet());

  app.setGlobalPrefix("api");

  app.enableCors({
    origin: resolveCorsOrigin(),
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-User-Lat",
      "X-User-Lng",
    ],
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter(new Logger("HttpExceptionFilter")));

  await app.listen(process.env.PORT ?? 5001);
}
bootstrap();
