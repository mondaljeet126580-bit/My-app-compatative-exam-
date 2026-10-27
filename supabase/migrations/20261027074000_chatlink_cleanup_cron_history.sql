-- Keep high-frequency scheduled-message worker history bounded.
select cron.unschedule(jobid)
from cron.job
where jobname = 'chatlink-cleanup-scheduled-message-worker-history';

select cron.schedule(
  'chatlink-cleanup-scheduled-message-worker-history',
  '0 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days';$$
);