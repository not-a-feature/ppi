<script lang="ts">
  import { t } from '$lib/i18n';
  import { page } from '$app/state';
  import { afterNavigate } from '$app/navigation';
  import { onMount } from 'svelte';
  let tabBar: HTMLElement;
  function revealCurrentTab() {
    const current = tabBar.querySelector<HTMLElement>('[aria-current="page"]');
    if (current) {
      const left =
        current.getBoundingClientRect().left -
        tabBar.getBoundingClientRect().left +
        tabBar.scrollLeft;
      tabBar.scrollLeft = left - (tabBar.clientWidth - current.offsetWidth) / 2;
    }
  }
  afterNavigate(revealCurrentTab);
  onMount(() => {
    const observer = new ResizeObserver(revealCurrentTab);
    observer.observe(tabBar);
    return () => observer.disconnect();
  });
  let language = $derived(page.data.preferences?.language ?? 'de');
  let { children } = $props();
  let groups = $derived([
    [
      ['/admin', t(language, 'Übersicht')],
      ['/admin/statistics', t(language, 'Statistik')]
    ],
    [
      ['/admin/review', t(language, 'Prüfung')],
      ['/admin/reports', t(language, 'Meldungen')],
      ['/admin/catalogue', t(language, 'Katalog')]
    ],
    [
      ['/admin/users', t(language, 'Konten')],
      ['/admin/credits', t(language, 'Tokens')]
    ],
    [
      ['/admin/jobs', t(language, 'Verarbeitung')],
      ['/admin/schedules', t(language, 'Zeitpläne')],
      ['/admin/audit', 'Log'],
      ['/admin/settings', t(language, 'Einstellungen')]
    ]
  ]);
</script>

<nav bind:this={tabBar} class="admin-tabs" aria-label={t(language, 'Verwaltung')}>
  {#each groups as links}
    <div class="admin-tab-group">
      {#each links as [href, label]}<a
          {href}
          aria-current={(
            href === '/admin' ? page.url.pathname === href : page.url.pathname.startsWith(href)
          )
            ? 'page'
            : undefined}>{label}</a
        >{/each}
    </div>
  {/each}
</nav>
{@render children()}

<style>
  .admin-tab-group {
    display: flex;
    flex: none;
    flex-wrap: nowrap;
    align-items: center;
    gap: 6px;
  }
  .admin-tab-group + .admin-tab-group::before {
    content: '';
    flex: 0 0 1px;
    height: 18px;
    margin-inline: 6px;
    background: var(--line);
  }
</style>
