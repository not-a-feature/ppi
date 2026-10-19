<script lang="ts">
  import { onMount } from 'svelte';
  import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
  import { t, type MessageKey } from '$lib/i18n';
  let { src, language }: { src: string; language: 'de' | 'en' } = $props();
  const tr = (key: MessageKey, values?: Record<string, string | number>) =>
    t(language, key, values);
  let pdf = $state.raw<PDFDocumentProxy>();
  let plainText = $state<string>();
  let pageNumber = $state(1);
  let zoom = $state(1);
  let loading = $state(true);
  let rendering = $state(false);
  let failed = $state(false);
  let passwordRequired = $state(false);
  let pageText = $state('');
  let canvasHost = $state<HTMLDivElement>();

  onMount(() => {
    let disposed = false;
    let task: PDFDocumentLoadingTask | undefined;
    async function load() {
      const response = await fetch(src, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Preview request failed: ${response.status}`);
      if (response.headers.get('Content-Type')?.startsWith('text/plain')) {
        const value = await response.text();
        if (!disposed) plainText = value;
      } else {
        const [library, worker, data] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
          response.arrayBuffer()
        ]);
        if (disposed) return;
        library.GlobalWorkerOptions.workerSrc = worker.default;
        const assets = `/pdfjs/${library.version}`;
        task = library.getDocument({
          data: new Uint8Array(data),
          cMapUrl: `${assets}/cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${assets}/standard_fonts/`,
          wasmUrl: `${assets}/wasm/`,
          iccUrl: `${assets}/iccs/`
        });
        const document = await task.promise;
        if (!disposed) pdf = document;
      }
    }
    void load()
      .catch((cause: Error) => {
        if (!disposed) {
          failed = true;
          passwordRequired = cause.name === 'PasswordException';
        }
      })
      .finally(() => {
        if (!disposed) loading = false;
      });
    return () => {
      disposed = true;
      void task?.destroy();
    };
  });

  $effect(() => {
    const document = pdf;
    const number = pageNumber;
    const host = canvasHost;
    if (!document || !host) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    rendering = true;
    pageText = '';
    failed = false;
    async function render() {
      const page = await document!.getPage(number);
      if (cancelled) return;
      const canvas = window.document.createElement('canvas');
      const dimensions = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(1.5, 2048 / Math.max(dimensions.width, dimensions.height))
      });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * pixelRatio);
      canvas.height = Math.ceil(viewport.height * pixelRatio);
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      canvas.style.display = 'block';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${tr('Seite')} ${number}`);
      task = page.render({ canvas, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
      await task.promise;
      const content = await page.getTextContent();
      if (cancelled) return;
      host!.replaceChildren(canvas);
      pageText = content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('');
    }
    void render()
      .catch(() => {
        if (!cancelled) failed = true;
      })
      .finally(() => {
        if (!cancelled) rendering = false;
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  });
</script>

{#if loading}<p class="preview-message" role="status">
    {tr('Vorschau wird geladen …')}
  </p>{/if}
{#if failed}<p class="preview-message notice warning" role="alert">
    {passwordRequired
      ? tr('Passwortgeschütztes PDF. Bitte die Datei herunterladen.')
      : tr('Die Vorschau konnte nicht geladen werden. Bitte die Datei herunterladen.')}
  </p>{/if}
{#if plainText !== undefined}<pre class="text-preview">{plainText}</pre>{/if}
{#if pdf}
  <div class="preview-toolbar" aria-label={tr('PDF-Steuerung')}>
    <button
      type="button"
      class="secondary"
      disabled={pageNumber === 1 || rendering}
      onclick={() => pageNumber--}
      aria-label={tr('Vorherige Seite')}>←</button
    >
    <span aria-live="polite">{tr('Seite')} {pageNumber} / {pdf.numPages}</span>
    <button
      type="button"
      class="secondary"
      disabled={pageNumber === pdf.numPages || rendering}
      onclick={() => pageNumber++}
      aria-label={tr('Nächste Seite')}>→</button
    >
    <label
      >{tr('Zoom')}<select bind:value={zoom}>
        <option value={1}>{tr('Seitenbreite')}</option>
        <option value={1.25}>125%</option><option value={1.5}>150%</option><option value={2}
          >200%</option
        >
      </select></label
    >
  </div>
  <div class="page-scroll" aria-busy={rendering}>
    <div
      bind:this={canvasHost}
      class="canvas-host"
      style:width={`${zoom * 100}%`}
      style:visibility={rendering ? 'hidden' : 'visible'}
    ></div>
  </div>
  {#if pageText}<details class="page-text">
      <summary>{tr('Seitentext')}</summary>
      <pre>{pageText}</pre>
    </details>{/if}
{/if}

<style>
  .preview-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-block: 1px solid var(--line);
  }
  .preview-toolbar button {
    padding: 0.3rem 0.7rem;
  }
  .preview-toolbar label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0 auto;
    font-size: 0.875rem;
  }
  .preview-toolbar select {
    width: auto;
    padding: 0.35rem;
  }
  .page-scroll {
    height: 75vh;
    min-height: 440px;
    overflow: auto;
    background: #d9dce2;
  }
  .canvas-host {
    min-height: 100%;
  }
  .text-preview {
    margin: 0;
    padding: 1.25rem;
    min-height: 400px;
    max-height: 75vh;
    overflow: auto;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 0.9rem;
    line-height: 1.6;
  }
  .preview-message,
  .page-text {
    margin: 1rem;
  }
</style>
