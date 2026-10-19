<script module lang="ts">
  export type LectureSelection = { lectureId: string; newLectureName: string };
  export type UploadLecture = {
    id: string;
    name: string;
    archived: boolean;
    approval_status?: string;
  };
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { t, type Language, type MessageKey } from '$lib/i18n';
  let {
    lectures,
    value = $bindable(),
    excludedIds = [],
    excludedNames = [],
    language,
    id
  }: {
    lectures: UploadLecture[];
    value: LectureSelection;
    excludedIds?: string[];
    excludedNames?: string[];
    language: Language;
    id: string;
  } = $props();
  const tr = (key: MessageKey, values?: Record<string, string | number>) =>
    t(language, key, values);
  const normalise = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase('de-DE');
  let query = $state('');
  let open = $state(false);
  let highlighted = $state(-1);
  let searchInput = $state<HTMLInputElement>();
  let changeButton = $state<HTMLButtonElement>();
  let selected = $derived(lectures.find((lecture) => lecture.id === value.lectureId));
  let selectedName = $derived(selected?.name || value.newLectureName);
  let pending = $derived(Boolean(value.newLectureName) || selected?.approval_status === 'pending');
  let options = $derived(
    lectures.filter(
      (lecture) =>
        !lecture.archived &&
        !excludedIds.includes(lecture.id) &&
        normalise(lecture.name).includes(normalise(query))
    )
  );
  let canCreate = $derived(
    Boolean(query.trim()) &&
      !lectures.some((lecture) => normalise(lecture.name) === normalise(query)) &&
      !excludedNames.some((name) => normalise(name) === normalise(query))
  );
  let optionCount = $derived(options.length + (canCreate ? 1 : 0));
  async function choose(lecture: UploadLecture) {
    value = { lectureId: lecture.id, newLectureName: '' };
    open = false;
    query = '';
    await tick();
    changeButton?.focus();
  }
  async function create() {
    value = { lectureId: '', newLectureName: query.trim() };
    open = false;
    query = '';
    await tick();
    changeButton?.focus();
  }
  async function edit() {
    query = selectedName;
    value = { lectureId: '', newLectureName: '' };
    open = true;
    highlighted = -1;
    await tick();
    searchInput!.setCustomValidity(tr('Bitte eine Vorlesung auswählen oder neu anlegen.'));
    searchInput?.focus();
  }
  function search() {
    open = true;
    highlighted = -1;
    searchInput!.setCustomValidity(tr('Bitte eine Vorlesung auswählen oder neu anlegen.'));
  }
  async function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      open = false;
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open = true;
      highlighted = optionCount
        ? Math.max(0, Math.min(optionCount - 1, highlighted + (event.key === 'ArrowDown' ? 1 : -1)))
        : 0;
      await tick();
      document.getElementById(id + '-option-' + highlighted)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const exact = options.find((lecture) => normalise(lecture.name) === normalise(query));
      if (highlighted >= 0 && highlighted < options.length) choose(options[highlighted]);
      else if (highlighted === options.length && canCreate) create();
      else if (exact) choose(exact);
    }
  }
</script>

<div class="course-selector">
  {#if value.lectureId}<input type="hidden" name="lectureIds" value={value.lectureId} />{/if}
  {#if value.newLectureName}<input
      type="hidden"
      name="newLectureNames"
      value={value.newLectureName}
    />{/if}
  {#if selectedName}
    <div class="selected-course">
      <span class="selection-check" aria-hidden="true">✓</span><span class="selected-name"
        >{selectedName}</span
      >{#if pending}<span class="pending-label">{tr('Ausstehend')}</span>{/if}<button
        bind:this={changeButton}
        type="button"
        class="change-course"
        onclick={edit}
        aria-label={tr('Vorlesung ändern: ') + selectedName}>{tr('Ändern')}</button
      >
    </div>
  {:else}
    <input
      bind:this={searchInput}
      bind:value={query}
      {id}
      type="search"
      placeholder={tr('Vorlesung suchen')}
      aria-label={tr('Vorlesung suchen')}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={id + '-options'}
      aria-activedescendant={open && optionCount && highlighted >= 0
        ? id + '-option-' + highlighted
        : undefined}
      autocomplete="off"
      required
      onfocus={() => (open = true)}
      oninput={search}
      onkeydown={keydown}
    />
    {#if open}
      <div
        id={id + '-options'}
        class="course-options"
        role="listbox"
        aria-label={tr('Vorlesungen')}
      >
        {#each options as lecture, index}<button
            type="button"
            role="option"
            tabindex="-1"
            aria-selected={false}
            id={id + '-option-' + index}
            class:highlighted={highlighted === index}
            onpointerenter={() => (highlighted = index)}
            onclick={() => choose(lecture)}
            ><span>{lecture.name}</span>{#if lecture.approval_status === 'pending'}<span
                class="pending-label">{tr('Ausstehend')}</span
              >{/if}</button
          >{/each}
        {#if canCreate}<button
            type="button"
            role="option"
            tabindex="-1"
            aria-selected={false}
            id={id + '-option-' + options.length}
            class="create-course"
            class:highlighted={highlighted === options.length}
            onpointerenter={() => (highlighted = options.length)}
            onclick={create}
            ><span>{tr('Neu anlegen: ')}<strong>{query.trim()}</strong></span><span
              class="pending-label">{tr('Ausstehend')}</span
            ></button
          >{:else if !options.length}<p class="no-options">
            {tr('Keine weitere Vorlesung gefunden.')}
          </p>{/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .course-selector {
    min-width: 0;
    position: relative;
  }
  .course-selector input {
    margin: 0;
  }
  .selected-course {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    border: 1px solid var(--line);
    background: var(--surface);
    padding: 0.75rem 0.85rem;
    min-height: 49px;
  }
  .selection-check {
    color: var(--accent);
    font-weight: 700;
  }
  .selected-name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 0.94rem;
  }
  .pending-label {
    font-size: 0.71rem;
    line-height: 1.3;
    color: var(--muted);
    background: var(--subtle);
    padding: 0.2rem 0.4rem;
    white-space: nowrap;
  }
  .change-course {
    background: transparent;
    border: 0;
    color: var(--accent);
    font-size: 0.79rem;
    padding: 0.2rem;
    font-weight: 500;
  }
  .change-course:hover {
    background: transparent;
    text-decoration: underline;
  }
  .course-options {
    border: 1px solid var(--line);
    border-top: 0;
    background: var(--surface);
    max-height: 240px;
    overflow-y: auto;
  }
  .course-options > button {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    text-align: left;
    background: var(--surface);
    color: var(--ink);
    border: 0;
    border-radius: 0;
    padding: 0.8rem 0.85rem;
    font-weight: 400;
    font-size: 0.88rem;
    line-height: 1.45;
  }
  .course-options > button + button {
    border-top: 1px solid var(--line);
  }
  .course-options > button:hover,
  .course-options > button.highlighted {
    background: var(--subtle);
  }
  .course-options > button.create-course {
    color: var(--accent);
  }
  .create-course strong {
    font-weight: 600;
  }
  .no-options {
    font-size: 0.85rem;
    color: var(--muted);
    padding: 0.8rem;
    margin: 0;
  }
  @media (max-width: 500px) {
    .selected-course {
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .selected-name {
      flex-basis: calc(100% - 2rem);
    }
    .change-course {
      margin-left: auto;
    }
    .course-options > button {
      font-size: 0.84rem;
    }
  }
</style>
