import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "../../generated/prisma/enums.js";
import { ROLES_KEY } from "../../common/decorator/roles.decorator.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) { }

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    // `Roles()` carries account-level roles (e.g. SUPER_ADMIN). `user.memberships`
    // is a map keyed by store slug, so it has no `.role` of its own.
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException("Admin access required");
    }
    return true;
  }
}