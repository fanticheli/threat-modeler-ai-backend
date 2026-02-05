import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://frontend:3000',
      'https://threat-modeler-ai-frontend.vercel.app',
      /\.vercel\.app$/,
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.setGlobalPrefix('api');

  await app.listen(3001);
  console.log('🛡️ Threat Modeler API running on http://localhost:3001');
}
bootstrap();
