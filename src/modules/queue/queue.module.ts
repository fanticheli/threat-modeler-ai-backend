import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AnalysisProcessor } from './analysis.processor';
import { Analysis, AnalysisSchema } from '../../schemas/analysis.schema';
import { AiModule } from '../ai/ai.module';
import { ANALYSIS_QUEUE } from './queue.constants';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: ANALYSIS_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    }),
    MongooseModule.forFeature([{ name: Analysis.name, schema: AnalysisSchema }]),
    AiModule,
  ],
  providers: [AnalysisProcessor],
  exports: [BullModule],
})
export class QueueModule {}

export { ANALYSIS_QUEUE } from './queue.constants';
