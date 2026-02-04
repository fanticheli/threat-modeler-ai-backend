import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { buildComponentDetectionPrompt } from './prompts/component-detection';
import { buildStrideAnalysisPrompt } from './prompts/stride-analysis';
import {
  ComponentDetectionResult,
  StrideAnalysisResult,
  DetectedComponent,
  DetectedConnection,
  ComponentStrideAnalysis,
  ThreatWithCountermeasures,
  FullAnalysisResult,
} from './interfaces/ai.interfaces';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private anthropic: Anthropic;

  constructor(private configService: ConfigService) {
    this.anthropic = new Anthropic({
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  async detectComponents(imagePath: string, language: 'pt-BR' | 'en-US' = 'pt-BR'): Promise<ComponentDetectionResult> {
    this.logger.log(`Detecting components from image: ${imagePath} (language: ${language})`);

    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const mediaType = this.getMediaType(imagePath);

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: buildComponentDetectionPrompt(language),
            },
          ],
        },
      ],
    });

    const content = response.content[0];
    const text = content.type === 'text' ? content.text : '{}';
    const result = this.parseJsonResponse<ComponentDetectionResult>(text);

    // Ensure defaults
    result.detectedProvider = result.detectedProvider || 'unknown';
    result.existingMitigations = result.existingMitigations || [];
    result.components = result.components || [];
    result.connections = result.connections || [];

    this.logger.log(`Detected provider: ${result.detectedProvider}`);
    this.logger.log(`Detected ${result.components.length} components`);
    this.logger.log(`Existing mitigations: ${result.existingMitigations.join(', ') || 'none'}`);

    return result;
  }

  async analyzeStrideForComponent(
    component: DetectedComponent,
    connections: DetectedConnection[],
    detectedProvider: string,
    existingMitigations: string[],
    language: 'pt-BR' | 'en-US' = 'pt-BR',
  ): Promise<StrideAnalysisResult> {
    this.logger.log(`Analyzing STRIDE for component: ${component.name} (language: ${language})`);

    const componentConnections = connections
      .filter((c) => c.from === component.id || c.to === component.id)
      .map((c) => `${c.from} -> ${c.to} (${c.protocol}${c.port ? ':' + c.port : ''}): ${c.description}`)
      .join('; ');

    const existingControls = component.existingSecurityControls?.join(', ') || 'none';

    const prompt = buildStrideAnalysisPrompt(
      component.name,
      component.type,
      component.description,
      componentConnections || 'No connections identified',
      component.provider || detectedProvider,
      existingControls,
      existingMitigations.join(', ') || 'none',
      component.replicaOf || 'none',
      language,
    );

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = response.content[0];
    const text = content.type === 'text' ? content.text : '{}';
    const result = this.parseJsonResponse<StrideAnalysisResult>(text);

    // Ensure threats array exists and limit countermeasures to 5
    result.threats = (result.threats || []).map(threat => ({
      ...threat,
      countermeasures: (threat.countermeasures || []).slice(0, 5),
    }));

    this.logger.log(`Found ${result.threats.length} threats for ${component.name}`);
    return result;
  }

  async performFullAnalysis(imagePath: string): Promise<FullAnalysisResult> {
    // Step 1: Detect components with provider and existing mitigations
    const detection = await this.detectComponents(imagePath);
    const { components, connections, detectedProvider, existingMitigations } = detection;

    // Step 2: Analyze STRIDE for each component (with context)
    const strideAnalysis: ComponentStrideAnalysis[] = [];

    for (const component of components) {
      // Replicas also get their own STRIDE analysis (replication-specific threats)
      if (component.replicaOf) {
        this.logger.log(`Analyzing replica ${component.name} (replica of ${component.replicaOf})`);
      }

      const strideResult = await this.analyzeStrideForComponent(
        component,
        connections,
        detectedProvider,
        existingMitigations,
      );

      const threatsWithCountermeasures: ThreatWithCountermeasures[] = strideResult.threats.map(
        (threat) => ({
          ...threat,
          countermeasures: threat.countermeasures || [],
        }),
      );

      strideAnalysis.push({
        componentId: component.id,
        threats: threatsWithCountermeasures,
      });
    }

    return {
      detectedProvider,
      existingMitigations,
      components,
      connections,
      strideAnalysis,
    };
  }

  private getMediaType(filePath: string): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' {
    const ext = path.extname(filePath).toLowerCase();
    const mediaTypes: Record<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    return mediaTypes[ext] || 'image/png';
  }

  private parseJsonResponse<T>(content: string): T {
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const jsonString = jsonMatch ? jsonMatch[1] : content;
      return JSON.parse(jsonString.trim());
    } catch (error) {
      this.logger.error(`Failed to parse JSON response: ${content}`);
      return {} as T;
    }
  }
}
