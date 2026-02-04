import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { BullModule } from '@nestjs/bullmq';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { Analysis, AnalysisSchema } from '../../schemas/analysis.schema';
import { ANALYSIS_QUEUE } from '../queue/queue.constants';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Analysis.name, schema: AnalysisSchema },
    ]),
    MulterModule.register({
      dest: './uploads',
    }),
    BullModule.registerQueue({
      name: ANALYSIS_QUEUE,
    }),
  ],
  controllers: [UploadController],
  providers: [UploadService],
})
export class UploadModule {}
