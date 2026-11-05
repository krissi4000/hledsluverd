import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// The car finder moved into the homepage filters (?bill=<slug>); keep old links working.
export const GET: RequestHandler = () => redirect(308, '/');
