import { login } from '../../auth-handlers';

export async function POST(request: Request) { return login(request); }
