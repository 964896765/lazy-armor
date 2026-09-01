process.env.APP_ROLE = 'outbox-worker';
import { bootstrapWorker } from './worker-bootstrap';

void bootstrapWorker();
