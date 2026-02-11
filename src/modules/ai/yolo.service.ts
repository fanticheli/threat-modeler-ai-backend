import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * YoloService - Client HTTP para o microsservico Python de inferencia YOLO.
 *
 * Padrao de mercado: Model Serving via microsservico separado.
 * O modelo YOLO roda em Python (FastAPI) e o backend NestJS consome via HTTP.
 *
 * Fluxo:
 *   NestJS (ai.service) -> HTTP POST -> FastAPI (yolo-service) -> YOLO inference -> JSON response
 */

export interface YoloBoundingBox {
  x_center: number;
  y_center: number;
  width: number;
  height: number;
}

export interface YoloBoundingBoxPixels {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface YoloDetection {
  class_id: number;
  class_name: string;
  backend_type: string;
  confidence: number;
  bbox_normalized: YoloBoundingBox;
  bbox_pixels: YoloBoundingBoxPixels;
}

export interface YoloPredictionResponse {
  model: string;
  inference_time_ms: number;
  image_size: { width: number; height: number };
  detections: YoloDetection[];
  total_detections: number;
}

export interface YoloHealthResponse {
  status: string;
  model_loaded: boolean;
  model_path: string;
  total_classes: number;
}

@Injectable()
export class YoloService {
  private readonly logger = new Logger(YoloService.name);
  private readonly yoloServiceUrl: string;
  private readonly timeoutMs: number;

  constructor(private configService: ConfigService) {
    this.yoloServiceUrl = this.configService.get<string>(
      'YOLO_SERVICE_URL',
      'http://localhost:8000',
    );
    this.timeoutMs = this.configService.get<number>('YOLO_TIMEOUT_MS', 30000);
    this.logger.log(`YOLO service URL: ${this.yoloServiceUrl}`);
  }

  /**
   * Verifica se o microsservico YOLO esta disponivel e com modelo carregado.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.yoloServiceUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) return false;

      const health: YoloHealthResponse = await response.json();
      return health.model_loaded;
    } catch {
      this.logger.warn('YOLO service nao disponivel');
      return false;
    }
  }

  /**
   * Envia imagem para o microsservico YOLO e retorna deteccoes.
   *
   * @param imageBase64 - Imagem em base64
   * @param mimeType - Tipo MIME (image/png, image/jpeg, etc)
   * @param confidence - Threshold minimo de confianca (0-1)
   */
  async predict(
    imageBase64: string,
    mimeType: string,
    confidence: number = 0.05,
  ): Promise<YoloPredictionResponse | null> {
    try {
      this.logger.log('Enviando imagem para YOLO service...');

      // Converter base64 para Buffer
      const imageBuffer = Buffer.from(imageBase64, 'base64');

      // Criar FormData com a imagem
      const blob = new Blob([imageBuffer], { type: mimeType });
      const formData = new FormData();
      formData.append('file', blob, `image.${mimeType.split('/')[1] || 'png'}`);

      // Chamar microsservico
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(
        `${this.yoloServiceUrl}/predict?confidence=${confidence}`,
        {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        },
      );
      clearTimeout(timeout);

      if (!response.ok) {
        const error = await response.text();
        this.logger.error(`YOLO service error: ${response.status} - ${error}`);
        return null;
      }

      const result: YoloPredictionResponse = await response.json();

      this.logger.log(
        `YOLO detectou ${result.total_detections} componentes em ${result.inference_time_ms}ms`,
      );

      return result;
    } catch (error) {
      this.logger.warn(`YOLO service falhou: ${error.message}`);
      return null;
    }
  }
}
