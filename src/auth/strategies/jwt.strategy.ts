import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthService } from "../auth.service.js";
import { AuthUserWithStores } from "../auth.types.js";

export interface JwtPayload {
  sub: string;
  email: string;
  sid: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private auth: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET!,
      ignoreExpiration: false,
    });
  }

  
  async validate(payload: AuthUserWithStores) {
    if (!payload?.id) throw new UnauthorizedException();

    const user = await this.auth.validate({
      id: payload.id,
      sid: payload.sid ?? null,
      memberships: payload.memberships ?? {},
    });
    return {...user};
  }
}