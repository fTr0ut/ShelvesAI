const VISION_TABLES = ['vision_scan_photos', 'vision_item_regions'];

exports.up = async function (knex) {
  for (const table of VISION_TABLES) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;

    await knex.raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`DROP POLICY IF EXISTS ${table}_isolation ON ${table}`);
    await knex.raw(`DROP POLICY IF EXISTS ${table}_admin ON ${table}`);

    await knex.raw(`
      CREATE POLICY ${table}_isolation ON ${table}
        FOR ALL
        USING (user_id = current_app_user_id())
        WITH CHECK (user_id = current_app_user_id())
    `);

    await knex.raw(`
      CREATE POLICY ${table}_admin ON ${table}
        FOR ALL
        USING (is_current_user_admin())
        WITH CHECK (is_current_user_admin())
    `);
  }
};

exports.down = async function (knex) {
  for (const table of VISION_TABLES) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;

    await knex.raw(`DROP POLICY IF EXISTS ${table}_admin ON ${table}`);
    await knex.raw(`DROP POLICY IF EXISTS ${table}_isolation ON ${table}`);
    await knex.raw(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  }
};

