import { Injectable, Logger } from '@nestjs/common';
import * as sharp from 'sharp';

export interface ImageQualityResult {
  isValid: boolean;
  score: number; // 0-100
  details: {
    resolution: {
      width: number;
      height: number;
      isValid: boolean;
      message: string;
    };
    fileSize: {
      bytes: number;
      isValid: boolean;
      message: string;
    };
    sharpness: {
      value: number;
      isValid: boolean;
      message: string;
    };
    contrast: {
      value: number;
      isValid: boolean;
      message: string;
    };
  };
  recommendations: string[];
}

@Injectable()
export class ImageQualityService {
  private readonly logger = new Logger(ImageQualityService.name);

  // Configurações mínimas
  private readonly MIN_WIDTH = 800;
  private readonly MIN_HEIGHT = 600;
  private readonly MIN_FILE_SIZE = 50 * 1024; // 50KB
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private readonly MIN_SHARPNESS = 20; // 0-100
  private readonly MIN_CONTRAST = 30; // 0-100

  async validateImage(buffer: Buffer): Promise<ImageQualityResult> {
    this.logger.log('Validating image quality...');

    const recommendations: string[] = [];
    let totalScore = 0;
    let validChecks = 0;

    // 1. Obter metadados da imagem
    const metadata = await sharp(buffer).metadata();
    const { width, height } = metadata;

    // 2. Validar resolução
    const resolutionValid = width >= this.MIN_WIDTH && height >= this.MIN_HEIGHT;
    const resolutionScore = this.calculateResolutionScore(width, height);
    totalScore += resolutionScore;

    if (!resolutionValid) {
      recommendations.push(
        `Aumente a resolução da imagem. Mínimo recomendado: ${this.MIN_WIDTH}x${this.MIN_HEIGHT}px. Atual: ${width}x${height}px`,
      );
    } else {
      validChecks++;
    }

    // 3. Validar tamanho do arquivo
    const fileSize = buffer.length;
    const fileSizeValid = fileSize >= this.MIN_FILE_SIZE && fileSize <= this.MAX_FILE_SIZE;
    const fileSizeScore = this.calculateFileSizeScore(fileSize);
    totalScore += fileSizeScore;

    if (fileSize < this.MIN_FILE_SIZE) {
      recommendations.push(
        `Arquivo muito pequeno (${this.formatBytes(fileSize)}). Isso pode indicar baixa qualidade ou compressão excessiva.`,
      );
    } else if (fileSize > this.MAX_FILE_SIZE) {
      recommendations.push(
        `Arquivo muito grande (${this.formatBytes(fileSize)}). Máximo permitido: ${this.formatBytes(this.MAX_FILE_SIZE)}.`,
      );
    } else {
      validChecks++;
    }

    // 4. Calcular nitidez (usando variância do Laplaciano)
    const sharpnessValue = await this.calculateSharpness(buffer);
    const sharpnessValid = sharpnessValue >= this.MIN_SHARPNESS;
    const sharpnessScore = Math.min(sharpnessValue, 100);
    totalScore += sharpnessScore;

    if (!sharpnessValid) {
      recommendations.push(
        `A imagem parece estar borrada ou com baixa nitidez. Use uma imagem mais nítida para melhores resultados.`,
      );
    } else {
      validChecks++;
    }

    // 5. Calcular contraste
    const contrastValue = await this.calculateContrast(buffer);
    const contrastValid = contrastValue >= this.MIN_CONTRAST;
    const contrastScore = Math.min(contrastValue, 100);
    totalScore += contrastScore;

    if (!contrastValid) {
      recommendations.push(
        `A imagem tem baixo contraste. Imagens com melhor contraste facilitam a identificação de componentes.`,
      );
    } else {
      validChecks++;
    }

    // Calcular score final (média dos 4 critérios)
    const finalScore = Math.round(totalScore / 4);

    // Imagem é válida se pelo menos 3 dos 4 critérios passarem E o score >= 50
    const isValid = validChecks >= 3 && finalScore >= 50;

    if (!isValid && recommendations.length === 0) {
      recommendations.push(
        'A qualidade geral da imagem está abaixo do recomendado. Tente usar uma imagem com melhor qualidade.',
      );
    }

    const result: ImageQualityResult = {
      isValid,
      score: finalScore,
      details: {
        resolution: {
          width,
          height,
          isValid: resolutionValid,
          message: resolutionValid
            ? `Resolução adequada (${width}x${height})`
            : `Resolução baixa (${width}x${height}). Mínimo: ${this.MIN_WIDTH}x${this.MIN_HEIGHT}`,
        },
        fileSize: {
          bytes: fileSize,
          isValid: fileSizeValid,
          message: fileSizeValid
            ? `Tamanho adequado (${this.formatBytes(fileSize)})`
            : `Tamanho inadequado (${this.formatBytes(fileSize)})`,
        },
        sharpness: {
          value: Math.round(sharpnessValue),
          isValid: sharpnessValid,
          message: sharpnessValid
            ? `Nitidez adequada (${Math.round(sharpnessValue)}%)`
            : `Imagem borrada (${Math.round(sharpnessValue)}%). Mínimo: ${this.MIN_SHARPNESS}%`,
        },
        contrast: {
          value: Math.round(contrastValue),
          isValid: contrastValid,
          message: contrastValid
            ? `Contraste adequado (${Math.round(contrastValue)}%)`
            : `Baixo contraste (${Math.round(contrastValue)}%). Mínimo: ${this.MIN_CONTRAST}%`,
        },
      },
      recommendations,
    };

    this.logger.log(`Image quality score: ${finalScore}, valid: ${isValid}`);
    return result;
  }

