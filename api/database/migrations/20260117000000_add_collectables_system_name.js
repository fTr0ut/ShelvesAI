exports.up = async function (knex) {
    const tableName = 'collectables';
    const hasSystemName = await knex.schema.hasColumn(tableName, 'system_name');

    if (!hasSystemName) {
        await knex.schema.alterTable(tableName, (table) => {
            table.text('system_name');
        });
    }
};

exports.down = async function (knex) {
    await knex.schema.alterTable('collectables', (table) => {
        table.dropColumn('system_name');
    });
};
