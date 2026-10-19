<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { text } from '$lib/i18n';
  import { termLabel, termOptions } from '$lib/terms';
  import { MAX_FILE_BYTES } from '$lib/file-limits';
  import CourseSelector, {
    type LectureSelection,
    type UploadLecture
  } from './CourseSelector.svelte';
  type FormValues = {
    lectureIds?: string[];
    newLectureNames?: string[];
    examinerId?: string;
    examinerName?: string;
    examDate?: string;
    term?: string;
    remarks?: string;
    collaboratorZx?: string;
  };
  let {
    lectures,
    examiners,
    requestKey,
    improvement = false,
    values = {}
  }: {
    lectures: UploadLecture[];
    examiners: { id: string; name: string; lectureIds: string[] }[];
    requestKey: string;
    improvement?: boolean;
    values?: FormValues;
  } = $props();
  let language = $derived(page.data.preferences.language);
  const tr = (de: string, en: string) => text(language, de, en);
  function initialSlots(initial: FormValues) {
    const ids = [...new Set(initial.lectureIds ?? [])];
    const names = [
      ...new Set((initial.newLectureNames ?? []).map((name) => name.trim()).filter(Boolean))
    ];
    const selected: LectureSelection[] = [
      ...ids.map((lectureId) => ({ lectureId, newLectureName: '' })),
      ...names.map((newLectureName) => ({ lectureId: '', newLectureName }))
    ];
    return (selected.length ? selected : [{ lectureId: '', newLectureName: '' }]).map(
      (value, key) => ({ key, value })
    );
  }
  let slots = $state(initialSlots(untrack(() => values)));
  let nextKey = untrack(() => slots.length);
  let previousValues = untrack(() => values);
  $effect(() => {
    if (values !== previousValues) {
      previousValues = values;
      const restored = initialSlots(values);
      slots = restored;
      nextKey = restored.length;
    }
  });
  let selectedIds = $derived(slots.map((slot) => slot.value.lectureId).filter(Boolean));
  let selectedNames = $derived(slots.map((slot) => slot.value.newLectureName).filter(Boolean));
  let suggestedExaminers = $derived(
    examiners.filter((examiner) => examiner.lectureIds.some((id) => selectedIds.includes(id)))
  );
  const semesters = termOptions();
  let fileInput: HTMLInputElement;
  let dragging = $state(false);
  let fileError = $state('');
  let fileName = $state('');
  let dragDepth = 0;
  function validateFile() {
    const files = fileInput.files;
    fileError = '';
    fileName = '';
    if (files && files.length) {
      const file = files[0];
      fileName = file.name;
      if (files.length !== 1)
        fileError = tr('Bitte genau eine Datei auswählen.', 'Select exactly one file.');
      else if (!/\.(pdf|txt)$/i.test(file.name))
        fileError = tr(
          'Nur PDF- und TXT-Dateien sind erlaubt.',
          'Only PDF and TXT files are allowed.'
        );
      else if (file.size === 0 || file.size > MAX_FILE_BYTES)
        fileError = tr(
          'Die Datei muss Inhalt haben und darf höchstens 30 MiB groß sein.',
          'The file must not be empty and must be no larger than 30 MiB.'
        );
    }
    if (fileError) {
      fileInput.value = '';
      fileName = '';
    }
    fileInput.setCustomValidity(fileError);
  }
  function dragEnter(event: DragEvent) {
    event.preventDefault();
    dragDepth++;
    dragging = true;
  }
  function dragLeave(event: DragEvent) {
    event.preventDefault();
    dragDepth--;
    if (dragDepth <= 0) {
      dragDepth = 0;
      dragging = false;
    }
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    dragDepth = 0;
    dragging = false;
    const files = event.dataTransfer!.files;
    if (files.length !== 1) {
      fileInput.value = '';
      fileName = '';
      fileError = tr('Bitte genau eine Datei ablegen.', 'Drop exactly one file.');
      fileInput.setCustomValidity(fileError);
      return;
    }
    fileInput.files = files;
    validateFile();
  }
</script>

<form
  method="POST"
  action={improvement ? '?/improve' : undefined}
  enctype="multipart/form-data"
  class="stack protocol-form"
