import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { YoloService } from './yolo.service';

@Module({
  providers: [AiService, YoloService],
  exports: [AiService, YoloService],
})
export class AiModule {}
