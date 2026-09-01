process.env.APP_ROLE = 'api';
import { createHttpApp } from '../bootstrap';

async function bootstrap() {
  const app = await createHttpApp();
  await app.listen(Number(process.env.API_PORT ?? 3001));
}

void bootstrap();
