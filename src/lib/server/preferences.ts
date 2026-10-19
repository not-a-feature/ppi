import { transaction } from './db.js';
import { currentActor, DomainError, type Actor } from './domain/shared.js';

export type Preferences = {
  language: 'de' | 'en';
  theme: 'light' | 'dark' | 'auto';
};

export const defaultPreferences: Preferences = { language: 'de', theme: 'auto' };

export async function getPreferences(actor: Actor): Promise<Preferences> {
  return transaction(async (client) => {
    await currentActor(client, actor);
    const result = await client.query<Preferences>(
      'SELECT language,theme FROM user_preference WHERE user_id=$1',
      [actor.id]
    );
    return result.rowCount ? result.rows[0] : { ...defaultPreferences };
  });
}

export async function updatePreferences(
  actor: Actor,
  input: { language: string; theme: string }
): Promise<Preferences> {
  if (!['de', 'en'].includes(input.language) || !['light', 'dark', 'auto'].includes(input.theme)) {
    throw new DomainError(
      400,
      'invalid_preferences',
      'Please choose a valid language and appearance.'
    );
  }
  return transaction(async (client) => {
    await currentActor(client, actor);
    const result = await client.query<Preferences>(
      `INSERT INTO user_preference(user_id,language,theme) VALUES($1,$2,$3)
       ON CONFLICT(user_id) DO UPDATE SET language=EXCLUDED.language,theme=EXCLUDED.theme
       RETURNING language,theme`,
      [actor.id, input.language, input.theme]
    );
    return result.rows[0];
  });
}
