exports.up = async function (knex) {
    const hasLimitedEdition = await knex.schema.hasColumn('user_manuals', 'limited_edition');
    const hasItemSpecificText = await knex.schema.hasColumn('user_manuals', 'item_specific_text');

    if (!hasLimitedEdition || !hasItemSpecificText) {
        await knex.schema.alterTable('user_manuals', (table) => {
            if (!hasLimitedEdition) table.text('limited_edition');
            if (!hasItemSpecificText) table.text('item_specific_text');
        });
    }
};

exports.down = async function (knex) {
    await knex.schema.alterTable('user_manuals', (table) => {
        table.dropColumn('item_specific_text');
        table.dropColumn('limited_edition');
    });
};
