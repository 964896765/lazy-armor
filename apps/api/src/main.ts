import { createHttpApp } from './bootstrap';
import { prepareEntrypointRole } from './entrypoints/prepare-app-role';

prepareEntrypointRole('api');

async function bootstrap() {
  const app = await createHttpApp();
  await app.listen(Number(process.env.API_PORT ?? 3001));
}

void bootstrap();
