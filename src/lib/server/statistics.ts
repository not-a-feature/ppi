import { transaction } from './db.js';
import { currentActor, type Actor } from './domain/shared.js';

const ranges = ['30d', '6m', '1y', 'max'] as const;
type Range = (typeof ranges)[number];
type Counts = { logins: number; events: number; submissions: number; decisions: number };
type PopulationCounts = {
  cumulativeRegisteredUsers: number;
  cumulativeSubmittedProtocols: number;
};
type Statistics = {
  series: (Counts & PopulationCounts & { day: string })[];
  totals: Counts;
  range: Range;
  granularity: 'day' | 'month' | 'year';
  startDate: string;
  endDate: string;
  timezone: string;
};

export async function getAdminOverview(actor: Actor) {
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    return (
      await client.query<{
        openReports: number;
        pendingTokens: number;
        pendingLectures: number;
        processing: number;
        changesRequested: number;
        uploadsWeek: number;
        activationsWeek: number;
      }>(`SELECT
      (SELECT count(*)::integer FROM content_report WHERE status='open') AS "openReports",
      (SELECT count(*)::integer FROM token_request WHERE status='pending') AS "pendingTokens",
      (SELECT count(*)::integer FROM lecture WHERE approval_status='pending' AND NOT archived) AS "pendingLectures",
      count(*) FILTER(WHERE s.review_state='processing' AND s.files_deleted_at IS NULL AND f.deleted_at IS NULL)::integer AS processing,
      count(*) FILTER(WHERE s.review_state='changes_requested' AND s.files_deleted_at IS NULL AND f.deleted_at IS NULL)::integer AS "changesRequested",
      count(*) FILTER(WHERE s.created_at>=now()-interval '7 days')::integer AS "uploadsWeek",
      (SELECT count(*)::integer FROM credit_entry WHERE kind='activation' AND created_at>=now()-interval '7 days') AS "activationsWeek"
      FROM submission s JOIN submission_revision r ON r.id=s.current_revision_id JOIN stored_file f ON f.id=r.file_id`)
    ).rows[0];
  });
}

export async function getAdminStatisticsPeriods(actor: Actor) {
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const { rows } = await client.query<Omit<Statistics, 'totals' | 'timezone'>>(
      `WITH bounds AS (
         SELECT range, CASE range
           WHEN '30d' THEN today-29
           WHEN '6m' THEN (today-interval '6 months'+interval '1 day')::date
           WHEN '1y' THEN (today-interval '1 year'+interval '1 day')::date
           ELSE least((SELECT (min(created_at) AT TIME ZONE 'Europe/Berlin')::date FROM audit_event),
             (SELECT (min("createdAt") AT TIME ZONE 'Europe/Berlin')::date FROM "user" WHERE email ~ '^zx[a-z]{3}[0-9]{2}@student[.]uni-tuebingen[.]de$'),
             (SELECT (min(created_at) AT TIME ZONE 'Europe/Berlin')::date FROM submission),today)
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
           'submissions',coalesce(c.submissions,0),'decisions',coalesce(c.decisions,0))
           ORDER BY t.day) AS series
         FROM periods p CROSS JOIN LATERAL generate_series(date_trunc(p.granularity,p.start_date::timestamp),
           date_trunc(p.granularity,p.end_date::timestamp),
           CASE p.granularity WHEN 'year' THEN interval '1 year' WHEN 'month' THEN interval '1 month' ELSE interval '1 day' END) AS t(day)
         LEFT JOIN counts c ON c.range=p.range AND c.day=t.day::date
         GROUP BY p.range,p.granularity,p.start_date,p.end_date`,
      [ranges]
    );
    const population = (
      await client.query<{ day: string; users: number; protocols: number }>(`
      SELECT to_char(day,'YYYY-MM-DD') AS day,sum(users)::integer AS users,sum(protocols)::integer AS protocols FROM (
        SELECT ("createdAt" AT TIME ZONE 'Europe/Berlin')::date AS day,1 AS users,0 AS protocols FROM "user"
          WHERE email ~ '^zx[a-z]{3}[0-9]{2}@student[.]uni-tuebingen[.]de$'
            AND "createdAt"<(((now() AT TIME ZONE 'Europe/Berlin')::date+1)::timestamp AT TIME ZONE 'Europe/Berlin')
        UNION ALL SELECT (created_at AT TIME ZONE 'Europe/Berlin')::date,0,1 FROM submission
          WHERE created_at<(((now() AT TIME ZONE 'Europe/Berlin')::date+1)::timestamp AT TIME ZONE 'Europe/Berlin')
      ) entries GROUP BY day ORDER BY day`)
    ).rows;
    for (const row of rows) {
      let cursor = 0,
        users = 0,
        protocols = 0;
      for (const point of row.series) {
        const end = new Date(point.day + 'T00:00:00Z');
        if (row.granularity === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1);
        else if (row.granularity === 'month') end.setUTCMonth(end.getUTCMonth() + 1);
        else end.setUTCDate(end.getUTCDate() + 1);
        const upper = end.toISOString().slice(0, 10);
        while (cursor < population.length && population[cursor].day < upper) {
          users += population[cursor].users;
          protocols += population[cursor].protocols;
          cursor++;
        }
        point.cumulativeRegisteredUsers = users;
        point.cumulativeSubmittedProtocols = protocols;
      }
    }
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
