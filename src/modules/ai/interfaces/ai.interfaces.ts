export interface DetectedComponent {
  id: string;
  name: string;
  type: string;
  provider?: string;
  description: string;
  availabilityZone?: string;
  existingSecurityControls?: string[];
  isAutoScaling?: boolean;
  replicaOf?: string;
}

export interface DetectedConnection {
  from: string;
  to: string;
  protocol: string;
  port?: string;
  description: string;
  encrypted?: boolean;
}

export interface ComponentDetectionResult {
  detectedProvider: string;
  existingMitigations: string[];
  components: DetectedComponent[];
  connections: DetectedConnection[];
}

export interface ThreatAnalysis {
  category: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  severityJustification?: string;
  existingMitigation?: string;
  affectedData?: string;
  countermeasures?: string[];
}

export interface StrideAnalysisResult {
  threats: ThreatAnalysis[];
}

export interface CountermeasuresResult {
  countermeasures: string[];
}

export interface ThreatWithCountermeasures extends ThreatAnalysis {
  countermeasures: string[];
}

export interface ComponentStrideAnalysis {
  componentId: string;
  threats: ThreatWithCountermeasures[];
}

export interface FullAnalysisResult {
  detectedProvider: string;
  existingMitigations: string[];
  components: DetectedComponent[];
  connections: DetectedConnection[];
  strideAnalysis: ComponentStrideAnalysis[];
}
