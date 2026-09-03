import { prepareEntrypointRole } from './prepare-app-role';
import { bootstrapWorker } from './worker-bootstrap';

prepareEntrypointRole('execution-worker');

void bootstrapWorker();
