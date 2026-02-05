import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model } from 'mongoose';
import { Queue } from 'bullmq';
import { Analysis, AnalysisDocument } from '../../schemas/analysis.schema';
import { ANALYSIS_QUEUE } from '../queue/queue.constants';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    @InjectModel(Analysis.name)
    private analysisModel: Model<AnalysisDocument>,
    @InjectQueue(ANALYSIS_QUEUE)
    private analysisQueue: Queue,
  ) {}

  async createAnalysisFromUpload(file: Express.Multer.File, language: 'pt-BR' | 'en-US' = 'pt-BR') {
    // Converter imagem para Base64
    const imageBase64 = file.buffer.toString('base64');
    const imageMimeType = file.mimetype;

    const analysis = new this.analysisModel({
      imageUrl: `/api/upload/image/{id}`, // Será atualizado após salvar
      imageName: file.originalname,
      imageBase64,
      imageMimeType,
      language,
      status: 'processing',
      components: [],
      connections: [],
      strideAnalysis: [],
      summary: {
        totalComponents: 0,
        totalThreats: 0,
        criticalThreats: 0,
        highThreats: 0,
        mediumThreats: 0,
        lowThreats: 0,
      },
      progress: {
        step: 'waiting',
        message: 'Analise adicionada a fila...',
        percentage: 0,
        currentComponent: 0,
        totalComponents: 0,
        updatedAt: new Date(),
      },
    });

    const savedAnalysis = await analysis.save();
    const analysisId = savedAnalysis._id.toString();

    // Atualizar imageUrl com o ID correto
    savedAnalysis.imageUrl = `/api/upload/image/${analysisId}`;
    await savedAnalysis.save();

    // Adiciona o job à fila automaticamente após o upload
    const job = await this.analysisQueue.add(
      'process-analysis',
      { analysisId },
      {
        jobId: analysisId,
        priority: 1,
      },
    );

    this.logger.log(`Analysis ${analysisId} created and added to queue with job ${job.id}`);

    return {
      id: savedAnalysis._id,
      imageUrl: savedAnalysis.imageUrl,
      imageName: savedAnalysis.imageName,
      status: savedAnalysis.status,
    };
  }

  async getImageById(id: string) {
    const analysis = await this.analysisModel.findById(id).select('imageBase64 imageMimeType');

    if (!analysis || !analysis.imageBase64) {
      return null;
    }

    return {
      base64: analysis.imageBase64,
      mimeType: analysis.imageMimeType || 'image/jpeg',
    };
  }
}
