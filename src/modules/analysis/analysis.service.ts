import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model } from 'mongoose';
import { Queue } from 'bullmq';
import { Analysis, AnalysisDocument } from '../../schemas/analysis.schema';
import { ANALYSIS_QUEUE } from '../queue/queue.constants';

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    @InjectModel(Analysis.name)
    private analysisModel: Model<AnalysisDocument>,
    @InjectQueue(ANALYSIS_QUEUE)
    private analysisQueue: Queue,
  ) {}

  async findAll() {
    return this.analysisModel
      .find()
      .select('_id imageName imageUrl detectedProvider status summary progress createdAt')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findById(id: string) {
    const analysis = await this.analysisModel.findById(id).exec();
    if (!analysis) {
      throw new NotFoundException(`Análise com ID ${id} não encontrada`);
    }
    return analysis;
  }

  async getProgress(id: string) {
    const analysis = await this.analysisModel
      .findById(id)
      .select('_id status progress')
      .exec();

    if (!analysis) {
      throw new NotFoundException(`Análise com ID ${id} não encontrada`);
    }

    return {
      id: analysis._id,
      status: analysis.status,
      progress: analysis.progress || {
        step: 'waiting',
        message: 'Aguardando inicio...',
        percentage: 0,
      },
    };
  }

  async processAnalysis(id: string) {
    const analysis = await this.findById(id);

    if (analysis.status === 'completed') {
      return { message: 'Análise já concluída', analysis };
    }

    // Check if already in queue
    const existingJob = await this.analysisQueue.getJob(id);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === 'active' || state === 'waiting') {
        return {
          message: 'Análise já está sendo processada',
          jobId: existingJob.id,
          status: 'processing',
        };
      }
    }

    // Update status to processing
    analysis.status = 'processing';
    analysis.progress = {
      step: 'waiting',
      message: 'Análise adicionada à fila...',
      percentage: 0,
      currentComponent: 0,
      totalComponents: 0,
      updatedAt: new Date(),
    };
    await analysis.save();

    // Add to queue
    const job = await this.analysisQueue.add(
      'process-analysis',
      { analysisId: id },
      {
        jobId: id,
        priority: 1,
      },
    );

    this.logger.log(`Analysis ${id} added to queue with job ${job.id}`);

    return {
      message: 'Análise iniciada',
      jobId: job.id,
      status: 'processing',
    };
  }

  async deleteAnalysis(id: string) {
    // Remove from queue if exists
    const existingJob = await this.analysisQueue.getJob(id);
    if (existingJob) {
      await existingJob.remove();
    }

    const result = await this.analysisModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Análise com ID ${id} não encontrada`);
    }
    return { message: 'Análise excluída com sucesso' };
  }

  async getQueueStatus() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.analysisQueue.getWaitingCount(),
      this.analysisQueue.getActiveCount(),
      this.analysisQueue.getCompletedCount(),
      this.analysisQueue.getFailedCount(),
    ]);

    return { waiting, active, completed, failed };
  }
}
