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
  // Retry com backoff exponencial + delay entre chamadas
  // ---------------------------------------------------------------------------

  private async callWithRetry<T>(
    fn: () => Promise<T>,
    label: string,
    maxRetries = 3,
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const is529 = error?.status === 529 || String(error).includes('529');
        const isRetryable = is529 || error?.status === 500 || error?.status === 503;

        if (!isRetryable || attempt === maxRetries) {
          throw error;
        }

        const delay = attempt * 5000; // 5s, 10s, 15s
        this.logger.warn(
          `[Retry]    ⟳ ${label} — tentativa ${attempt}/${maxRetries} falhou (${error?.status || 'error'}), aguardando ${delay / 1000}s...`,
        );
        await this.sleep(delay);
      }
    }
    throw new Error('Unreachable');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

    const response = await this.callWithRetry(
      () =>
        this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 16384,
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
        }),
      'Claude Vision',
    );

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

    const response = await this.callWithRetry(
      () =>
        this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      `STRIDE ${component.name}`,
    );

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
    const pipelineStart = Date.now();
    this.logger.log(`[Pipeline] ▶ Iniciando analise (idioma: ${language})`);

    // --------------------------------------------------
    // Fase 1: Deteccao YOLO (modelo treinado)
    // --------------------------------------------------
    this.logger.log('[Pipeline] ▶ Fase 1: YOLO Service...');
    let yoloResult: YoloPredictionResponse | null = null;
    const yoloAvailable = await this.yoloService.isAvailable();

    if (yoloAvailable) {
      const yoloStart = Date.now();
      yoloResult = await this.yoloService.predict(
        imageData.base64,
        imageData.mimeType,
      );
      const yoloTime = Date.now() - yoloStart;
      if (yoloResult) {
        this.logger.log(
          `[YOLO]     ✓ ${yoloResult.total_detections} deteccoes em ${yoloResult.inference_time_ms}ms (round-trip: ${yoloTime}ms)`,
        );
      } else {
        this.logger.warn('[YOLO]     ✗ Falha na deteccao (retorno nulo)');
      }
    } else {
      this.logger.log('[YOLO]     ✗ Servico indisponivel — fallback para Claude Vision');
    }

    // --------------------------------------------------
    // Fase 2: Deteccao Claude Vision (LLM)
    // --------------------------------------------------
    this.logger.log('[Pipeline] ▶ Fase 2: Claude Vision...');
    const claudeStart = Date.now();
    const claudeDetection = await this.detectComponents(imageData, language);
    const claudeTime = Date.now() - claudeStart;
    const { components: claudeComponents, connections, detectedProvider, existingMitigations } =
      claudeDetection;
    this.logger.log(
      `[Claude]   ✓ ${claudeComponents.length} componentes detectados em ${claudeTime}ms (provider: ${detectedProvider})`,
    );

    // --------------------------------------------------
    // Fase 3: Merge dos resultados (YOLO + Claude)
    // --------------------------------------------------
    this.logger.log('[Pipeline] ▶ Fase 3: Merge...');
    const mergedComponents = this.mergeDetections(claudeComponents, yoloResult);

    // --------------------------------------------------
    // Fase 4: Analise STRIDE para cada componente (paralelo em batches)
    // --------------------------------------------------
    const STRIDE_CONCURRENCY = 5;
    this.logger.log(
      `[Pipeline] ▶ Fase 4: STRIDE (${mergedComponents.length} componentes, ${STRIDE_CONCURRENCY} paralelos)...`,
    );

    const strideTasks = mergedComponents.map((component) => async (): Promise<ComponentStrideAnalysis> => {
      const strideStart = Date.now();

      const strideResult = await this.analyzeStrideForComponent(
        component,
        connections,
        detectedProvider,
        existingMitigations,
        language,
      );
      const strideTime = Date.now() - strideStart;

      const threatsWithCountermeasures: ThreatWithCountermeasures[] = strideResult.threats.map(
        (threat) => ({
          ...threat,
          countermeasures: threat.countermeasures || [],
        }),
      );

      const sevCounts = { critical: 0, high: 0, medium: 0, low: 0 };
      for (const t of threatsWithCountermeasures) {
        if (t.severity in sevCounts) sevCounts[t.severity]++;
      }
      const sevBreakdown = Object.entries(sevCounts)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');

      this.logger.log(
        `[STRIDE]   ✓ ${component.name} — ${threatsWithCountermeasures.length} ameacas (${sevBreakdown}) [${strideTime}ms]`,
      );

      return { componentId: component.id, threats: threatsWithCountermeasures };
    });

    const strideAnalysis: ComponentStrideAnalysis[] = [];
    for (let i = 0; i < strideTasks.length; i += STRIDE_CONCURRENCY) {
      const batch = strideTasks.slice(i, i + STRIDE_CONCURRENCY);
      const batchNum = Math.floor(i / STRIDE_CONCURRENCY) + 1;
      const totalBatches = Math.ceil(strideTasks.length / STRIDE_CONCURRENCY);
      this.logger.log(`[STRIDE]   ▶ Batch ${batchNum}/${totalBatches} (${batch.length} componentes em paralelo)`);
      const batchResults = await Promise.all(batch.map((fn) => fn()));
      strideAnalysis.push(...batchResults);
    }

    // Resumo final do pipeline
    const totalThreats = strideAnalysis.reduce((sum, s) => sum + s.threats.length, 0);
    const allThreats = strideAnalysis.flatMap((s) => s.threats);
    const finalSev = {
      critical: allThreats.filter((t) => t.severity === 'critical').length,
      high: allThreats.filter((t) => t.severity === 'high').length,
      medium: allThreats.filter((t) => t.severity === 'medium').length,
      low: allThreats.filter((t) => t.severity === 'low').length,
    };
    const pipelineTime = Date.now() - pipelineStart;
    this.logger.log(
      `[Pipeline] ✓ Analise completa! ${mergedComponents.length} componentes, ${totalThreats} ameacas ` +
        `(${finalSev.critical} critical, ${finalSev.high} high, ${finalSev.medium} medium, ${finalSev.low} low) [${pipelineTime}ms]`,
    );

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

    const hybridComps = merged.filter((c) => c.detectionSource === 'hybrid');
    const claudeOnlyComps = merged.filter((c) => c.detectionSource === 'claude');
    const yoloOnlyComps = merged.filter((c) => c.detectionSource === 'yolo');

    this.logger.log(
      `[Merge]    ✓ ${merged.length} componentes (${hybridComps.length} hybrid, ${claudeOnlyComps.length} claude, ${yoloOnlyComps.length} yolo)`,
    );
    if (hybridComps.length > 0) {
      this.logger.log(`[Merge]      hybrid: ${hybridComps.map((c) => c.name).join(', ')}`);
    }
    if (yoloOnlyComps.length > 0) {
      this.logger.log(`[Merge]      yolo-only: ${yoloOnlyComps.map((c) => c.name).join(', ')}`);
    }

    return merged;
  }

  // ---------------------------------------------------------------------------
  // Resumo Executivo em linguagem natural
  // ---------------------------------------------------------------------------

  async generateExecutiveSummary(params: {
    components: { name: string; type: string }[];
    summary: { totalThreats: number; criticalThreats: number; highThreats: number; mediumThreats: number; lowThreats: number };
    detectedProvider: string;
    language: 'pt-BR' | 'en-US';
  }): Promise<string> {
    this.logger.log('Generating executive summary...');

    const lang = params.language === 'pt-BR' ? 'português brasileiro' : 'English';
    const componentList = params.components.map(c => `${c.name} (${c.type})`).join(', ');
    const { totalThreats, criticalThreats, highThreats, mediumThreats, lowThreats } = params.summary;

    const prompt = `You are a cybersecurity expert writing an executive summary for a non-technical audience.

Architecture analyzed: provider ${params.detectedProvider}, with the following components: ${componentList}.

Threat analysis results:
- Total threats: ${totalThreats}
- Critical: ${criticalThreats}
- High: ${highThreats}
- Medium: ${mediumThreats}
- Low: ${lowThreats}

Write 2-3 paragraphs in ${lang}, in simple language that a business executive can understand.
Explain what was found, which areas need the most attention, and a general recommendation.
Do NOT use markdown, bullet points, or technical jargon. Write in plain text paragraphs only.`;

    try {
      const response = await this.callWithRetry(
        () =>
          this.anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
          }),
        'Executive Summary',
      );

      const content = response.content[0];
      const text = content.type === 'text' ? content.text : '';
      this.logger.log('Executive summary generated successfully');
      return text.trim();
    } catch (error) {
      this.logger.error(`Failed to generate executive summary: ${error.message}`);
      return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Utilitarios
  // ---------------------------------------------------------------------------

  private parseJsonResponse<T>(content: string): T {
    let jsonString = content.trim();

    // 1. Extrair conteúdo de markdown code block se presente (```json ... ``` ou ``` ... ```)
    const codeBlockMatch = jsonString.match(/```(?:json|typescript|js)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      jsonString = codeBlockMatch[1].trim();
    } else {
      // Fallback: remover fences individuais (abertura ou fechamento sem par)
      jsonString = jsonString.replace(/^```(?:json|typescript|js)?\s*\n?/i, '');
      jsonString = jsonString.replace(/\n?\s*```\s*$/i, '');
      jsonString = jsonString.trim();
    }

    // 2. Extrair JSON: encontrar o primeiro { ou [ e pegar tudo a partir dele
    const firstBrace = jsonString.indexOf('{');
    const firstBracket = jsonString.indexOf('[');
    let startIdx = -1;
    if (firstBrace === -1) startIdx = firstBracket;
    else if (firstBracket === -1) startIdx = firstBrace;
    else startIdx = Math.min(firstBrace, firstBracket);

    if (startIdx > 0) {
      jsonString = jsonString.substring(startIdx);
    }

    // 3. Tentar parse direto
    try {
      return JSON.parse(jsonString);
    } catch {
      // ignorar, tentar reparar
    }

    // 4. Reparar JSON truncado: fechar colchetes e chaves faltantes
    try {
      let repaired = jsonString;

      // Remover trailing comma antes de fechar
      repaired = repaired.replace(/,\s*$/, '');

      // Remover string truncada no final (aberta sem fechar)
      repaired = repaired.replace(/,?\s*"[^"]*$/, '');

      // Contar chaves e colchetes abertos
      let openBraces = 0;
      let openBrackets = 0;
      let inString = false;
      let escape = false;

      for (const char of repaired) {
        if (escape) { escape = false; continue; }
        if (char === '\\') { escape = true; continue; }
        if (char === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (char === '{') openBraces++;
        if (char === '}') openBraces--;
        if (char === '[') openBrackets++;
        if (char === ']') openBrackets--;
      }

      // Fechar o que ficou aberto
      while (openBrackets > 0) { repaired += ']'; openBrackets--; }
      while (openBraces > 0) { repaired += '}'; openBraces--; }

      const result = JSON.parse(repaired);
      this.logger.warn(`[Parser] JSON reparado (truncado pelo modelo) — dados parciais recuperados`);
      return result;
    } catch {
      // ignorar, tentar ultima alternativa
    }

    // 5. Ultima tentativa: extrair o maior bloco JSON valido
    try {
      // Encontrar o ultimo } ou ] valido de tras pra frente
      for (let end = jsonString.length; end > 0; end--) {
        const char = jsonString[end - 1];
        if (char === '}' || char === ']') {
          try {
            const result = JSON.parse(jsonString.substring(0, end));
            this.logger.warn(`[Parser] JSON parcial recuperado (cortado na posicao ${end})`);
            return result;
          } catch {
            continue;
          }
        }
      }
    } catch {
      // ignorar
    }

    this.logger.error(`[Parser] Falha ao parsear JSON — resposta descartada: ${content.substring(0, 200)}...`);
    return {} as T;
  }
}
