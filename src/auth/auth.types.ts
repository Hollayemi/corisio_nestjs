// src/auth/auth.types.ts
import { Role, StoreMemberRole } from "../generated/prisma/enums.js";


export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  sid: string | null;
  defaultSlug: string | null;

}

/**
 * Optional extended shape — only when AuthService.validate() also
 * loads memberships. Not needed for the lazy-membership approach.
 */

export interface StoreMembership {
  storeId: string;
  storeName: string;
  storeSlug: string;
  role: StoreMemberRole;
}

export interface AuthUserWithStores extends AuthUser {
  memberships?: Record<string, StoreMembership>;
}


export interface JwtPayload {
  sub: string;      // user id
  email: string;
  sid: string | null; // session id
}