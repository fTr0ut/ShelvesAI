/**
 * Create job logging tables for request and scheduled workflow observability.
 *
 * job_runs   => one row per request/scheduled workflow execution
 * job_events => optional event rows linked to a job_run
 */
exports.up = async function (knex) {
  const hasJobRuns = await knex.schema.hasTable('job_runs');
  if (!hasJobRuns) {
    await knex.schema.createTable('job_runs', (table) => {
      table.text('job_id').primary();
      table.text('job_type').notNullable(); // request | scheduled | script | manual | system
      table.text('job_name').nullable();
      table
        .uuid('user_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL');
      table.text('status').notNullable().defaultTo('running'); // running | completed | failed
      table.boolean('success').nullable();

      table.text('http_method').nullable();
      table.text('http_path').nullable();
      table.integer('http_status').nullable();
      table.text('ip_address').nullable();
      table.integer('duration_ms').nullable();

      table.text('error_message').nullable();
      table.jsonb('metadata').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));

      table.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('finished_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.schema.alterTable('job_runs', (table) => {
      table.index(['job_type'], 'idx_job_runs_job_type');
      table.index(['status'], 'idx_job_runs_status');
      table.index(['user_id'], 'idx_job_runs_user_id');
      table.index(['started_at'], 'idx_job_runs_started_at');
      table.index(['finished_at'], 'idx_job_runs_finished_at');
      table.index(['http_status'], 'idx_job_runs_http_status');
    });

    await knex.raw(`
      ALTER TABLE job_runs
      ADD CONSTRAINT chk_job_runs_status
      CHECK (status IN ('running', 'completed', 'failed'))
    `);
  }

  const hasJobEvents = await knex.schema.hasTable('job_events');
  if (!hasJobEvents) {
    await knex.schema.createTable('job_events', (table) => {
      table.bigIncrements('id').primary();
      table
        .text('job_id')
        .notNullable()
        .references('job_id')
        .inTable('job_runs')
        .onDelete('CASCADE');
      table.text('level').notNullable(); // info | warn | error | debug
      table.text('message').notNullable();
      table
        .uuid('user_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL');
      table.jsonb('metadata').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.schema.alterTable('job_events', (table) => {
      table.index(['job_id', 'created_at'], 'idx_job_events_job_time');
      table.index(['level'], 'idx_job_events_level');
      table.index(['created_at'], 'idx_job_events_created_at');
    });
  }

  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        DROP TRIGGER IF EXISTS update_job_runs_updated_at ON job_runs;
        CREATE TRIGGER update_job_runs_updated_at
          BEFORE UPDATE ON job_runs
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      END IF;
    END $$;
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('job_events');
  await knex.schema.dropTableIfExists('job_runs');
};
