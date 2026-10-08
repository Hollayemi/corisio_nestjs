import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";


@Injectable()
export class StoreMemberGuard implements CanActivate {
  constructor(private db: DatabaseService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    const storeId = req.storeId;
    if (!storeId) throw new ForbiddenException("Missing store context");

    // Super admins bypass membership
    if (user.role === "SUPER_ADMIN") {
      req.storeRole = "OWNER";
      return true;
    }

    const member = await this.db.storeMember.findFirst({
      where: { userId: user.id, storeId, status: "ACTIVE" },
    });
    if (!member) throw new ForbiddenException("Not a member of this store");

    req.storeRole = member.role;
    return true;
  }
}