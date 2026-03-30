exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('workflow_queue_jobs');
  if (!hasTable) {
    await knex.schema.createTable('workflow_queue_jobs', (table) => {
      table.text('job_id').primary();
      table.text('workflow_type').notNullable();
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.integer('shelf_id').nullable().references('id').inTable('shelves').onDelete('SET NULL');
      table.text('status').notNullable().defaultTo('queued');
      table.integer('priority').notNullable().defaultTo(100);
      table.integer('attempt_count').notNullable().defaultTo(0);
      table.integer('max_attempts').notNullable().defaultTo(1);
      table.text('dedupe_key').nullable();
      table.boolean('abort_requested').notNullable().defaultTo(false);
      table.boolean('notify_on_complete').notNullable().defaultTo(false);
      table.jsonb('payload').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.jsonb('result').nullable();
      table.jsonb('error').nullable();
      table.timestamp('claimed_at', { useTz: true }).nullable();
      table.timestamp('started_at', { useTz: true }).nullable();
      table.timestamp('finished_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw(`
      ALTER TABLE workflow_queue_jobs
      ADD CONSTRAINT chk_workflow_queue_jobs_status
      CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'aborted'))
    `);
    await knex.raw(`
      ALTER TABLE workflow_queue_jobs
      ADD CONSTRAINT chk_workflow_queue_jobs_attempts
      CHECK (attempt_count >= 0 AND max_attempts >= 1)
    `);

    await knex.raw(`
      CREATE INDEX idx_workflow_queue_claim_order
      ON workflow_queue_jobs (workflow_type, status, priority, created_at)
      WHERE status = 'queued'
    `);
    await knex.raw(`
      CREATE INDEX idx_workflow_queue_user_status
      ON workflow_queue_jobs (user_id, workflow_type, status, created_at)
      WHERE status IN ('queued', 'processing')
    `);
    await knex.raw(`
      CREATE INDEX idx_workflow_queue_status_updated
      ON workflow_queue_jobs (status, updated_at)
    `);
    await knex.raw(`
      CREATE UNIQUE INDEX uq_workflow_queue_dedupe_active
      ON workflow_queue_jobs (workflow_type, dedupe_key)
      WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'processing')
    `);
  }

  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        DROP TRIGGER IF EXISTS update_workflow_queue_jobs_updated_at ON workflow_queue_jobs;
        CREATE TRIGGER update_workflow_queue_jobs_updated_at
          BEFORE UPDATE ON workflow_queue_jobs
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      END IF;
    END $$;
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS uq_workflow_queue_dedupe_active');
  await knex.raw('DROP INDEX IF EXISTS idx_workflow_queue_status_updated');
  await knex.raw('DROP INDEX IF EXISTS idx_workflow_queue_user_status');
  await knex.raw('DROP INDEX IF EXISTS idx_workflow_queue_claim_order');
  await knex.raw('DROP TRIGGER IF EXISTS update_workflow_queue_jobs_updated_at ON workflow_queue_jobs');
  await knex.schema.dropTableIfExists('workflow_queue_jobs');
};
