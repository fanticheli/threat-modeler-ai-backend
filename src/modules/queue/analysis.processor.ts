import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as path from 'path';
import { Analysis, AnalysisDocument } from '../../schemas/analysis.schema';
import { AiService } from '../ai/ai.service';
import { ANALYSIS_QUEUE } from './queue.constants';

export interface AnalysisJobData {
  analysisId: string;
}

export interface ProgressData {
  analysisId: string;
  step: string;
  message: string;
  percentage: number;
  currentComponent?: number;
  totalComponents?: number;
}

@Processor(ANALYSIS_QUEUE)
export class AnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(
    @InjectModel(Analysis.name)
    private analysisModel: Model<AnalysisDocument>,
    private aiService: AiService,
    private eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<AnalysisJobData>): Promise<void> {
    const { analysisId } = job.data;
    this.logger.log(`Processing analysis job: ${analysisId}`);

    const analysis = await this.analysisModel.findById(analysisId).exec();
    if (!analysis) {
      throw new Error(`Analysis ${analysisId} not found`);
    }

    if (analysis.status === 'completed') {
      this.logger.log(`Analysis ${analysisId} already completed, skipping`);
      return;
    }

    try {
      // Step 1: Detecting components (0-30%)
      await this.updateProgress(analysisId, {
        step: 'detecting_components',
        message: 'Detectando componentes na arquitetura...',
        percentage: 5,
      });

      const imagePath = path.join(
        process.cwd(),
        analysis.imageUrl.replace(/^\//, ''),
      );

      const language = analysis.language || 'pt-BR';
      const detection = await this.aiService.detectComponents(imagePath, language);
      const { components, connections, detectedProvider, existingMitigations } = detection;

      await this.updateProgress(analysisId, {
        step: 'detecting_components',
        message: `${components.length} componentes detectados`,
        percentage: 30,
        totalComponents: components.length,
      });

      // Step 2: STRIDE Analysis (30-90%)
      const strideAnalysis: any[] = [];
      const totalToAnalyze = components.length;

      for (let i = 0; i < components.length; i++) {
        const component = components[i];
        const progressPercent = 30 + Math.round((i / totalToAnalyze) * 60);

        await this.updateProgress(analysisId, {
          step: 'analyzing_stride',
          message: `Analisando STRIDE: ${component.name}`,
          percentage: progressPercent,
          currentComponent: i + 1,
          totalComponents: totalToAnalyze,
        });

        const strideResult = await this.aiService.analyzeStrideForComponent(
          component,
          connections,
          detectedProvider,
          existingMitigations,
          language,
        );

        const threatsWithCountermeasures = strideResult.threats.map(threat => ({
          ...threat,
          countermeasures: threat.countermeasures || [],
        }));

        strideAnalysis.push({
          componentId: component.id,
          threats: threatsWithCountermeasures,
        });
      }

      // Step 3: Generating report (90-100%)
      await this.updateProgress(analysisId, {
        step: 'generating_report',
        message: 'Gerando relatorio final...',
        percentage: 95,
      });

      // Calculate summary
      const summary = this.calculateSummary({ components, strideAnalysis });

      // Update analysis with results
      await this.analysisModel.findByIdAndUpdate(analysisId, {
        detectedProvider,
        existingMitigations,
        components,
        connections,
        strideAnalysis,
        summary,
        status: 'completed',
        progress: {
          step: 'completed',
          message: 'Analise concluida com sucesso!',
          percentage: 100,
          currentComponent: totalToAnalyze,
          totalComponents: totalToAnalyze,
          updatedAt: new Date(),
        },
      }).exec();

      this.emitProgress(analysisId, {
        step: 'completed',
        message: 'Analise concluida com sucesso!',
        percentage: 100,
        currentComponent: totalToAnalyze,
        totalComponents: totalToAnalyze,
      });

      this.logger.log(`Analysis ${analysisId} completed successfully`);
    } catch (error) {
      this.logger.error(`Analysis ${analysisId} failed: ${error.message}`);

      await this.analysisModel.findByIdAndUpdate(analysisId, {
        status: 'failed',
        error: error.message,
        progress: {
          step: 'failed',
          message: `Erro: ${error.message}`,
          percentage: 0,
          updatedAt: new Date(),
        },
      }).exec();

      this.emitProgress(analysisId, {
        step: 'failed',
        message: `Erro: ${error.message}`,
        percentage: 0,
      });

      throw error;
    }
  }

  private async updateProgress(
    analysisId: string,
    progress: Partial<ProgressData>,
  ): Promise<void> {
    await this.analysisModel.findByIdAndUpdate(analysisId, {
      progress: {
        ...progress,
        updatedAt: new Date(),
      },
    }).exec();

    this.emitProgress(analysisId, progress);
  }

  private emitProgress(analysisId: string, progress: Partial<ProgressData>): void {
    this.eventEmitter.emit('analysis.progress', {
      analysisId,
      ...progress,
    });
  }

  private calculateSummary(result: {
    components: any[];
    strideAnalysis: any[];
  }) {
    let totalThreats = 0;
    let criticalThreats = 0;
    let highThreats = 0;
    let mediumThreats = 0;
    let lowThreats = 0;

    for (const componentAnalysis of result.strideAnalysis) {
      for (const threat of componentAnalysis.threats) {
        totalThreats++;
        switch (threat.severity) {
          case 'critical':
            criticalThreats++;
            break;
          case 'high':
            highThreats++;
            break;
          case 'medium':
            mediumThreats++;
            break;
          case 'low':
            lowThreats++;
            break;
        }
      }
    }

    return {
      totalComponents: result.components.length,
      totalThreats,
      criticalThreats,
      highThreats,
      mediumThreats,
      lowThreats,
    };
  }
}
