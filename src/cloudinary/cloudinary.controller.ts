import {
  Controller, Post, Delete, Param, Query, UseGuards,
  UploadedFile, UploadedFiles, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CloudinaryService } from './cloudinary.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

const multerOpts = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(
        new BadRequestException('Only JPEG, PNG, WebP, GIF or AVIF images are allowed'),
        false,
      );
    }
    cb(null, true);
  },
};

// Every upload route requires an authenticated user.
@UseGuards(JwtAuthGuard)
@Controller('upload')
export class CloudinaryController {
  constructor(private readonly cloudinary: CloudinaryService) {}

  // Single upload → { url }
  @Post()
  @UseInterceptors(FileInterceptor('file', multerOpts))
  async uploadOne(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file');
    const url = await this.cloudinary.upload(file);
    return { url };
  }

  // Bulk upload → { urls: [...] }
  @Post('bulk')
  @UseInterceptors(FilesInterceptor('files', 10, multerOpts))
  async uploadBulk(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException('No files');
    const urls = await this.cloudinary.uploadMany(files);
    return { urls };
  }

  // Delete → pass the publicId
  @Delete(':publicId')
  async remove(@Param('publicId') publicId: string, @Query('type') type?: any) {
    return this.cloudinary.delete(publicId, type);
  }
}
