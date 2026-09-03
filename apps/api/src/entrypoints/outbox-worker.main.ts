import { prepareEntrypointRole } from './prepare-app-role';
import { bootstrapWorker } from './worker-bootstrap';

prepareEntrypointRole('outbox-worker');

void bootstrapWorker();
