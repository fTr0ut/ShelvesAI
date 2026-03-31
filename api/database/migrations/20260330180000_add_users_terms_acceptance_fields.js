exports.up = async function up(knex) {
  const hasUsersTable = await knex.schema.hasTable('users');
  if (!hasUsersTable) return;

  const hasTermsAccepted = await knex.schema.hasColumn('users', 'terms_accepted');
  if (!hasTermsAccepted) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('terms_accepted').notNullable().defaultTo(false);
    });
  }

  const hasTermsAcceptedVersion = await knex.schema.hasColumn('users', 'terms_accepted_version');
  if (!hasTermsAcceptedVersion) {
    await knex.schema.alterTable('users', (table) => {
      table.text('terms_accepted_version');
    });
  }

  const hasTermsAcceptedAt = await knex.schema.hasColumn('users', 'terms_accepted_at');
  if (!hasTermsAcceptedAt) {
    await knex.schema.alterTable('users', (table) => {
      table.timestamp('terms_accepted_at', { useTz: true });
    });
  }
};

exports.down = async function down(knex) {
  const hasUsersTable = await knex.schema.hasTable('users');
  if (!hasUsersTable) return;

  const hasTermsAcceptedAt = await knex.schema.hasColumn('users', 'terms_accepted_at');
  if (hasTermsAcceptedAt) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('terms_accepted_at');
    });
  }

  const hasTermsAcceptedVersion = await knex.schema.hasColumn('users', 'terms_accepted_version');
  if (hasTermsAcceptedVersion) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('terms_accepted_version');
    });
  }

  const hasTermsAccepted = await knex.schema.hasColumn('users', 'terms_accepted');
  if (hasTermsAccepted) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('terms_accepted');
    });
  }
};

