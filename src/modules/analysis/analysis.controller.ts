import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable, interval, map, takeWhile, switchMap, from, of, catchError } from 'rxjs';
import { AnalysisService } from './analysis.service';

@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Get()
  async findAll() {
    return this.analysisService.findAll();
  }

  @Get('queue-status')
  async getQueueStatus() {
    return this.analysisService.getQueueStatus();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.analysisService.findById(id);
  }

  @Get(':id/progress')
  async getProgress(@Param('id') id: string) {
    return this.analysisService.getProgress(id);
  }

  @Sse(':id/progress/stream')
  progressStream(@Param('id') id: string): Observable<MessageEvent> {
    // Poll progress every 2 seconds until completed or failed
    return interval(2000).pipe(
      switchMap(() =>
        from(this.analysisService.getProgress(id)).pipe(
          catchError((error) => {
            return of({
              id,
              status: 'failed',
              progress: {
                step: 'failed',
                message: error.message,
                percentage: 0,
              },
            });
          }),
        ),
      ),
      map((progress: any) => ({
        data: progress,
      })),
      takeWhile(
        (event: any) =>
          event.data.status !== 'completed' && event.data.status !== 'failed',
        true,
      ),
    );
  }

  @Post(':id/process')
  async processAnalysis(@Param('id') id: string) {
    return this.analysisService.processAnalysis(id);
  }

  @Delete(':id')
  async deleteAnalysis(@Param('id') id: string) {
    return this.analysisService.deleteAnalysis(id);
  }
}
