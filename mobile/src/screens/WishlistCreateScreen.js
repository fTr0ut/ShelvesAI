import React, { useContext, useMemo, useState, useCallback } from 'react';
import {
    Alert,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    StatusBar,
    ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

const VISIBILITY_OPTIONS = [
    { value: 'private', label: 'Private', icon: 'lock-closed', description: 'Only you can see' },
    { value: 'friends', label: 'Friends', icon: 'people', description: 'Visible to friends' },
    { value: 'public', label: 'Public', icon: 'globe', description: 'Anyone can see' },
];

export default function WishlistCreateScreen({ navigation }) {
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [visibility, setVisibility] = useState('private');
    const [saving, setSaving] = useState(false);

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );

    const handleCreate = useCallback(async () => {
        if (!name.trim()) {
            Alert.alert('Error', 'Please enter a name for your wishlist');
            return;
        }

        try {
            setSaving(true);
            const data = await apiRequest({
                apiBase,
                path: '/api/wishlists',
                method: 'POST',
                token,
                body: {
                    name: name.trim(),
                    description: description.trim() || null,
                    visibility
                },
            });

            navigation.replace('Wishlist', { wishlistId: data.wishlist.id });
        } catch (e) {
            Alert.alert('Error', e.message);
        } finally {
            setSaving(false);
        }
    }, [apiBase, token, name, description, visibility, navigation]);

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                        <Ionicons name="close" size={22} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>New Wishlist</Text>
                    <View style={{ width: 40 }} />
                </View>

                {/* Form */}
                <View style={styles.card}>
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Name *</Text>
                        <TextInput
                            style={styles.input}
                            value={name}
                            onChangeText={setName}
                            placeholder="My Wishlist"
                            placeholderTextColor={colors.textMuted}
                            autoFocus
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Description</Text>
                        <TextInput
                            style={[styles.input, styles.textArea]}
                            value={description}
                            onChangeText={setDescription}
                            placeholder="Optional description..."
                            placeholderTextColor={colors.textMuted}
                            multiline
                            numberOfLines={3}
                        />
                    </View>
                </View>

                {/* Visibility */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Visibility</Text>
                    {VISIBILITY_OPTIONS.map((option) => (
                        <TouchableOpacity
                            key={option.value}
                            style={[
                                styles.visibilityOption,
                                visibility === option.value && styles.visibilityOptionSelected,
                            ]}
                            onPress={() => setVisibility(option.value)}
                        >
                            <View style={styles.visibilityIconContainer}>
                                <Ionicons
                                    name={option.icon}
                                    size={20}
                                    color={visibility === option.value ? colors.primary : colors.textMuted}
                                />
                            </View>
                            <View style={styles.visibilityInfo}>
                                <Text style={[
                                    styles.visibilityLabel,
                                    visibility === option.value && styles.visibilityLabelSelected,
                                ]}>
                                    {option.label}
                                </Text>
                                <Text style={styles.visibilityDescription}>{option.description}</Text>
                            </View>
                            {visibility === option.value && (
                                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                            )}
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Create Button */}
                <TouchableOpacity
                    style={[styles.createButton, (!name.trim() || saving) && styles.createButtonDisabled]}
                    onPress={handleCreate}
                    disabled={!name.trim() || saving}
                >
                    <Text style={styles.createButtonText}>
                        {saving ? 'Creating...' : 'Create Wishlist'}
                    </Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) =>
    StyleSheet.create({
        screen: {
            flex: 1,
            backgroundColor: colors.background,
        },
        content: {
            padding: spacing.md,
            paddingBottom: 40,
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
            ...shadows.sm,
        },
        headerTitle: {
            fontSize: 18,
            fontWeight: '600',
            color: colors.text,
        },
        card: {
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: spacing.md,
            marginBottom: spacing.md,
            ...shadows.sm,
        },
        cardTitle: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: spacing.md,
        },
        inputGroup: {
            marginBottom: spacing.md,
        },
        label: {
            fontSize: 13,
            color: colors.textMuted,
            marginBottom: 6,
        },
        input: {
            backgroundColor: colors.background,
            borderRadius: radius.md,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.sm + 2,
            fontSize: 16,
            color: colors.text,
        },
        textArea: {
            minHeight: 80,
            textAlignVertical: 'top',
        },
        visibilityOption: {
            flexDirection: 'row',
            alignItems: 'center',
            padding: spacing.sm,
            borderRadius: radius.md,
            marginBottom: spacing.xs,
        },
        visibilityOptionSelected: {
            backgroundColor: colors.primary + '15',
        },
        visibilityIconContainer: {
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.background,
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: spacing.sm,
        },
        visibilityInfo: {
            flex: 1,
        },
        visibilityLabel: {
            fontSize: 15,
            fontWeight: '500',
            color: colors.text,
        },
        visibilityLabelSelected: {
            color: colors.primary,
        },
        visibilityDescription: {
            fontSize: 12,
            color: colors.textMuted,
            marginTop: 2,
        },
        createButton: {
            backgroundColor: colors.primary,
            paddingVertical: spacing.md,
            borderRadius: radius.md,
            alignItems: 'center',
            marginTop: spacing.sm,
        },
        createButtonDisabled: {
            opacity: 0.5,
        },
        createButtonText: {
            color: colors.textInverted,
            fontWeight: '600',
            fontSize: 16,
        },
    });
