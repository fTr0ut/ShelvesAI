exports.up = async function (knex) {
    const tableName = 'collectables';
    const hasFormats = await knex.schema.hasColumn(tableName, 'formats');
    const hasFormat = await knex.schema.hasColumn(tableName, 'format');

    if (!hasFormats) {
        await knex.schema.alterTable(tableName, (table) => {
            table.jsonb('formats').defaultTo(knex.raw(`'[]'::jsonb`));
        });
    }

    if (hasFormat) {
        await knex.raw(
            `UPDATE collectables
             SET formats = CASE
               WHEN format IS NULL OR trim(format) = '' THEN COALESCE(formats, '[]'::jsonb)
               ELSE (
                 SELECT to_jsonb(ARRAY(
                   SELECT DISTINCT value
                   FROM (
                     SELECT jsonb_array_elements_text(COALESCE(formats, '[]'::jsonb)) AS value
                     UNION
                     SELECT trim(format) AS value
                   ) AS merged
                   WHERE value IS NOT NULL AND value <> ''
                 ))
               )
             END`,
        );

        await knex.schema.alterTable(tableName, (table) => {
            table.dropColumn('format');
        });
    }
};

exports.down = async function (knex) {
    await knex.schema.alterTable('collectables', (table) => {
        table.text('format');
        table.dropColumn('formats');
    });
};
