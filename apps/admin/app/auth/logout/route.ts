import { logout } from '../../auth-handlers';

export async function POST(request: Request) { return logout(request); }
