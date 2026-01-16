exports.up = async function (knex) {
    const tableName = 'user_manuals';
    const hasAgeStatement = await knex.schema.hasColumn(tableName, 'age_statement');
    const hasSpecialMarkings = await knex.schema.hasColumn(tableName, 'special_markings');
    const hasLabelColor = await knex.schema.hasColumn(tableName, 'label_color');
    const hasRegionalItem = await knex.schema.hasColumn(tableName, 'regional_item');
    const hasEdition = await knex.schema.hasColumn(tableName, 'edition');
    const hasBarcode = await knex.schema.hasColumn(tableName, 'barcode');
    const hasManualFingerprint = await knex.schema.hasColumn(tableName, 'manual_fingerprint');

    if (!hasAgeStatement || !hasSpecialMarkings || !hasLabelColor || !hasRegionalItem || !hasEdition || !hasBarcode || !hasManualFingerprint) {
        await knex.schema.alterTable(tableName, (table) => {
            if (!hasAgeStatement) table.text('age_statement');
            if (!hasSpecialMarkings) table.text('special_markings');
            if (!hasLabelColor) table.text('label_color');
            if (!hasRegionalItem) table.text('regional_item');
            if (!hasEdition) table.text('edition');
            if (!hasBarcode) table.text('barcode');
            if (!hasManualFingerprint) table.text('manual_fingerprint');
        });
    }

    await knex.raw(
        `CREATE INDEX IF NOT EXISTS idx_user_manuals_manual_fingerprint
         ON user_manuals(user_id, shelf_id, manual_fingerprint)
         WHERE manual_fingerprint IS NOT NULL`,
    );
};

exports.down = async function (knex) {
    await knex.schema.alterTable('user_manuals', (table) => {
        table.dropColumn('manual_fingerprint');
        table.dropColumn('barcode');
        table.dropColumn('edition');
        table.dropColumn('regional_item');
        table.dropColumn('label_color');
        table.dropColumn('special_markings');
        table.dropColumn('age_statement');
    });
    await knex.raw('DROP INDEX IF EXISTS idx_user_manuals_manual_fingerprint');
};
