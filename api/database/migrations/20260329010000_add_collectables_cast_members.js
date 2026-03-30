exports.up = async function (knex) {
  const hasCastMembers = await knex.schema.hasColumn('collectables', 'cast_members');

  if (!hasCastMembers) {
    await knex.schema.alterTable('collectables', (table) => {
      table.jsonb('cast_members').nullable().defaultTo(null);
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_collectables_cast_members_gin
    ON collectables
    USING GIN (cast_members jsonb_path_ops)
    WHERE cast_members IS NOT NULL
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS idx_collectables_cast_members_gin
  `);

  const hasCastMembers = await knex.schema.hasColumn('collectables', 'cast_members');
  if (hasCastMembers) {
    await knex.schema.alterTable('collectables', (table) => {
      table.dropColumn('cast_members');
    });
  }
};
