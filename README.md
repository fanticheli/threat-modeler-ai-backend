# Threat Modeler AI - Backend

API para o Threat Modeler AI, uma ferramenta de modelagem de ameacas automatizada usando pipeline hibrido (YOLO + Claude Vision) e metodologia STRIDE.

## Tech Stack

- **NestJS** - Node.js Framework
- **TypeScript** - Type Safety
- **MongoDB** - Database
- **BullMQ + Redis** - Job Queue
- **Claude Vision** - AI Analysis (Anthropic)
- **PDFKit** - PDF Generation

## Funcionalidades

- Upload e armazenamento de imagens
- Deteccao hibrida de componentes (YOLO + Claude Vision)
- Analise STRIDE por componente
- Processamento assíncrono com fila
- Geração de relatórios (PDF, JSON, Markdown)
- Suporte multi-idioma (pt-BR, en-US)

## Pré-requisitos

- Node.js 18+
- MongoDB
- Redis
- Chave de API da Anthropic

## Instalação

```bash
# Clone o repositório
git clone https://github.com/fanticheli/threat-modeler-ai-backend.git
cd threat-modeler-ai-backend

# Instale as dependências
npm install

# Configure as variáveis de ambiente
cp .env.example .env

# Inicie em desenvolvimento
npm run start:dev
```

## Variáveis de Ambiente

```env
ANTHROPIC_API_KEY=sua_chave_aqui
MONGODB_URI=mongodb://localhost:27017/threat-modeler
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run start:dev` | Inicia em modo desenvolvimento |
| `npm run build` | Build de produção |
| `npm run start:prod` | Inicia servidor de produção |

## Docker

```bash
# Build da imagem
docker build -t threat-modeler-backend .

# Executar (requer MongoDB e Redis)
docker run -p 3001:3001 \
  -e ANTHROPIC_API_KEY=sua_chave \
  -e MONGODB_URI=mongodb://host:27017/threat-modeler \
  -e REDIS_HOST=redis_host \
  threat-modeler-backend
```

## Docker Compose (Dev)

```bash
# Inicia backend + MongoDB + Redis
docker-compose up -d
```

## API Endpoints

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/upload` | Upload de imagem |
| POST | `/api/upload/validate` | Validar qualidade da imagem |
| GET | `/api/upload/image/:id` | Servir imagem por ID |
| GET | `/api/analysis` | Listar análises |
| GET | `/api/analysis/queue-status` | Status da fila de processamento |
| GET | `/api/analysis/:id` | Buscar análise |
| POST | `/api/analysis/:id/process` | Iniciar processamento |
| GET | `/api/analysis/:id/progress` | Status do progresso |
| GET | `/api/analysis/:id/progress/stream` | SSE de progresso |
| DELETE | `/api/analysis/:id` | Excluir análise |
| GET | `/api/report/:id/pdf` | Download PDF |
| GET | `/api/report/:id/json` | Download JSON |
| GET | `/api/report/:id/markdown` | Download Markdown |

## Estrutura

```
src/
├── main.ts                    # Entry point
├── app.module.ts              # Root module
├── modules/
│   ├── upload/                # Upload de imagens
│   ├── analysis/              # CRUD de análises
│   ├── ai/                    # Pipeline hibrido (YOLO + Claude Vision)
│   │   ├── yolo.service.ts    # Client HTTP para YOLO service
│   │   └── prompts/           # Prompts de IA
│   ├── queue/                 # BullMQ processor
│   └── report/                # Geração de relatórios
└── schemas/                   # Mongoose schemas
```

## Repositórios Relacionados

- [threat-modeler-ai-frontend](https://github.com/fanticheli/threat-modeler-ai-frontend) - UI React + Vite

## Licença

MIT
