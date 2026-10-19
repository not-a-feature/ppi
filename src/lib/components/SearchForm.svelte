<script lang="ts">
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { t } from '$lib/i18n';

  let { query, children }: { query: string; children?: Snippet } = $props();
  let draft = $state(untrack(() => query));
  let form: HTMLFormElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let language = $derived(page.data.preferences?.language ?? 'de');

  function searchNow() {
    clearTimeout(timer);
    const url = new URL(page.url);
    url.search = '';
    for (const [name, value] of new FormData(form)) {
      if (typeof value === 'string' && value.trim()) url.searchParams.append(name, value.trim());
    }
    if (url.href !== page.url.href)
      void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }

  afterNavigate(({ type, to }) => {
    if (!to || (type !== 'popstate' && type !== 'link')) return;
    clearTimeout(timer);
    draft = to.url.searchParams.get('q') ?? '';
  });
  onDestroy(() => clearTimeout(timer));
</script>

<form
  method="GET"
  role="search"
  class="search"
  bind:this={form}
  onsubmit={(event) => {
    event.preventDefault();
    searchNow();
  }}
  onchange={(event) => {
    if (event.target instanceof HTMLSelectElement) searchNow();
  }}
>
  <label for="q">
    {t(language, 'Suchen')}
    <input
      id="q"
      name="q"
      type="search"
      maxlength="200"
      bind:value={draft}
      oninput={() => {
        clearTimeout(timer);
        timer = setTimeout(searchNow, 250);
      }}
    />
  </label>
  {@render children?.()}
  <noscript><button class="secondary">{t(language, 'Suchen')}</button></noscript>
</form>

<style>
  form {
    margin-bottom: 24px;
  }
</style>
