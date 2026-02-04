import { Controller, Get, Param, Res, Header } from '@nestjs/common';
import { Response } from 'express';
import { ReportService } from './report.service';

@Controller('report')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get(':id/pdf')
  @Header('Content-Type', 'application/pdf')
  async getPdf(@Param('id') id: string, @Res() res: Response) {
    const pdfBuffer = await this.reportService.generatePdf(id);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="threat-analysis-${id}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });

    res.send(pdfBuffer);
  }

  @Get(':id/json')
  @Header('Content-Type', 'application/json')
  async getJson(@Param('id') id: string, @Res() res: Response) {
    const jsonData = await this.reportService.generateJson(id);

    res.set({
      'Content-Disposition': `attachment; filename="threat-analysis-${id}.json"`,
    });

    res.json(jsonData);
  }

  @Get(':id/markdown')
  @Header('Content-Type', 'text/markdown')
  async getMarkdown(@Param('id') id: string, @Res() res: Response) {
    const markdown = await this.reportService.generateMarkdown(id);

    res.set({
      'Content-Type': 'text/markdown',
      'Content-Disposition': `attachment; filename="threat-analysis-${id}.md"`,
    });

    res.send(markdown);
  }
}
