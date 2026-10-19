import { transaction } from './db.js';
import { currentActor, type Actor } from './domain/shared.js';

const ranges = ['30d', '6m', '1y', 'max'] as const;
type Range = (typeof ranges)[number];
type Counts = { logins: number; events: number; submissions: number; decisions: number };
type Statistics = {
  series: (Counts & { day: string })[];
  totals: Counts;
  range: Range;
  granularity: 'day' | 'month' | 'year';
  startDate: string;
  endDate: string;
  timezone: string;
};

export async function getAdminStatisticsPeriods(actor: Actor) {
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const { rows } = await client.query<Omit<Statistics, 'totals' | 'timezone'>>(
      `WITH bounds AS (
         SELECT range, CASE range
           WHEN '30d' THEN today-29
           WHEN '6m' THEN (today-interval '6 months'+interval '1 day')::date
           WHEN '1y' THEN (today-interval '1 year'+interval '1 day')::date
           ELSE coalesce((SELECT (min(created_at) AT TIME ZONE 'Europe/Berlin')::date FROM audit_event),today)
         END AS start_date,today AS end_date
         FROM unnest($1::text[]) AS range CROSS JOIN
           (SELECT (now() AT TIME ZONE 'Europe/Berlin')::date AS today) AS clock
       ), periods AS (
         SELECT *,CASE WHEN range='max' AND start_date<end_date-interval '20 years' THEN 'year'
           WHEN range='max' AND start_date<end_date-interval '1 year' THEN 'month' ELSE 'day' END AS granularity
         FROM bounds
       ), daily AS MATERIALIZED (
         SELECT (created_at AT TIME ZONE 'Europe/Berlin')::date AS day,count(*)::integer AS events,
           count(*) FILTER(WHERE action='auth.login')::integer AS logins,
           count(*) FILTER(WHERE action='submission.created')::integer AS submissions,
           count(*) FILTER(WHERE action='submission.reviewed')::integer AS decisions
         FROM audit_event WHERE created_at>=((SELECT min(start_date) FROM bounds)::timestamp AT TIME ZONE 'Europe/Berlin')
           AND created_at<(((SELECT max(end_date) FROM bounds)+1)::timestamp AT TIME ZONE 'Europe/Berlin')
         GROUP BY 1
       ), counts AS (
         SELECT p.range,date_trunc(p.granularity,d.day)::date AS day,
           sum(d.logins)::integer AS logins,sum(d.events)::integer AS events,
           sum(d.submissions)::integer AS submissions,sum(d.decisions)::integer AS decisions
         FROM periods p JOIN daily d ON d.day BETWEEN p.start_date AND p.end_date GROUP BY 1,2
       ) SELECT p.range,p.granularity,to_char(p.start_date,'YYYY-MM-DD') AS "startDate",
         to_char(p.end_date,'YYYY-MM-DD') AS "endDate",
         json_agg(json_build_object('day',to_char(t.day,'YYYY-MM-DD'),
           'logins',coalesce(c.logins,0),'events',coalesce(c.events,0),
           'submissions',coalesce(c.submissions,0),'decisions',coalesce(c.decisions,0)) ORDER BY t.day) AS series
         FROM periods p CROSS JOIN LATERAL generate_series(date_trunc(p.granularity,p.start_date::timestamp),
           date_trunc(p.granularity,p.end_date::timestamp),
           CASE p.granularity WHEN 'year' THEN interval '1 year' WHEN 'month' THEN interval '1 month' ELSE interval '1 day' END) AS t(day)
         LEFT JOIN counts c ON c.range=p.range AND c.day=t.day::date
         GROUP BY p.range,p.granularity,p.start_date,p.end_date`,
      [ranges]
    );
    return Object.fromEntries(
      rows.map((row) => [
        row.range,
        {
          ...row,
          totals: row.series.reduce(
            (sum, point) => ({
              logins: sum.logins + point.logins,
              events: sum.events + point.events,
              submissions: sum.submissions + point.submissions,
              decisions: sum.decisions + point.decisions
            }),
            { logins: 0, events: 0, submissions: 0, decisions: 0 }
          ),
          timezone: 'Europe/Berlin'
        }
      ])
    );
  });
}
