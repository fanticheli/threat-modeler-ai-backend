export const COUNTERMEASURES_PROMPT = `Você é um especialista em segurança de software. Forneça contramedidas específicas e práticas para mitigar a seguinte ameaça:

**Componente:** {component_name}
**Tipo do Componente:** {component_type}
**Categoria STRIDE:** {category}
**Descrição da Ameaça:** {threat_description}
**Severidade:** {severity}

Forneça uma lista de contramedidas práticas e implementáveis para mitigar esta ameaça específica.

As contramedidas devem ser:
1. Específicas para o tipo de componente
2. Práticas e implementáveis
3. Ordenadas por prioridade/efetividade
4. Incluir tanto medidas técnicas quanto processuais quando aplicável

IMPORTANTE:
- Seja específico e prático
- Evite recomendações genéricas
- Considere o contexto do componente
- Retorne APENAS o JSON válido, sem texto adicional

Formato de resposta esperado:
{
  "countermeasures": [
    "Contramedida específica 1",
    "Contramedida específica 2",
    "Contramedida específica 3"
  ]
}`;

export const buildCountermeasuresPrompt = (
  componentName: string,
  componentType: string,
  category: string,
  threatDescription: string,
  severity: string,
): string => {
  return COUNTERMEASURES_PROMPT
    .replace('{component_name}', componentName)
    .replace('{component_type}', componentType)
    .replace('{category}', category)
    .replace('{threat_description}', threatDescription)
    .replace('{severity}', severity);
};
