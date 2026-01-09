import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
    ActivityIndicator,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

const VISIBILITY_OPTIONS = [
    { value: 'private', label: 'Private', icon: 'lock-closed' },
    { value: 'friends', label: 'Friends', icon: 'people' },
    { value: 'public', label: 'Public', icon: 'globe' },
];

export default function ShelfEditScreen({ route, navigation }) {
    const { shelf: initialShelf } = route.params || {};
    const shelfId = initialShelf?.id || initialShelf?._id || route.params?.shelfId || route.params?.id;
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    // State
    const [shelf, setShelf] = useState(initialShelf || null);
    const [loading, setLoading] = useState(!initialShelf);
    const [name, setName] = useState(initialShelf?.name || '');
    const [description, setDescription] = useState(initialShelf?.description || '');
    const [visibility, setVisibility] = useState(initialShelf?.visibility || 'private');
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const styles = createStyles({ colors, spacing, typography, shadows, radius });

    // Load shelf data from API if not passed or to refresh
    useEffect(() => {
        if (!shelfId) return;

        const loadShelf = async () => {
            try {
                setLoading(true);
                const data = await apiRequest({
                    apiBase,
                    path: `/api/shelves/${shelfId}`,
                    token,
                });
                const fetchedShelf = data.shelf || data;
                setShelf(fetchedShelf);
                setName(fetchedShelf?.name || '');
                setDescription(fetchedShelf?.description || '');
                setVisibility(fetchedShelf?.visibility || 'private');
            } catch (e) {
                console.warn('Failed to load shelf:', e);
                Alert.alert('Error', 'Could not load shelf details');
            } finally {
                setLoading(false);
            }
        };

        loadShelf();
    }, [apiBase, shelfId, token]);

    const handleSave = useCallback(async () => {
        if (!name.trim()) {
            Alert.alert('Error', 'Shelf name is required');
            return;
        }

        try {
            setSaving(true);
            await apiRequest({
                apiBase,
                path: `/api/shelves/${shelfId}`,
                method: 'PUT',
                token,
                body: { name: name.trim(), description: description.trim(), visibility },
            });
            navigation.goBack();
        } catch (e) {
            Alert.alert('Error', e.message);
        } finally {
            setSaving(false);
        }
    }, [apiBase, shelfId, name, description, visibility, token, navigation]);

    const handleDelete = useCallback(() => {
        Alert.alert(
            'Delete Shelf',
            `Are you sure you want to delete "${shelf?.name || name}"? This cannot be undone.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            setDeleting(true);
                            await apiRequest({
                                apiBase,
                                path: `/api/shelves/${shelfId}`,
                                method: 'DELETE',
                                token,
                            });
                            navigation.navigate('Shelves');
                        } catch (e) {
                            Alert.alert('Error', e.message);
                            setDeleting(false);
                        }
                    },
                },
            ]
        );
    }, [apiBase, shelfId, shelf, name, token, navigation]);

    if (loading) {
        return (
            <SafeAreaView style={[styles.screen, styles.centerContainer]} edges={['top']}>
                <ActivityIndicator size="large" color={colors.primary} />
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <KeyboardAvoidingView
                style={styles.container}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.content}>
                    {/* Header */}
                    <View style={styles.header}>
                        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                            <Ionicons name="close" size={24} color={colors.text} />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>Edit Shelf</Text>
                        <View style={{ width: 40 }} />
                    </View>

                    {/* Name */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Name</Text>
                        <TextInput
                            style={styles.input}
                            value={name}
                            onChangeText={setName}
                            placeholder="Shelf name"
                            placeholderTextColor={colors.textMuted}
                            editable={!saving && !deleting}
                        />
                    </View>

                    {/* Description */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Description</Text>
                        <TextInput
                            style={[styles.input, styles.textArea]}
                            value={description}
                            onChangeText={setDescription}
                            placeholder="Optional description"
                            placeholderTextColor={colors.textMuted}
                            editable={!saving && !deleting}
                            multiline
                            numberOfLines={3}
                            textAlignVertical="top"
                        />
                    </View>

                    {/* Visibility */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Visibility</Text>
                        <View style={styles.visibilityRow}>
                            {VISIBILITY_OPTIONS.map(opt => (
                                <TouchableOpacity
                                    key={opt.value}
                                    style={[styles.visibilityOption, visibility === opt.value && styles.visibilityActive]}
                                    onPress={() => setVisibility(opt.value)}
                                    disabled={saving || deleting}
                                >
                                    <Ionicons
                                        name={opt.icon}
                                        size={20}
                                        color={visibility === opt.value ? colors.primary : colors.textMuted}
                                    />
                                    <Text style={[styles.visibilityText, visibility === opt.value && styles.visibilityTextActive]}>
                                        {opt.label}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    {/* Shelf Info */}
                    <View style={styles.infoCard}>
                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Type</Text>
                            <Text style={styles.infoValue}>{shelf?.type || 'Collection'}</Text>
                        </View>
                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Items</Text>
                            <Text style={styles.infoValue}>{shelf?.itemCount ?? shelf?.items?.length ?? 0}</Text>
                        </View>
                        <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                            <Text style={styles.infoLabel}>Created</Text>
                            <Text style={styles.infoValue}>
                                {shelf?.createdAt ? new Date(shelf.createdAt).toLocaleDateString() : '—'}
                            </Text>
                        </View>
                    </View>

                    {/* Delete */}
                    <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={handleDelete}
                        disabled={deleting || saving}
                    >
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                        <Text style={styles.deleteText}>{deleting ? 'Deleting...' : 'Delete Shelf'}</Text>
                    </TouchableOpacity>
                </ScrollView>

                {/* Save Button */}
                <View style={styles.footer}>
                    <TouchableOpacity
                        style={[styles.saveButton, (saving || deleting) && styles.saveButtonDisabled]}
                        onPress={handleSave}
                        disabled={saving || deleting}
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
    centerContainer: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    container: {
        flex: 1,
    },
    scrollContainer: {
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
        marginBottom: spacing.lg,
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
    visibilityRow: {
        flexDirection: 'row',
        gap: spacing.sm,
    },
    visibilityOption: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: spacing.md,
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        borderWidth: 2,
        borderColor: 'transparent',
        ...shadows.sm,
    },
    visibilityActive: {
        borderColor: colors.primary,
        backgroundColor: colors.primary + '10',
    },
    visibilityText: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 4,
    },
    visibilityTextActive: {
        color: colors.primary,
        fontWeight: '500',
    },
    infoCard: {
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.lg,
        ...shadows.sm,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    infoLabel: {
        fontSize: 14,
        color: colors.textMuted,
    },
    infoValue: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.text,
    },
    deleteButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.md,
    },
    deleteText: {
        fontSize: 15,
        color: colors.error,
        fontWeight: '500',
    },
    footer: {
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
