export class ComponentDto {
  id: string;
  name: string;
  type: string;
  description: string;
  position?: {
    x: number;
    y: number;
  };
}

export class ConnectionDto {
  from: string;
  to: string;
  protocol: string;
  description: string;
}

export class ThreatDto {
  category: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  countermeasures: string[];
}

export class StrideAnalysisItemDto {
  componentId: string;
  threats: ThreatDto[];
}

export class SummaryDto {
  totalComponents: number;
  totalThreats: number;
  criticalThreats: number;
  highThreats: number;
  mediumThreats: number;
  lowThreats: number;
}

export class AnalysisResponseDto {
  _id: string;
  imageUrl: string;
  imageName: string;
  status: 'processing' | 'completed' | 'failed';
  error?: string;
  components: ComponentDto[];
  connections: ConnectionDto[];
  strideAnalysis: StrideAnalysisItemDto[];
  summary: SummaryDto;
  createdAt: Date;
  updatedAt: Date;
}

export class AnalysisListItemDto {
  _id: string;
  imageName: string;
  status: 'processing' | 'completed' | 'failed';
  summary: SummaryDto;
  createdAt: Date;
}
