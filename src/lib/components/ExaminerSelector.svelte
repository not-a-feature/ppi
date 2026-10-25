<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { t, type Language } from '#lib/i18n.js';
  import './selector.css';
  let {
    examiners,
    initialName = '',
    language
  }: {
    examiners: { id: string; name: string }[];
    initialName?: string;
    language: Language;
  } = $props();
  let name = $state(untrack(() => initialName));
  let selected = $state(Boolean(untrack(() => initialName)));
  let open = $state(false);
  let highlighted = $state(-1);
  let input = $state<HTMLInputElement>();
  let changeButton = $state<HTMLButtonElement>();
  let options = $derived(
    examiners.filter((examiner) =>
      examiner.name.toLocaleLowerCase('de-DE').includes(name.trim().toLocaleLowerCase('de-DE'))
    )
  );
  async function choose(value: string) {
    name = value.trim();
    if (!name) return;
    selected = true;
    open = false;
    await tick();
    changeButton?.focus();
  }
  async function edit() {
    selected = false;
    open = true;
    highlighted = -1;
    await tick();
    input?.focus();
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') open = false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open = true;
      highlighted = Math.max(
        0,
        Math.min(options.length - 1, highlighted + (event.key === 'ArrowDown' ? 1 : -1))
      );
      document
        .getElementById('examiner-option-' + highlighted)
        ?.scrollIntoView({ block: 'nearest' });
    }
    if (event.key === 'Enter' && open && name.trim()) {
      event.preventDefault();
      choose(options[highlighted]?.name ?? name);
    }
  }
</script>

<div
  class="selection-control"
  onfocusout={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) open = false;
  }}
>
  {#if selected}
    <input type="hidden" name="examinerName" value={name} />
    <div class="selected-option">
      <span class="selection-check" aria-hidden="true">✓</span>
      <span class="selection-name">{name}</span>
      <button bind:this={changeButton} type="button" class="change-selection" onclick={edit}
        >{t(language, 'Ändern')}</button
      >
    </div>
  {:else}
    <input
      bind:this={input}
      id="examinerName"
      name="examinerName"
      bind:value={name}
      required
      maxlength="200"
      autocomplete="off"
      role="combobox"
      aria-autocomplete="list"
      aria-label={t(language, 'Prüfende Person')}
      aria-expanded={open}
      aria-controls={open && options.length ? 'examiner-options' : undefined}
      aria-activedescendant={open && options.length && highlighted >= 0
        ? 'examiner-option-' + highlighted
        : undefined}
      onfocus={() => (open = true)}
      oninput={() => {
        open = true;
        highlighted = -1;
      }}
      onkeydown={keydown}
    />
    {#if open && options.length}
      <div
        class="selection-options"
        id="examiner-options"
        role="listbox"
        aria-label={t(language, 'Prüfende Personen')}
      >
        {#each options as examiner, index}
          <button
            id={'examiner-option-' + index}
            type="button"
            role="option"
            tabindex="-1"
            aria-selected={false}
            class:highlighted={highlighted === index}
            onpointerenter={() => (highlighted = index)}
            onclick={() => choose(examiner.name)}>{examiner.name}</button
          >
        {/each}
      </div>
    {/if}
  {/if}
</div>
