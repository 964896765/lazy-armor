import { memoryAuthClientMarker } from './auth-client-marker-id';
// Web keeps the marker in memory; IP/day budgets survive page resets.
export async function authClientMarker(){return memoryAuthClientMarker();}
