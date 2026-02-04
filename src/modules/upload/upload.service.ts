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
    const analysis = new this.analysisModel({
      imageUrl: `/uploads/${file.filename}`,
      imageName: file.originalname,
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
}
