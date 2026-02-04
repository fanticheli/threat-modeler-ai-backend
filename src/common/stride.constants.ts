export const STRIDE_CATEGORIES = {
  SPOOFING: 'Spoofing',
  TAMPERING: 'Tampering',
  REPUDIATION: 'Repudiation',
  INFORMATION_DISCLOSURE: 'Information Disclosure',
  DENIAL_OF_SERVICE: 'Denial of Service',
  ELEVATION_OF_PRIVILEGE: 'Elevation of Privilege',
} as const;

export const STRIDE_DESCRIPTIONS = {
  SPOOFING: 'Falsificação de identidade - Quando um atacante se passa por outro usuário ou sistema',
  TAMPERING: 'Adulteração - Modificação não autorizada de dados',
  REPUDIATION: 'Repúdio - Negação de ter realizado uma ação',
  INFORMATION_DISCLOSURE: 'Divulgação de Informações - Exposição de dados a usuários não autorizados',
  DENIAL_OF_SERVICE: 'Negação de Serviço - Tornar um serviço indisponível',
  ELEVATION_OF_PRIVILEGE: 'Elevação de Privilégio - Ganhar acesso não autorizado a recursos',
};

export const COMPONENT_TYPES = [
  'user',
  'server',
  'database',
  'api',
  'loadbalancer',
  'firewall',
  'cache',
  'queue',
  'storage',
  'external_service',
] as const;

export const SEVERITY_LEVELS = ['low', 'medium', 'high', 'critical'] as const;

export type StrideCategory = (typeof STRIDE_CATEGORIES)[keyof typeof STRIDE_CATEGORIES];
export type ComponentType = (typeof COMPONENT_TYPES)[number];
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];
