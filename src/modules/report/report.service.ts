import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as PDFDocument from 'pdfkit';
import { Analysis, AnalysisDocument } from '../../schemas/analysis.schema';

@Injectable()
export class ReportService {
  constructor(
    @InjectModel(Analysis.name)
    private analysisModel: Model<AnalysisDocument>,
  ) {}

  async getAnalysis(id: string): Promise<Analysis> {
    const analysis = await this.analysisModel.findById(id).exec();
    if (!analysis) {
      throw new NotFoundException(`Análise com ID ${id} não encontrada`);
    }
    return analysis;
  }

  async generatePdf(id: string): Promise<Buffer> {
    const analysis = await this.getAnalysis(id);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).font('Helvetica-Bold').text('Threat Model Report', { align: 'center' });
      doc.fontSize(10).font('Helvetica').text(`${analysis.imageName} | ${new Date(analysis.createdAt).toLocaleDateString('pt-BR')}`, { align: 'center' });
      doc.moveDown();

      // Provider
      if (analysis.detectedProvider) {
        doc.fontSize(10).text(`Provider: ${analysis.detectedProvider.toUpperCase()}`, { align: 'center' });
      }
      doc.moveDown();

      // Summary Box
      doc.fontSize(12).font('Helvetica-Bold').text('RESUMO EXECUTIVO');
      doc.fontSize(10).font('Helvetica');
      doc.text(`Componentes: ${analysis.summary.totalComponents} | Ameacas: ${analysis.summary.totalThreats}`);
      doc.text(`Criticas: ${analysis.summary.criticalThreats} | Altas: ${analysis.summary.highThreats} | Medias: ${analysis.summary.mediumThreats} | Baixas: ${analysis.summary.lowThreats}`);

      if (analysis.existingMitigations?.length > 0) {
        doc.text(`Mitigacoes existentes: ${analysis.existingMitigations.join(', ')}`);
      }
      doc.moveDown();

      // Critical and High Threats Only
      doc.fontSize(12).font('Helvetica-Bold').text('AMEACAS PRIORITARIAS (Criticas e Altas)');
      doc.moveDown(0.5);

      let threatCount = 0;
      for (const strideItem of analysis.strideAnalysis) {
        const component = analysis.components.find(c => c.id === strideItem.componentId);
        const criticalHighThreats = strideItem.threats.filter(t => t.severity === 'critical' || t.severity === 'high');

        if (criticalHighThreats.length === 0) continue;

        doc.fontSize(11).font('Helvetica-Bold').text(`${component?.name || strideItem.componentId}`);

        for (const threat of criticalHighThreats) {
          threatCount++;
          const severityIcon = threat.severity === 'critical' ? '[CRIT]' : '[ALTA]';
          doc.fontSize(9).font('Helvetica');
          doc.text(`${severityIcon} ${threat.category}: ${threat.description.substring(0, 150)}${threat.description.length > 150 ? '...' : ''}`);

          if (threat.countermeasures?.length > 0) {
            doc.fontSize(8).fillColor('gray');
            doc.text(`   -> ${threat.countermeasures[0]}`);
            doc.fillColor('black');
          }
        }
        doc.moveDown(0.5);
      }

      if (threatCount === 0) {
        doc.fontSize(10).text('Nenhuma ameaca critica ou alta identificada.');
      }

      // Components Summary (compact)
      doc.addPage();
      doc.fontSize(12).font('Helvetica-Bold').text('COMPONENTES');
      doc.moveDown(0.5);
      doc.fontSize(9).font('Helvetica');

      const componentsByType = analysis.components.reduce((acc, c) => {
        if (!acc[c.type]) acc[c.type] = [];
        acc[c.type].push(c.name);
        return acc;
      }, {} as Record<string, string[]>);

      for (const [type, names] of Object.entries(componentsByType)) {
        doc.text(`${type}: ${names.join(', ')}`);
      }

      // Footer
      doc.fontSize(8).text('Gerado por Threat Modeler AI', 50, doc.page.height - 40, { align: 'center' });