  private calculateResolutionScore(width: number, height: number): number {
    const pixels = width * height;
    const minPixels = this.MIN_WIDTH * this.MIN_HEIGHT; // 480,000
    const idealPixels = 1920 * 1080; // 2,073,600

    if (pixels >= idealPixels) return 100;
    if (pixels < minPixels) return Math.round((pixels / minPixels) * 50);

    // Escala linear entre mínimo (50) e ideal (100)
    return Math.round(50 + ((pixels - minPixels) / (idealPixels - minPixels)) * 50);
  }

  private calculateFileSizeScore(fileSize: number): number {
    const idealMin = 200 * 1024; // 200KB
    const idealMax = 2 * 1024 * 1024; // 2MB

    if (fileSize < this.MIN_FILE_SIZE) {
      return Math.round((fileSize / this.MIN_FILE_SIZE) * 40);
    }
    if (fileSize > this.MAX_FILE_SIZE) {
      return 30; // Penaliza arquivos muito grandes
    }
    if (fileSize >= idealMin && fileSize <= idealMax) {
      return 100;
    }
    if (fileSize < idealMin) {
      return Math.round(60 + ((fileSize - this.MIN_FILE_SIZE) / (idealMin - this.MIN_FILE_SIZE)) * 40);
    }
    // Entre idealMax e MAX_FILE_SIZE
    return Math.round(100 - ((fileSize - idealMax) / (this.MAX_FILE_SIZE - idealMax)) * 30);
  }

  private async calculateSharpness(buffer: Buffer): Promise<number> {
    try {
      // Converter para grayscale e aplicar filtro Laplaciano
      const { data, info } = await sharp(buffer)
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { width, height } = info;
      let variance = 0;
      let mean = 0;

      // Calcular média
      for (let i = 0; i < data.length; i++) {
        mean += data[i];
      }
      mean /= data.length;

      // Calcular variância (indicador de nitidez)
      for (let i = 0; i < data.length; i++) {
        variance += Math.pow(data[i] - mean, 2);
      }
      variance /= data.length;

      // Normalizar para 0-100
      // Variância alta = imagem mais nítida
      const normalizedSharpness = Math.min(Math.sqrt(variance) / 80 * 100, 100);

      return normalizedSharpness;
    } catch (error) {
      this.logger.warn(`Error calculating sharpness: ${error.message}`);
      return 50; // Valor neutro em caso de erro
    }
  }

  private async calculateContrast(buffer: Buffer): Promise<number> {
    try {
      const { data } = await sharp(buffer)
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      let min = 255;
      let max = 0;

      // Encontrar valores mínimo e máximo
      for (let i = 0; i < data.length; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
      }

      // Contraste = diferença entre max e min normalizado
      const contrast = ((max - min) / 255) * 100;

      return contrast;
    } catch (error) {
      this.logger.warn(`Error calculating contrast: ${error.message}`);
      return 50; // Valor neutro em caso de erro
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
