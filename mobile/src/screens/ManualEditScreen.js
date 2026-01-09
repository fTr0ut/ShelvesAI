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
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

export default function ManualEditScreen({ route, navigation }) {
    const { item, shelfId } = route.params || {};
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius } = useTheme();

    const manual = item?.manual || item?.manualSnapshot || {};

    const [title, setTitle] = useState(manual?.title || '');
    const [author, setAuthor] = useState(manual?.author || '');
    const [publisher, setPublisher] = useState(manual?.publisher || '');
    const [year, setYear] = useState(manual?.year?.toString() || '');
    const [description, setDescription] = useState(manual?.description || '');
    const [notes, setNotes] = useState(item?.notes || '');
    const [saving, setSaving] = useState(false);

    const styles = createStyles({ colors, spacing, typography, shadows, radius });

    const handleSave = useCallback(async () => {
        if (!title.trim()) {
            Alert.alert('Error', 'Title is required');
            return;
        }

        try {
            setSaving(true);
            await apiRequest({
                apiBase,
                path: `/api/shelves/${shelfId}/manual/${item?.id}`,
                method: 'PUT',
                token,
                body: {
                    title: title.trim(),
                    author: author.trim(),
                    publisher: publisher.trim(),
                    year: year ? parseInt(year, 10) : null,
                    description: description.trim(),
                    notes: notes.trim(),
                },
            });
            navigation.goBack();
        } catch (e) {
            Alert.alert('Error', e.message);
        } finally {
            setSaving(false);
        }
    }, [apiBase, shelfId, item, title, author, publisher, year, description, notes, token, navigation]);

    return (
        <KeyboardAvoidingView
            style={styles.screen}
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
