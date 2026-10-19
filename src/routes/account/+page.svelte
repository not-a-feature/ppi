<script lang="ts">
  import { t, text } from '$lib/i18n';
  import { page } from '$app/state';
  import Feedback from '$lib/components/Feedback.svelte';
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
  <h2>{text(language, 'Sprache und Darstellung', 'Language and appearance')}</h2>

  <form method="POST" action="?/preferences">
    <div class="grid">
      <label for="language"
        >{text(language, 'Sprache', 'Language')}<select id="language" name="language"
          ><option value="de" selected={data.preferences.language === 'de'}>Deutsch</option><option
            value="en"
            selected={data.preferences.language === 'en'}>English</option
          ></select
        ></label
      >
      <label for="theme"
        >{text(language, 'Darstellung', 'Appearance')}<select id="theme" name="theme"
          ><option value="auto" selected={data.preferences.theme === 'auto'}
            >{text(language, 'Systemeinstellung', 'System preference')}</option
          ><option value="light" selected={data.preferences.theme === 'light'}
            >{text(language, 'Hell', 'Light')}</option
          ><option value="dark" selected={data.preferences.theme === 'dark'}
            >{text(language, 'Dunkel', 'Dark')}</option
          ></select
        ></label
      >
    </div>
    <button>{text(language, 'Einstellungen speichern', 'Save preferences')}</button>
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
  <h2>{t(language, 'Kontolöschung beantragen')}</h2>
  <p class="hint">
    {t(
      language,
      'Der Zugriff wird sofort gesperrt. Die Redaktion prüft die Löschung bzw. Anonymisierung. Eingereichte Protokolle und Versionen bleiben erhalten.'
    )}
  </p>
  <details>
    <summary>{t(language, 'Löschantrag stellen')}</summary>
    <form method="POST" action="?/deletion" style="margin-top:1rem">
      <label for="confirmation"
        >{t(language, 'Zur Bestätigung LÖSCHEN eingeben')}<input
          name="confirmation"
          id="confirmation"
          required
          pattern="LÖSCHEN"
          autocomplete="off"
        /></label
      ><button class="danger">{t(language, 'Kontolöschung beantragen')}</button>
    </form>
  </details>
</section>
