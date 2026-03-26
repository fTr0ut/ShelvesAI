const TABLE = 'item_replacement_traces';

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) return;

  await knex.raw(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`);
  await knex.raw(`DROP POLICY IF EXISTS ${TABLE}_isolation ON ${TABLE}`);
  await knex.raw(`DROP POLICY IF EXISTS ${TABLE}_admin ON ${TABLE}`);

  await knex.raw(`
    CREATE POLICY ${TABLE}_isolation ON ${TABLE}
      FOR ALL
      USING (user_id = current_app_user_id())
      WITH CHECK (user_id = current_app_user_id())
  `);

  await knex.raw(`
    CREATE POLICY ${TABLE}_admin ON ${TABLE}
      FOR ALL
      USING (is_current_user_admin())
      WITH CHECK (is_current_user_admin())
  `);
};

exports.down = async function (knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) return;

  await knex.raw(`DROP POLICY IF EXISTS ${TABLE}_admin ON ${TABLE}`);
  await knex.raw(`DROP POLICY IF EXISTS ${TABLE}_isolation ON ${TABLE}`);
  await knex.raw(`ALTER TABLE ${TABLE} DISABLE ROW LEVEL SECURITY`);
};
