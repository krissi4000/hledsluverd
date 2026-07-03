import { env } from '$env/dynamic/private';
import { createDb } from './client';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
export const db = createDb(env.DATABASE_URL);
