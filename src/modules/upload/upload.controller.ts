import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { UploadService } from './upload.service';

export type AnalysisLanguage = 'pt-BR' | 'en-US';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
          callback(
            new BadRequestException('Apenas imagens são permitidas'),
            false,
          );
          return;
        }
        callback(null, true);
      },
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('language') language?: AnalysisLanguage,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhuma imagem foi enviada');
    }

    const validLanguages: AnalysisLanguage[] = ['pt-BR', 'en-US'];
    const selectedLanguage = validLanguages.includes(language) ? language : 'pt-BR';

    return this.uploadService.createAnalysisFromUpload(file, selectedLanguage);
  }

  @Get('image/:id')
  async getImage(@Param('id') id: string, @Res() res: Response) {
    const image = await this.uploadService.getImageById(id);

    if (!image) {
      throw new NotFoundException('Imagem não encontrada');
    }

    const buffer = Buffer.from(image.base64, 'base64');

    res.set({
      'Content-Type': image.mimeType,
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=31536000',
    });

    res.send(buffer);
  }
}
