import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
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
import { YoloService, YoloPredictionResponse } from './yolo.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private anthropic: Anthropic;

  constructor(
    private configService: ConfigService,
    private yoloService: YoloService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  // ---------------------------------------------------------------------------
  // Deteccao de componentes via Claude Vision (existente)
  // ---------------------------------------------------------------------------

  async detectComponents(
    imageData: { base64: string; mimeType: string },
    language: 'pt-BR' | 'en-US' = 'pt-BR',
  ): Promise<ComponentDetectionResult> {
    this.logger.log(`Detecting components from image (language: ${language})`);

    const base64Image = imageData.base64;
    const mediaType = imageData.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

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

  // ---------------------------------------------------------------------------
  // Analise STRIDE por componente (existente)
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Pipeline Hibrido: YOLO (modelo treinado) + Claude Vision
  // ---------------------------------------------------------------------------

  /**
   * Pipeline completo de analise com integracao YOLO + Claude Vision.
   *
   * Fluxo:
   *   1. YOLO detecta componentes (modelo treinado, rapido, bounding boxes precisos)
   *   2. Claude Vision detecta componentes (LLM, semantica rica, conexoes)
   *   3. Resultados sao mesclados: YOLO enriquece Claude com confianca e posicao
   *   4. STRIDE analisa cada componente mesclado
   *
   * Se o servico YOLO nao estiver disponivel, cai no fallback so com Claude.
   */
  async performFullAnalysis(
    imageData: { base64: string; mimeType: string },
    language: 'pt-BR' | 'en-US' = 'pt-BR',
  ): Promise<FullAnalysisResult> {
    // --------------------------------------------------
    // Fase 1: Deteccao YOLO (modelo treinado)
    // --------------------------------------------------
    let yoloResult: YoloPredictionResponse | null = null;
    const yoloAvailable = await this.yoloService.isAvailable();

    if (yoloAvailable) {
      this.logger.log('YOLO service disponivel - executando deteccao com modelo treinado');
      yoloResult = await this.yoloService.predict(
        imageData.base64,
        imageData.mimeType,
      );
      if (yoloResult) {
        this.logger.log(
          `YOLO: ${yoloResult.total_detections} deteccoes em ${yoloResult.inference_time_ms}ms`,
        );
      }
    } else {
      this.logger.log('YOLO service indisponivel - usando apenas Claude Vision');
    }

    // --------------------------------------------------
    // Fase 2: Deteccao Claude Vision (LLM)
    // --------------------------------------------------
    const claudeDetection = await this.detectComponents(imageData, language);
    const { components: claudeComponents, connections, detectedProvider, existingMitigations } =
      claudeDetection;

    // --------------------------------------------------
    // Fase 3: Merge dos resultados (YOLO + Claude)
    // --------------------------------------------------
    const mergedComponents = this.mergeDetections(claudeComponents, yoloResult);

    // --------------------------------------------------
    // Fase 4: Analise STRIDE para cada componente
    // --------------------------------------------------
    const strideAnalysis: ComponentStrideAnalysis[] = [];

    for (const component of mergedComponents) {
      if (component.replicaOf) {
        this.logger.log(`Analyzing replica ${component.name} (replica of ${component.replicaOf})`);
      }

      const strideResult = await this.analyzeStrideForComponent(
        component,
        connections,
        detectedProvider,
        existingMitigations,
        language,
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
      components: mergedComponents,
      connections,
      strideAnalysis,
      detectionMeta: {
        yoloAvailable,
        yoloDetections: yoloResult?.total_detections ?? 0,
        claudeDetections: claudeComponents.length,
        mergedComponents: mergedComponents.length,
        yoloInferenceTimeMs: yoloResult?.inference_time_ms,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Merge: combina deteccoes do YOLO com as do Claude
  // ---------------------------------------------------------------------------

  /**
   * Mescla deteccoes do YOLO com as do Claude Vision.
   *
   * Estrategia:
   *   - Claude Vision eh a fonte principal (semantica rica, conexoes, descricoes)
   *   - YOLO enriquece componentes do Claude com:
   *     - detectionSource: 'hybrid' (confirmado por ambos)
   *     - yoloConfidence: score de confianca do modelo treinado
   *   - Componentes detectados SOMENTE pelo YOLO (e nao pelo Claude) sao
   *     adicionados com detectionSource: 'yolo'
   *   - Componentes detectados SOMENTE pelo Claude mantêm detectionSource: 'claude'
   *
   * Matching: compara o type do YOLO (backend_type) com o type do Claude.
   * Se mais de um YOLO detection casa com o mesmo Claude component,
   * usa o de maior confianca.
   */
  private mergeDetections(
    claudeComponents: DetectedComponent[],
    yoloResult: YoloPredictionResponse | null,
  ): DetectedComponent[] {
    // Se YOLO nao disponivel, todos os componentes vem do Claude
    if (!yoloResult || yoloResult.detections.length === 0) {
      return claudeComponents.map((c) => ({
        ...c,
        detectionSource: 'claude' as const,
      }));
    }

    const yoloDetections = [...yoloResult.detections];
    const matchedYoloIndices = new Set<number>();

    // Marcar componentes do Claude com informacao do YOLO
    const merged: DetectedComponent[] = claudeComponents.map((claudeComp) => {
      // Procurar match no YOLO pelo tipo
      const matchIndex = yoloDetections.findIndex(
        (yolo, idx) =>
          !matchedYoloIndices.has(idx) && yolo.backend_type === claudeComp.type,
      );

      if (matchIndex !== -1) {
        matchedYoloIndices.add(matchIndex);
        const yoloMatch = yoloDetections[matchIndex];
        return {
          ...claudeComp,
          detectionSource: 'hybrid' as const,
          yoloConfidence: yoloMatch.confidence,
        };
      }

      return {
        ...claudeComp,
        detectionSource: 'claude' as const,
      };
    });

    // Componentes YOLO sem match no Claude -> adicionar como novos
    yoloDetections.forEach((yolo, idx) => {
      if (!matchedYoloIndices.has(idx) && yolo.confidence >= 0.08) {
        merged.push({
          id: `yolo-${yolo.class_name}-${idx}`,
          name: yolo.class_name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          type: yolo.backend_type,
          description: `Componente detectado pelo modelo YOLO treinado (confianca: ${(yolo.confidence * 100).toFixed(1)}%)`,
          detectionSource: 'yolo' as const,
          yoloConfidence: yolo.confidence,
        });
      }
    });

    this.logger.log(
      `Merge: ${merged.filter((c) => c.detectionSource === 'hybrid').length} hybrid, ` +
        `${merged.filter((c) => c.detectionSource === 'claude').length} claude-only, ` +
        `${merged.filter((c) => c.detectionSource === 'yolo').length} yolo-only`,
    );

    return merged;
  }

  // ---------------------------------------------------------------------------
  // Utilitarios
  // ---------------------------------------------------------------------------

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
