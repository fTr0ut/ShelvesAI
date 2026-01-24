import React, { useCallback, useContext, useState } from 'react';
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

export default function ManualEditScreen({ route, navigation }) {
    const { item, shelfId } = route.params || {};
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius } = useTheme();

    const manual = item?.manual || item?.manualSnapshot || {};

    // Basic info
    const [title, setTitle] = useState(manual?.title || manual?.name || '');
    const [author, setAuthor] = useState(manual?.author || manual?.primaryCreator || '');
    const [publisher, setPublisher] = useState(manual?.publisher || '');
    const [year, setYear] = useState(manual?.year?.toString() || '');
    const [format, setFormat] = useState(manual?.format || '');

    // Special attributes
    const [edition, setEdition] = useState(manual?.edition || '');
    const [limitedEdition, setLimitedEdition] = useState(manual?.limitedEdition || manual?.limited_edition || '');
    const [ageStatement, setAgeStatement] = useState(manual?.ageStatement || manual?.age_statement || '');
    const [specialMarkings, setSpecialMarkings] = useState(manual?.specialMarkings || manual?.special_markings || '');
    const [labelColor, setLabelColor] = useState(manual?.labelColor || manual?.label_color || '');
    const [regionalItem, setRegionalItem] = useState(manual?.regionalItem || manual?.regional_item || '');
    const [barcode, setBarcode] = useState(manual?.barcode || '');

    // Details
    const [description, setDescription] = useState(manual?.description || '');
    const [itemSpecificText, setItemSpecificText] = useState(manual?.itemSpecificText || manual?.item_specific_text || '');
    const [genre, setGenre] = useState(
        Array.isArray(manual?.genre) ? manual.genre.join(', ') : (manual?.genre || '')
    );

    // Personal
    const [notes, setNotes] = useState(item?.notes || '');
    const [saving, setSaving] = useState(false);

    // Track which optional sections have data to show them expanded
    const hasSpecialAttributes = !!(edition || limitedEdition || ageStatement || specialMarkings || labelColor || regionalItem || barcode);
    const [showSpecialAttributes, setShowSpecialAttributes] = useState(hasSpecialAttributes);

    const styles = createStyles({ colors, spacing, typography, shadows, radius });

    const handleSave = useCallback(async () => {
        if (!title.trim()) {
            Alert.alert('Error', 'Title is required');
            return;
        }

        // Parse genre string into array
        const genreArray = genre.trim()
            ? genre.split(',').map(g => g.trim()).filter(Boolean)
            : [];

        try {
            setSaving(true);
            await apiRequest({
                apiBase,
                path: `/api/shelves/${shelfId}/manual/${item?.id}`,
                method: 'PUT',
                token,
                body: {
                    // Basic info
                    name: title.trim(),
                    author: author.trim() || null,
                    publisher: publisher.trim() || null,
                    year: year ? parseInt(year, 10) : null,
                    format: format.trim() || null,
                    // Special attributes
                    edition: edition.trim() || null,
                    limitedEdition: limitedEdition.trim() || null,
                    ageStatement: ageStatement.trim() || null,
                    specialMarkings: specialMarkings.trim() || null,
                    labelColor: labelColor.trim() || null,
                    regionalItem: regionalItem.trim() || null,
                    barcode: barcode.trim() || null,
                    // Details
                    description: description.trim() || null,
                    itemSpecificText: itemSpecificText.trim() || null,
                    genre: genreArray.length > 0 ? genreArray : null,
                    // Personal
                    notes: notes.trim() || null,
                },
            });
            navigation.goBack();
        } catch (e) {
            Alert.alert('Error', e.message);
        } finally {
            setSaving(false);
        }
    }, [
        apiBase, shelfId, item, title, author, publisher, year, format,
        edition, limitedEdition, ageStatement, specialMarkings, labelColor,
        regionalItem, barcode, description, itemSpecificText, genre, notes, token, navigation
    ]);

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <KeyboardAvoidingView
                style={styles.container}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView style={styles.container} contentContainerStyle={styles.content}>
                    {/* Header */}
                    <View style={styles.header}>
                        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                            <Ionicons name="close" size={24} color={colors.text} />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>Edit Item</Text>
                        <View style={{ width: 40 }} />
                    </View>

                    {/* Form */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Title</Text>
                        <TextInput
                            style={styles.input}
                            value={title}
                            onChangeText={setTitle}
                            placeholder="Item title"
                            placeholderTextColor={colors.textMuted}
                            editable={!saving}
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Author / Creator</Text>
                        <TextInput
                            style={styles.input}
                            value={author}
                            onChangeText={setAuthor}
                            placeholder="Optional"
                            placeholderTextColor={colors.textMuted}
                            editable={!saving}
                        />
                    </View>

                    <View style={styles.row}>
                        <View style={[styles.inputGroup, { flex: 2 }]}>
                            <Text style={styles.label}>Publisher</Text>
                            <TextInput
                                style={styles.input}
                                value={publisher}
                                onChangeText={setPublisher}
                                placeholder="Optional"
                                placeholderTextColor={colors.textMuted}
                                editable={!saving}
                            />
                        </View>
                        <View style={[styles.inputGroup, { flex: 1 }]}>
                            <Text style={styles.label}>Year</Text>
                            <TextInput
                                style={styles.input}
                                value={year}
                                onChangeText={setYear}
                                placeholder="YYYY"
                                placeholderTextColor={colors.textMuted}
                                keyboardType="numeric"
                                maxLength={4}
                                editable={!saving}
                            />
                        </View>
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Format</Text>
                        <TextInput
                            style={styles.input}
                            value={format}
                            onChangeText={setFormat}
                            placeholder="e.g., Hardcover, Vinyl, DVD"
                            placeholderTextColor={colors.textMuted}
                            editable={!saving}
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Genre</Text>
                        <TextInput
                            style={styles.input}
                            value={genre}
                            onChangeText={setGenre}
                            placeholder="Comma-separated genres"
                            placeholderTextColor={colors.textMuted}
                            editable={!saving}
                        />
                    </View>

                    {/* Special Attributes Section */}
                    <TouchableOpacity
                        style={styles.sectionHeader}
                        onPress={() => setShowSpecialAttributes(!showSpecialAttributes)}
                    >
                        <Text style={styles.sectionTitle}>Special Attributes</Text>
                        <Ionicons
                            name={showSpecialAttributes ? 'chevron-up' : 'chevron-down'}
                            size={20}
                            color={colors.textSecondary}
                        />
                    </TouchableOpacity>

                    {showSpecialAttributes && (
                        <View style={styles.sectionContent}>
                            <View style={styles.row}>
                                <View style={[styles.inputGroup, { flex: 1 }]}>
                                    <Text style={styles.label}>Edition</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={edition}
                                        onChangeText={setEdition}
                                        placeholder="e.g., First Edition"
                                        placeholderTextColor={colors.textMuted}
                                        editable={!saving}
                                    />
                                </View>
                                <View style={[styles.inputGroup, { flex: 1 }]}>
                                    <Text style={styles.label}>Limited Edition</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={limitedEdition}
                                        onChangeText={setLimitedEdition}
                                        placeholder="e.g., #42 of 500"
                                        placeholderTextColor={colors.textMuted}
                                        editable={!saving}
                                    />
                                </View>
                            </View>

                            <View style={styles.row}>
                                <View style={[styles.inputGroup, { flex: 1 }]}>
                                    <Text style={styles.label}>Age Statement</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={ageStatement}
                                        onChangeText={setAgeStatement}
                                        placeholder="e.g., 12 Year Old"
                                        placeholderTextColor={colors.textMuted}
                                        editable={!saving}
                                    />
                                </View>
                                <View style={[styles.inputGroup, { flex: 1 }]}>
                                    <Text style={styles.label}>Label Color</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={labelColor}
                                        onChangeText={setLabelColor}
                                        placeholder="e.g., Black Label"
                                        placeholderTextColor={colors.textMuted}
                                        editable={!saving}
                                    />
                                </View>
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Special Markings</Text>
                                <TextInput
                                    style={styles.input}
                                    value={specialMarkings}
                                    onChangeText={setSpecialMarkings}
                                    placeholder="Unique markings or identifiers"
                                    placeholderTextColor={colors.textMuted}
                                    editable={!saving}
                                />
                            </View>

                            <View style={styles.row}>
                                <View style={[styles.inputGroup, { flex: 1 }]}>
                                    <Text style={styles.label}>Regional Item</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={regionalItem}
                                        onChangeText={setRegionalItem}
                                        placeholder="e.g., Japan Import"
                                        placeholderTextColor={colors.textMuted}
                                        editable={!saving}
                                    />
                                </View>
                                <View style={[styles.inputGroup, { flex: 1 }]}>
                                    <Text style={styles.label}>Barcode</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={barcode}
                                        onChangeText={setBarcode}
                                        placeholder="UPC / EAN"
                                        placeholderTextColor={colors.textMuted}
                                        editable={!saving}
                                    />
                                </View>
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Item Specific Text</Text>
                                <TextInput
                                    style={[styles.input, styles.textArea]}
                                    value={itemSpecificText}
                                    onChangeText={setItemSpecificText}
                                    placeholder="Label text, inscriptions, etc."
                                    placeholderTextColor={colors.textMuted}
                                    multiline
                                    numberOfLines={2}
                                    textAlignVertical="top"
                                    editable={!saving}
                                />
                            </View>
                        </View>
                    )}

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Description</Text>
                        <TextInput
                            style={[styles.input, styles.textArea]}
                            value={description}
                            onChangeText={setDescription}
                            placeholder="Optional description"
                            placeholderTextColor={colors.textMuted}
                            multiline
                            numberOfLines={3}
                            textAlignVertical="top"
                            editable={!saving}
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Your Notes</Text>
                        <TextInput
                            style={[styles.input, styles.textArea]}
                            value={notes}
                            onChangeText={setNotes}
                            placeholder="Personal notes about this item"
                            placeholderTextColor={colors.textMuted}
                            multiline
                            numberOfLines={3}
                            textAlignVertical="top"
                            editable={!saving}
                        />
                    </View>
                </ScrollView>

                {/* Save Button */}
                <View style={styles.footer}>
                    <TouchableOpacity
                        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                        onPress={handleSave}
                        disabled={saving}
                    >
                        <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) => StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: colors.background,
    },
    container: {
        flex: 1,
    },
    content: {
        padding: spacing.md,
        paddingBottom: 100,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.lg,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.text,
    },
    inputGroup: {
        marginBottom: spacing.md,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text,
        marginBottom: spacing.sm,
    },
    input: {
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
        fontSize: 16,
        color: colors.text,
        ...shadows.sm,
    },
    textArea: {
        minHeight: 80,
        paddingTop: spacing.md,
    },
    row: {
        flexDirection: 'row',
        gap: spacing.md,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.sm,
        marginTop: spacing.sm,
        marginBottom: spacing.sm,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    sectionTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    sectionContent: {
        marginBottom: spacing.md,
    },
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: spacing.md,
        backgroundColor: colors.background,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    saveButton: {
        backgroundColor: colors.primary,
        paddingVertical: spacing.md,
        borderRadius: radius.lg,
        alignItems: 'center',
        ...shadows.md,
    },
    saveButtonDisabled: {
        opacity: 0.6,
    },
    saveButtonText: {
        color: colors.textInverted,
        fontSize: 16,
        fontWeight: '600',
    },
});
