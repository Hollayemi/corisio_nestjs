import { IsEmail, IsEnum } from "class-validator";
import { StoreMemberRole } from "../../generated/prisma/client.js";

export class InviteAdminUserDto {
  @IsEmail() email: string;

  @IsEnum(StoreMemberRole) role: StoreMemberRole;
}