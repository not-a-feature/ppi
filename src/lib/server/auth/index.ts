import { getRequestEvent } from '$app/server';
import { building } from '$app/env';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { createAuth } from './config';

export const auth = createAuth([sveltekitCookies(getRequestEvent)], building);
