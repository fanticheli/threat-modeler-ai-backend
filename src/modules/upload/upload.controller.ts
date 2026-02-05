import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
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
import { ImageQualityService } from './image-quality.service';

export type AnalysisLanguage = 'pt-BR' | 'en-US';

@Controller('upload')
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly imageQualityService: ImageQualityService,
  ) {}

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
    @Query('skipQualityCheck') skipQualityCheck?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhuma imagem foi enviada');
    }

    // Validar qualidade da imagem
    const qualityResult = await this.imageQualityService.validateImage(file.buffer);

    // Se qualidade for muito baixa e não for para pular a verificação
    if (!qualityResult.isValid && skipQualityCheck !== 'true') {
      throw new BadRequestException({
        message: 'A qualidade da imagem está abaixo do recomendado',
        quality: qualityResult,
      });
    }

    const validLanguages: AnalysisLanguage[] = ['pt-BR', 'en-US'];
    const selectedLanguage = validLanguages.includes(language) ? language : 'pt-BR';

    const analysis = await this.uploadService.createAnalysisFromUpload(file, selectedLanguage);

    return {
      ...analysis,
      quality: qualityResult,
    };
  }

  @Post('validate')
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
  async validateImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Nenhuma imagem foi enviada');
    }

    return this.imageQualityService.validateImage(file.buffer);
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
