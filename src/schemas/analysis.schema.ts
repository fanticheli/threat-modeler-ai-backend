import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AnalysisDocument = Analysis & Document;

@Schema()
export class Component {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  type: string;

  @Prop()
  provider?: string;

  @Prop()
  description: string;

  @Prop()
  availabilityZone?: string;

  @Prop({ type: [String] })
  existingSecurityControls?: string[];

  @Prop()
  isAutoScaling?: boolean;

  @Prop()
  replicaOf?: string;

  @Prop()
  detectionSource?: 'yolo' | 'claude' | 'hybrid';

  @Prop()
  yoloConfidence?: number;
}

@Schema()
export class Connection {
  @Prop({ required: true })
  from: string;

  @Prop({ required: true })
  to: string;

  @Prop()
  protocol: string;

  @Prop()
  port?: string;

  @Prop()
  description: string;

  @Prop()
  encrypted?: boolean;
}

@Schema()
export class Threat {
  @Prop({ required: true })
  category: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  severity: string;

  @Prop()
  severityJustification?: string;

  @Prop()
  existingMitigation?: string;

  @Prop()
  affectedData?: string;

  @Prop({ type: [String] })
  countermeasures: string[];
}

@Schema()
export class StrideAnalysisItem {
  @Prop({ required: true })
  componentId: string;

  @Prop({ type: [Threat] })
  threats: Threat[];
}

@Schema()
export class Summary {
  @Prop({ default: 0 })
  totalComponents: number;

  @Prop({ default: 0 })
  totalThreats: number;

  @Prop({ default: 0 })
  criticalThreats: number;

  @Prop({ default: 0 })
  highThreats: number;

  @Prop({ default: 0 })
  mediumThreats: number;

  @Prop({ default: 0 })
  lowThreats: number;
}

@Schema()
export class Progress {
  @Prop({ default: 'waiting' })
  step: 'waiting' | 'detecting_components' | 'analyzing_stride' | 'generating_report' | 'completed' | 'failed';

  @Prop({ default: '' })
  message: string;

  @Prop({ default: 0 })
  percentage: number;

  @Prop({ default: 0 })
  currentComponent: number;

  @Prop({ default: 0 })
  totalComponents: number;

  @Prop()
  updatedAt?: Date;
}

@Schema()
export class DetectionMeta {
  @Prop()
  yoloAvailable: boolean;

  @Prop({ default: 0 })
  yoloDetections: number;

  @Prop({ default: 0 })
  claudeDetections: number;

  @Prop({ default: 0 })
  mergedComponents: number;

  @Prop()
  yoloInferenceTimeMs?: number;
}

@Schema({ timestamps: true })
export class Analysis {
  @Prop({ required: true })
  imageUrl: string;

  @Prop({ required: true })
  imageName: string;

  @Prop()
  imageBase64?: string;

  @Prop()
  imageMimeType?: string;

  @Prop({ default: 'pt-BR' })
  language: 'pt-BR' | 'en-US';

  @Prop({ default: 'processing' })
  status: 'processing' | 'completed' | 'failed';

  @Prop()
  error?: string;

  @Prop()
  detectedProvider?: string;

  @Prop({ type: [String] })
  existingMitigations?: string[];

  @Prop({ type: [Component] })
  components: Component[];

  @Prop({ type: [Connection] })
  connections: Connection[];

  @Prop({ type: [StrideAnalysisItem] })
  strideAnalysis: StrideAnalysisItem[];

  @Prop({ type: Summary })
  summary: Summary;

  @Prop({ type: Progress })
  progress: Progress;

  @Prop({ type: DetectionMeta })
  detectionMeta?: DetectionMeta;

  @Prop()
  executiveSummary?: string;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const AnalysisSchema = SchemaFactory.createForClass(Analysis);