      doc.end();
    });
  }

  async generateJson(id: string): Promise<object> {
    const analysis = await this.getAnalysis(id);

    // Compact version - only critical/high threats with top countermeasure
    const priorityThreats = [];
    for (const strideItem of analysis.strideAnalysis) {
      const component = analysis.components.find(c => c.id === strideItem.componentId);
      for (const threat of strideItem.threats) {
        if (threat.severity === 'critical' || threat.severity === 'high') {
          priorityThreats.push({
            component: component?.name || strideItem.componentId,
            componentType: component?.type,
            category: threat.category,
            severity: threat.severity,
            description: threat.description,
            topCountermeasure: threat.countermeasures?.[0] || null,
          });
        }
      }
    }

    return {
      metadata: {
        tool: 'Threat Modeler AI',
        generatedAt: new Date().toISOString(),
        imageName: analysis.imageName,
        provider: analysis.detectedProvider || 'unknown',
      },
      summary: {
        components: analysis.summary.totalComponents,
        totalThreats: analysis.summary.totalThreats,
        critical: analysis.summary.criticalThreats,
        high: analysis.summary.highThreats,
        medium: analysis.summary.mediumThreats,
        low: analysis.summary.lowThreats,
        existingMitigations: analysis.existingMitigations || [],
      },
      components: analysis.components.map(c => ({
        name: c.name,
        type: c.type,
        provider: c.provider,
      })),
      priorityThreats,
    };
  }

  async generateMarkdown(id: string): Promise<string> {
    const analysis = await this.getAnalysis(id);

    let md = `# Threat Model Report\n\n`;
    md += `**Arquivo:** ${analysis.imageName} | **Data:** ${new Date(analysis.createdAt).toLocaleDateString('pt-BR')}`;
    if (analysis.detectedProvider) {
      md += ` | **Provider:** ${analysis.detectedProvider.toUpperCase()}`;
    }
    md += `\n\n`;

    // Summary
    md += `## Resumo Executivo\n\n`;
    md += `| Metrica | Valor |\n|---|---|\n`;
    md += `| Componentes | ${analysis.summary.totalComponents} |\n`;
    md += `| Total Ameacas | ${analysis.summary.totalThreats} |\n`;
    md += `| **Criticas** | **${analysis.summary.criticalThreats}** |\n`;
    md += `| **Altas** | **${analysis.summary.highThreats}** |\n`;
    md += `| Medias | ${analysis.summary.mediumThreats} |\n`;
    md += `| Baixas | ${analysis.summary.lowThreats} |\n\n`;

    if (analysis.existingMitigations?.length > 0) {
      md += `**Mitigacoes Existentes:** ${analysis.existingMitigations.join(', ')}\n\n`;
    }

    // Components (compact)
    md += `## Componentes\n\n`;
    const componentsByType = analysis.components.reduce((acc, c) => {
      if (!acc[c.type]) acc[c.type] = [];
      acc[c.type].push(c.name);
      return acc;
    }, {} as Record<string, string[]>);

    for (const [type, names] of Object.entries(componentsByType)) {
      md += `- **${type}:** ${names.join(', ')}\n`;
    }
    md += `\n`;

    // Priority Threats
    md += `## Ameacas Prioritarias\n\n`;

    let hasPriorityThreats = false;
    for (const strideItem of analysis.strideAnalysis) {
      const component = analysis.components.find(c => c.id === strideItem.componentId);
      const criticalHighThreats = strideItem.threats.filter(t => t.severity === 'critical' || t.severity === 'high');

      if (criticalHighThreats.length === 0) continue;
      hasPriorityThreats = true;

      md += `### ${component?.name || strideItem.componentId}\n\n`;

      for (const threat of criticalHighThreats) {
        const emoji = threat.severity === 'critical' ? '🔴' : '🟠';
        md += `${emoji} **${threat.category}** (${threat.severity})\n`;
        md += `> ${threat.description}\n\n`;

        if (threat.countermeasures?.length > 0) {
          md += `**Acao:** ${threat.countermeasures[0]}\n\n`;
        }
      }
    }

    if (!hasPriorityThreats) {
      md += `Nenhuma ameaca critica ou alta identificada.\n\n`;
    }

    md += `---\n*Gerado por Threat Modeler AI*\n`;

    return md;
  }
}
