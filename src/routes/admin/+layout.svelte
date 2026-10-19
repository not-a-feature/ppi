<script lang="ts">
  import { t, text } from '$lib/i18n';
  import { page } from '$app/state';
  let language = $derived(page.data.preferences?.language ?? 'de');
  let { children } = $props();
  let links = $derived([
    ['/admin', t(language, 'Übersicht')],
    ['/admin/statistics', text(language, 'Statistik', 'Statistics')],
    ['/admin/review', t(language, 'Prüfung')],
    ['/admin/users', t(language, 'Konten')],
    ['/admin/catalogue', t(language, 'Katalog')],
    ['/admin/credits', t(language, 'Tokens')],
    ['/admin/reports', t(language, 'Meldungen')],
    ['/admin/jobs', t(language, 'Verarbeitung')],
    ['/admin/schedules', t(language, 'Zeitpläne')],
    ['/admin/settings', t(language, 'Einstellungen')],
    ['/admin/audit', 'Log']
  ]);
</script>

<nav class="admin-tabs" aria-label={t(language, 'Verwaltung')}>
  {#each links as [href, label]}<a
      {href}
      aria-current={(
        href === '/admin' ? page.url.pathname === href : page.url.pathname.startsWith(href)
      )
        ? 'page'
        : undefined}>{label}</a
    >{/each}
</nav>
{@render children()}
