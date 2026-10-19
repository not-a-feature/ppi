<script lang="ts">
  import { t } from '$lib/i18n';
  import { page } from '$app/state';
  import Feedback from '$lib/components/Feedback.svelte';
  let language = $derived(page.data.preferences?.language ?? 'de');

  let { data, form } = $props();
  let titles: Record<string, string> = $derived({
    login: t(language, 'Anmeldung'),
    register: t(language, 'Registrierung'),
    'verify-email': t(language, 'E-Mail bestätigen.'),
    'forgot-password': t(language, 'Passwort vergessen?'),
    'reset-password': t(language, 'Neues Passwort setzen.')
  });
  let descriptions: Record<string, string> = $derived({
    'verify-email': t(
      language,
      'Öffne den Link in deiner studentischen E-Mail. Du kannst hier einen neuen Link anfordern.'
    ),
    'forgot-password': t(language, 'Wir senden dir einen Link an deine studentische E-Mail.')
  });
</script>

<div class="auth">
  <div class="card">
    <h1>{titles[data.flow]}</h1>
    {#if ['verify-email', 'forgot-password'].includes(data.flow)}<p class="muted">
        {descriptions[data.flow]}
      </p>{/if}<Feedback {form} />{#if data.verificationError}<p role="alert" class="notice error">
        {t(
          language,
          'Der Bestätigungslink ist ungültig oder abgelaufen. Bitte einen neuen Link anfordern.'
        )}
      </p>{/if}
    <form method="POST" name={`ppi-${data.flow}`} autocomplete="on">
      {#if data.flow !== 'reset-password'}<label for="zx"
          >{t(language, 'zx-Kennung')}<input
            id="zx"
            name="zx"
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
            placeholder="zxabc12"
            pattern={'zx[a-zA-Z]{3}[0-9]{2}'}
            maxlength="7"
            required
            value={form?.zx ?? ''}
          /><small>@student.uni-tuebingen.de</small></label
        >{/if}
      {#if ['login', 'register', 'reset-password'].includes(data.flow)}<label for="password"
          >{t(language, 'Passwort')}<input
            id="password"
            name="password"
            type="password"
            autocomplete={data.flow === 'login' ? 'current-password' : 'new-password'}
            minlength={data.flow === 'login' ? 1 : 12}
            maxlength="128"
            required
          />{#if data.flow !== 'login'}<small>{t(language, 'Mindestens 12 Zeichen.')}</small
            >{/if}</label
        >{/if}
      {#if data.flow === 'reset-password'}<input
          type="hidden"
          name="token"
          value={data.token ?? ''}
        />{#if !data.token}<p class="notice warning">
            {t(language, 'Bitte diese Seite über den Link aus der E-Mail öffnen.')}
          </p>{/if}{/if}
      <button disabled={data.flow === 'reset-password' && !data.token}
        >{data.flow === 'login'
          ? t(language, 'Anmelden')
          : data.flow === 'register'
            ? t(language, 'Konto erstellen')
            : data.flow === 'reset-password'
              ? t(language, 'Passwort speichern')
              : t(language, 'Link anfordern')}</button
      >
    </form>
    {#if data.flow === 'register' && form?.message}<div class="split">
        <a href="/verify-email">{t(language, 'E-Mail bestätigen')}</a>
        <a href="/forgot-password">{t(language, 'Passwort vergessen?')}</a>
      </div>{/if}
    {#if data.flow === 'login'}<div class="split">
        <a href="/forgot-password">{t(language, 'Passwort vergessen?')}</a><a href="/verify-email"
          >{t(language, 'E-Mail bestätigen')}</a
        >
      </div>
      <hr class="divider" />
      <p class="hint">
        {t(language, 'Noch kein Konto?')}
        <a href="/register">{t(language, 'Jetzt registrieren')}</a>
      </p>{:else}<a href="/login">{t(language, 'Zur Anmeldung')}</a>{/if}
  </div>
</div>
