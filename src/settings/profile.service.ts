import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UpdateAdminProfileDto } from "./dto/update-profile.dto.js";
import { serializeProfile } from "./settings.serializer.js";
import { DatabaseService } from "../database/database.service.js";
import { CloudinaryService } from "../cloudinary/cloudinary.js";


@Injectable()
export class ProfileService {
  constructor(
    private db: DatabaseService,
    private cd: CloudinaryService,
  ) {}

  async get(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    return serializeProfile(user);
  }

  async update(
    userId: string,
    dto: UpdateAdminProfileDto,
    file?: Express.Multer.File,
  ) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const clash = await this.db.user.findUnique({
        where: { email: dto.email.toLowerCase() },
      });
      if (clash) throw new ConflictException("Email already in use");
    }

    const image = file ? await this.cd.upload(file) : undefined;

    const updated = await this.db.user.update({
      where: { id: userId },
      data: {
        name: dto.name ?? undefined,
        email: dto.email ? dto.email.toLowerCase() : undefined,
        bio: dto.bio === undefined ? undefined : dto.bio,
        image: image === undefined ? undefined : image,
      },
    });

    return serializeProfile(updated);
  }
}