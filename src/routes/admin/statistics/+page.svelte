<script lang="ts">
  import { page } from '$app/state';
  import { text } from '$lib/i18n';
  let { data } = $props();
  let language = $derived(page.data.preferences.language);
  const metrics = [
    { key: 'logins', de: 'Erfasste Anmeldungen', en: 'Recorded sign-ins', color: 'var(--teal)' },
    { key: 'events', de: 'Ereignisse', en: 'Events', color: '#c98428' },
    { key: 'submissions', de: 'Neue Einreichungen', en: 'New submissions', color: '#7978d2' },
    { key: 'decisions', de: 'Prüfentscheidungen', en: 'Review decisions', color: '#cf6b7b' }
  ] as const;
  let selected = $state<string[]>(['logins', 'events']);
  const ranges = [
    { value: '30d', de: '30d', en: '30d' },
    { value: '6m', de: '6m', en: '6m' },
    { value: '1y', de: '1 Jahr', en: '1 year' },
    { value: 'max', de: 'Max', en: 'Max' }
  ];
  let visible = $derived(metrics.filter((metric) => selected.includes(metric.key)));
  let maximum = $derived(
    Math.max(
      1,
      ...data.statistics.series.flatMap((point) => visible.map((metric) => point[metric.key]))
    )
  );
  let granularity = $derived(
    data.statistics.granularity === 'year'
      ? text(language, 'Jährlich', 'Yearly')
      : data.statistics.granularity === 'month'
        ? text(language, 'Monatlich', 'Monthly')
        : text(language, 'Täglich', 'Daily')
  );
  function x(index: number) {
    return 50 + (index / Math.max(1, data.statistics.series.length - 1)) * 850;
  }
  function y(value: number) {
    return 255 - (value / maximum) * 210;
  }
  function tick(day: string) {
    return data.statistics.granularity === 'year'
      ? day.slice(0, 4)
      : data.statistics.granularity === 'month'
        ? day.slice(0, 7)
        : day.slice(5);
  }
</script>

<div class="page-head">
  <div>
    <h1>{text(language, 'Statistik', 'Statistics')}</h1>
    <p>{data.statistics.startDate} – {data.statistics.endDate} · Europe/Berlin</p>
  </div>
  <nav class="inline-form" aria-label={text(language, 'Zeitraum', 'Period')}>
    {#each ranges as range}<a
        href={`/admin/statistics?range=${range.value}`}
        class={data.statistics.range === range.value ? 'button' : 'button secondary'}
        aria-current={data.statistics.range === range.value ? 'page' : undefined}
        >{text(language, range.de, range.en)}</a
      >{/each}
  </nav>
</div>
<div class="grid" style="margin-bottom:1.5rem">
  {#each metrics as metric}<section class="card">
      <p class="eyebrow">{text(language, metric.de, metric.en)}</p>
      <div class="metric">{data.statistics.totals[metric.key]}</div>
    </section>{/each}
</div>
<section class="card">
  <h2>{text(language, 'Zeitverlauf', 'Activity over time')}</h2>
  <fieldset class="series-labels">
    <legend class="sr-only">{text(language, 'Datenreihen anzeigen', 'Show series')}</legend
    >{#each metrics as metric}<label style:--series-color={metric.color}
        ><input type="checkbox" bind:group={selected} value={metric.key} /><span
          class="series-swatch"
        ></span>{text(language, metric.de, metric.en)}</label
      >{/each}
  </fieldset>
  <div class="chart-scroll">
    <svg
      viewBox="0 0 930 320"
      role="img"
      aria-label={text(language, 'Ereignisse im Zeitverlauf', 'Events over time')}
    >
      <title>{text(language, 'Ereignisse im Zeitverlauf', 'Events over time')}</title><desc
        >{text(
          language,
          'Linien zeigen die ausgewählten Datenreihen. Die Werte sind auch als Tabelle verfügbar.',
          'Lines show the selected series. Values are also available in the data table.'
        )}</desc
      >
      {#each [0, 0.5, 1] as fraction}<line
          x1="50"
          y1={y(maximum * fraction)}
          x2="900"
          y2={y(maximum * fraction)}
          stroke="var(--line)"
        /><text x="40" y={y(maximum * fraction) + 4} text-anchor="end"
          >{Number((maximum * fraction).toFixed(1))}</text
        >{/each}
      {#each data.statistics.series as point, index}{#if index % Math.max(1, Math.ceil(data.statistics.series.length / 6)) === 0 || index === data.statistics.series.length - 1}<text
            x={x(index)}
            y="279"
            text-anchor="middle">{tick(point.day)}</text
          >{/if}{/each}
      {#each visible as metric}<polyline
          points={data.statistics.series
            .map((point, index) => `${x(index)},${y(point[metric.key])}`)
            .join(' ')}
          fill="none"
          stroke={metric.color}
          stroke-width="2.5"
        />{#each data.statistics.series as point, index}<circle
            cx={x(index)}
            cy={y(point[metric.key])}
            r="2.6"
            fill={metric.color}
            ><title>{point.day} · {text(language, metric.de, metric.en)}: {point[metric.key]}</title
            ></circle
          >{/each}{/each}
      <text x="475" y="309" text-anchor="middle"
        >{text(language, 'Datum', 'Date')} · {granularity}</text
      >
    </svg>
  </div>
  <details style="margin-top:1rem">
    <summary>{text(language, 'Daten als Tabelle', 'View data table')}</summary>
    <div class="table-scroll">
      <table>
        <thead
          ><tr
            ><th>{text(language, 'Datum', 'Date')}</th>{#each metrics as metric}<th
                >{text(language, metric.de, metric.en)}</th
              >{/each}</tr
          ></thead
        ><tbody
          >{#each data.statistics.series as point}<tr
              ><th scope="row"
                >{data.statistics.granularity === 'day' ? point.day : tick(point.day)}</th
              >{#each metrics as metric}<td>{point[metric.key]}</td>{/each}</tr
            >{/each}</tbody
        >
      </table>
    </div>
  </details>
</section>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .chart-scroll {
    overflow-x: auto;
  }
  svg {
    display: block;
    width: 100%;
    min-width: 660px;
    height: auto;
  }
  svg text {
    fill: var(--muted);
    font-size: 11px;
    font-family: inherit;
  }
  .series-labels {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem 1.5rem;
    border: 0;
    padding: 0;
    margin: 1rem 0;
  }
  .series-labels label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
  }
  .series-labels input {
    margin: 0;
  }
  .series-swatch {
    width: 1.2rem;
    border-top: 3px solid var(--series-color);
  }
</style>
