<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { t } from '#lib/i18n.js';

  let {
    query,
    children,
    onSearch
  }: { query: string; children?: Snippet; onSearch: (form: FormData) => void } = $props();
  let form: HTMLFormElement;
  let language = $derived(page.data.preferences?.language ?? 'de');

  function searchNow() {
    onSearch(new FormData(form));
  }
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
    <input id="q" name="q" type="search" maxlength="200" value={query} oninput={searchNow} />
  </label>
  {@render children?.()}
  <noscript><button class="secondary">{t(language, 'Suchen')}</button></noscript>
</form>

<style>
  form {
    margin-bottom: 24px;
  }
</style>
