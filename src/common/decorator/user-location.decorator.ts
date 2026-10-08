import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export type Coords = { lat: number; lng: number } | null;

export const UserLocation = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Coords => {
    const req = ctx.switchToHttp().getRequest();
    const latRaw = req.headers["x-user-lat"];
    const lngRaw = req.headers["x-user-lng"];
    if (latRaw == null || lngRaw == null) return null;

    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return null;
    }
    return { lat, lng };
  },
);