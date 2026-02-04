import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { Analysis, AnalysisSchema } from '../../schemas/analysis.schema';
import { AiModule } from '../ai/ai.module';
import { ANALYSIS_QUEUE } from '../queue/queue.constants';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Analysis.name, schema: AnalysisSchema },
    ]),
    BullModule.registerQueue({
      name: ANALYSIS_QUEUE,
    }),
    AiModule,
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
