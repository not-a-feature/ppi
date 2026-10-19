<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { t } from '$lib/i18n';

  let {
    query,
    children,
    onSearch
  }: { query: string; children?: Snippet; onSearch: (form: FormData) => void } = $props();
  let draft = $state(untrack(() => query));
  let form: HTMLFormElement;
  let language = $derived(page.data.preferences?.language ?? 'de');

  function searchNow() {
    onSearch(new FormData(form));
  }

  afterNavigate(({ type, to }) => {
    if (!to || (type !== 'popstate' && type !== 'link')) return;
    draft = to.url.searchParams.get('q') ?? '';
  });
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
    <input id="q" name="q" type="search" maxlength="200" bind:value={draft} oninput={searchNow} />
  </label>
  {@render children?.()}
  <noscript><button class="secondary">{t(language, 'Suchen')}</button></noscript>
</form>

<style>
  form {
    margin-bottom: 24px;
  }
</style>