>
  <input type="hidden" name="requestKey" value={requestKey} />
  <section class="card">
    <h2>{tr('1. Protokoll', '1. Protocol')}</h2>
    <nav
      class="template-downloads"
      aria-label={tr('Protokollvorlagen herunterladen', 'Download protocol templates')}
    >
      <span>{tr('Vorlagen:', 'Templates (German):')}</span>
      <a href="/templates/protokoll-vorlage.tex" download>LaTeX (.tex)</a>
      <a href="/templates/protokoll-vorlage.docx" download>Word (.docx)</a>
      <a href="/templates/protokoll-vorlage.txt" download
        >{tr('Text (.txt)', 'Plain text (.txt)')}</a
      >
    </nav>
    <p class="hint">
      {tr(
        'Word und LaTeX als PDF exportieren. TXT direkt hochladen.',
        'Export Word and LaTeX to PDF. Upload TXT directly.'
      )}
    </p>
    <div
      class="protocol-drop"
      class:dragging
      class:invalid={Boolean(fileError)}
      role="group"
      aria-labelledby="file-label"
      ondragenter={dragEnter}
      ondragleave={dragLeave}
      ondragover={(event) => event.preventDefault()}
      ondrop={drop}
    >
      <label id="file-label" for="file"
        >{improvement
          ? tr('Verbesserte Datei ablegen oder auswählen', 'Drop or select the improved file')
          : tr('Datei ablegen oder auswählen', 'Drop or select a file')}</label
      >
      <input
        bind:this={fileInput}
        id="file"
        name="file"
        type="file"
        accept="application/pdf,text/plain,.pdf,.txt"
        required
        aria-invalid={Boolean(fileError)}
        aria-describedby={fileError ? 'file-limit file-error' : 'file-limit'}
        onchange={validateFile}
      />
      <p id="file-limit">
        {tr(
          'Eine PDF- oder TXT-Datei, höchstens 30 MiB.',
          'One PDF or TXT file, no larger than 30 MiB.'
        )}
      </p>
      {#if fileName}<p class="selected-file">{fileName}</p>{/if}
      {#if fileError}<p id="file-error" class="file-error" role="alert">{fileError}</p>{/if}
    </div>
  </section>

  <section class="card">
    <h2>{tr('2. Angaben zur Prüfung', '2. Exam details')}</h2>
    <fieldset class="lecture-fields">
      <legend>{tr('Vorlesung', 'Course')}</legend>
      {#each slots as slot, index (slot.key)}
        <div class="lecture-slot">
          {#if slots.length > 1}<div class="slot-heading">
              <span>{tr('Vorlesung ', 'Course ')}{index + 1}</span><button
                type="button"
                class="remove-course"
                onclick={() => (slots = slots.filter((item) => item.key !== slot.key))}
                aria-label={tr('Vorlesung entfernen: ', 'Remove course: ') + (index + 1)}
                >{tr('Entfernen', 'Remove')}</button
              >
            </div>{/if}
          <CourseSelector
            {lectures}
            {language}
            id={'lecture-' + slot.key}
            bind:value={slot.value}
            excludedIds={selectedIds.filter((id) => id !== slot.value.lectureId)}
            excludedNames={selectedNames.filter((name) => name !== slot.value.newLectureName)}
          />
        </div>
      {/each}
      {#if slots.length < 20 && slots.every((slot) => slot.value.lectureId || slot.value.newLectureName)}<button
          type="button"
          class="add-course"
          onclick={() =>
            (slots = [...slots, { key: nextKey++, value: { lectureId: '', newLectureName: '' } }])}
          ><span aria-hidden="true">+</span>{tr(
            'Prüfung über mehrere Vorlesungen',
            'Exam covering multiple courses'
          )}</button
        >{/if}
    </fieldset>

    <div class="exam-fields">
      <label for="examinerName"
        >{tr('Prüfende Person', 'Examiner')}
        <input
          id="examinerName"
          name="examinerName"
          required
          list="examiner-suggestions"
          maxlength="200"
          autocomplete="off"
          value={values.examinerName ||
            examiners.find((examiner) => examiner.id === values.examinerId)?.name ||
            ''}
        /><datalist id="examiner-suggestions"
          >{#each suggestedExaminers as examiner}<option value={examiner.name}
            ></option>{/each}</datalist
        ></label
      >
      <label for="term"
        >{tr('Semester', 'Term')}<select id="term" name="term" required
          ><option value="">{tr('Semester auswählen', 'Select a term')}</option
          >{#each semesters as semester}<option
              value={semester.value}
              selected={values.term === semester.value}
              >{termLabel(language, semester.value)}</option
            >{/each}</select
        ></label
      >
    </div>
    {#if !improvement}<label for="examDate"
        >{tr('Prüfungsdatum', 'Exam date')}
        <input
          id="examDate"
          name="examDate"
          type="date"
          required
          value={values.examDate ?? ''}
        /></label
      >{/if}
    <label for="remarks"
      >{tr('Anmerkungen', 'Comments')}
      <span class="optional">{tr('(optional)', '(optional)')}</span><textarea
        id="remarks"
        name="remarks"
        maxlength="2000"
        value={values.remarks ?? ''}></textarea></label
    >
    {#if !improvement}<label for="collaboratorZx"
        >{tr('Weitere Mitwirkende', 'Other contributors')}
        <span class="optional">{tr('(optional)', '(optional)')}</span><input
          id="collaboratorZx"
          name="collaboratorZx"
          placeholder="zxabc12, zxdef34"
          value={values.collaboratorZx ?? ''}
        /></label
      >{/if}
  </section>

  <section class="card">
    <h2>{tr('3. Einreichung bestätigen', '3. Confirm submission')}</h2>
    <p class="submission-policy">
      {improvement
        ? tr(
            'Die Verbesserung wird neu geprüft und erhält keine weiteren Tokens. Die bisherige Version bleibt erhalten.',
            'The improvement will be reviewed and receives no additional tokens. The previous version is retained.'
          )
        : tr(
            'Du kannst später Verbesserungen hochladen. Eingereichte Protokolle kannst du nicht selbst löschen oder zurückziehen.',
            'You can upload improvements later. You cannot delete or withdraw submitted protocols yourself.'
          )}
    </p>
    <label class="attestation"
      ><input type="checkbox" name="attested" required />{tr(
        'Ich habe an diesem Protokoll mitgewirkt und darf es teilen.',
        'I contributed to this protocol and have permission to share it.'
      )}</label
    >
    <button disabled={Boolean(fileError)}
      >{improvement
        ? tr('Verbesserung hochladen', 'Upload improvement')
        : tr('Protokoll hochladen', 'Upload protocol')}</button
    >
  </section>
</form>

<style>
  .template-downloads {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem 1rem;
    margin-block: 0.75rem;
    font-size: 0.875rem;
  }
  .template-downloads a {
    font-weight: 600;
    text-underline-offset: 0.2em;
  }
  .protocol-form h2 {
    font-size: 1.2rem;
  }
  .protocol-drop {
    border: 1px dashed var(--line);
    background: var(--canvas);
    padding: 1.4rem;
    transition:
      border-color 0.12s,
      background-color 0.12s;
  }
  .protocol-drop.dragging {
    border: 2px solid var(--accent);
    padding: calc(1.4rem - 1px);
    background: var(--subtle);
  }
  .protocol-drop.invalid {
    border-color: var(--bad-ink);
  }
  .protocol-drop label {
    font-size: 0.94rem;
    margin-bottom: 1rem;
  }
  .protocol-drop input[type='file'] {
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0;
    max-width: 100%;
    font-size: 0.85rem;
  }
  .protocol-drop p {
    font-size: 0.8rem;
    color: var(--muted);
    line-height: 1.5;
    margin: 0.8rem 0 0;
  }
  .protocol-drop .selected-file {
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .protocol-drop .file-error {
    color: var(--bad-ink);
  }
  .lecture-fields {
    border: 0;
    margin: 0 0 1.8rem;
    padding: 0;
    min-width: 0;
  }
  .lecture-fields legend {
    font-size: 0.9rem;
    font-weight: 600;
    margin-bottom: 0.7rem;
    padding: 0;
  }
  .lecture-slot + .lecture-slot {
    margin-top: 1rem;
  }
  .slot-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.81rem;
    color: var(--muted);
    margin-bottom: 0.45rem;
  }
  .remove-course {
    background: transparent;
    color: var(--accent);
    border: 0;
    padding: 0.15rem 0;
    font-size: 0.78rem;
    font-weight: 400;
  }
  .remove-course:hover {
    background: transparent;
    text-decoration: underline;
  }
  .add-course {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.5rem 0;
    background: transparent;
    color: var(--accent);
    border: 0;
    font-size: 0.82rem;
    font-weight: 500;
    margin-top: 0.7rem;
    text-align: left;
  }
  .add-course span {
    font-size: 1.25rem;
    line-height: 1;
  }
  .add-course:hover {
    background: transparent;
    text-decoration: underline;
  }
  .exam-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.2rem;
  }
  .optional {
    font-weight: 400;
    color: var(--muted);
    font-size: 0.81rem;
  }
  .submission-policy {
    font-size: 0.85rem;
    line-height: 1.65;
    color: var(--muted);
    max-width: 65ch;
    margin-bottom: 1.2rem;
  }
  .attestation {
    font-size: 0.86rem;
    line-height: 1.6;
  }
  .protocol-form label:last-child {
    margin-bottom: 0;
  }
  @media (max-width: 600px) {
    .exam-fields {
      grid-template-columns: 1fr;
      gap: 0;
    }
    .protocol-drop {
      padding: 1.1rem;
    }
    .protocol-drop.dragging {
      padding: calc(1.1rem - 1px);
    }
    .protocol-drop input[type='file'] {
      font-size: 0.78rem;
    }
    .protocol-form h2 {
      font-size: 1.1rem;
    }
  }
</style>
