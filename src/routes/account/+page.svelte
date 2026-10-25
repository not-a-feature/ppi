<script lang="ts">
  import { t } from '#lib/i18n.js';
  import { page } from '$app/state';
  import Feedback from '#lib/components/Feedback.svelte';
  let language = $derived(page.data.preferences?.language ?? 'de');
  let { data, form } = $props();
</script>

<div class="page-head">
  <div>
    <h1>{t(language, 'Dein Konto')}</h1>
    <p>{data.current.email}</p>
  </div>
  <form method="POST" action="?/signout">
    <button class="secondary">{t(language, 'Abmelden')}</button>
  </form>
</div>
<Feedback {form} />
<section class="card narrow" style="margin-bottom:2rem">
  <h2>{t(language, 'Sprache und Darstellung')}</h2>

  <form method="POST" action="?/preferences">
    <div class="grid">
      <label for="language"
        >{t(language, 'Sprache')}<select id="language" name="language"
          ><option value="de" selected={data.preferences.language === 'de'}>Deutsch</option><option
            value="en"
            selected={data.preferences.language === 'en'}>English</option
          ></select
        ></label
      >
      <label for="theme"
        >{t(language, 'Darstellung')}<select id="theme" name="theme"
          ><option value="auto" selected={data.preferences.theme === 'auto'}
            >{t(language, 'Systemeinstellung')}</option
          ><option value="light" selected={data.preferences.theme === 'light'}
            >{t(language, 'Hell')}</option
          ><option value="dark" selected={data.preferences.theme === 'dark'}
            >{t(language, 'Dunkel')}</option
          ></select
        ></label
      >
    </div>
    <button>{t(language, 'Einstellungen speichern')}</button>
  </form>
</section>
<section class="card narrow">
  <h2>{t(language, 'Passwort ändern')}</h2>
  <form method="POST" action="?/password" name="change-password" autocomplete="on">
    <input
      type="hidden"
      name="username"
      autocomplete="username"
      value={data.current.email.split('@')[0]}
    />
    <label for="currentPassword"
      >{t(language, 'Aktuelles Passwort')}<input
        type="password"
        name="currentPassword"
        id="currentPassword"
        autocomplete="current-password"
        required
      /></label
    ><label for="newPassword"
      >{t(language, 'Neues Passwort')}<input
        type="password"
        name="newPassword"
        id="newPassword"
        minlength="12"
        maxlength="128"
        autocomplete="new-password"
        required
      /><small>{t(language, 'Mindestens 12 Zeichen. Andere Sitzungen werden abgemeldet.')}</small
      ></label
    ><button>{t(language, 'Passwort speichern')}</button>
  </form>
</section>
<section class="card narrow" style="margin-top:2rem">
  <h2>{t(language, 'Konto löschen')}</h2>
  <p class="hint">
    {t(
      language,
      'Zugangsdaten und Profilangaben werden sofort entfernt. Protokolle und Buchungen bleiben ohne dein Anmeldekonto erhalten. Die Löschung kann nicht rückgängig gemacht werden.'
    )}
  </p>
  <details>
    <summary>{t(language, 'Konto löschen')}</summary>
    <form method="POST" action="?/deletion" style="margin-top:1rem">
      <label for="confirmation"
        >{t(language, 'Zur Bestätigung LÖSCHEN eingeben')}<input
          name="confirmation"
          id="confirmation"
          required
          pattern="LÖSCHEN"
          autocomplete="off"
        /></label
      ><button class="danger">{t(language, 'Konto endgültig löschen')}</button>
    </form>
  </details>
</section>
