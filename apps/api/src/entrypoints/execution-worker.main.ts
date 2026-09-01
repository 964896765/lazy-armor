process.env.APP_ROLE = 'execution-worker';
import { bootstrapWorker } from './worker-bootstrap';

void bootstrapWorker();
