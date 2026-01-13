import React, { useContext, useState, useMemo } from 'react';
import {
    ActivityIndicator,
    Alert,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

const VISIBILITY_OPTIONS = [
    { key: 'private', label: 'Private', icon: 'lock-closed-outline' },
    { key: 'friends', label: 'Friends Only', icon: 'people-outline' },
    { key: 'public', label: 'Public', icon: 'globe-outline' },
];

export default function ListCreateScreen({ navigation }) {
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

    const handleCreate = async () => {
        if (!name.trim()) {
            Alert.alert('Error', 'Please enter a list name');
            return;
        }

        setSaving(true);
        try {
            const data = await apiRequest({
                apiBase,
                path: '/api/lists',
                method: 'POST',
                token,
                body: {
                    name: name.trim(),
                    description: description.trim() || null,
                    visibility,
                },
            });

            Alert.alert('Success', 'List created!', [
                {
                    text: 'OK',
                    onPress: () => navigation.replace('ListDetail', { id: data.list.id }),
                },
            ]);
        } catch (e) {
            Alert.alert('Error', e.message || 'Failed to create list');
        } finally {
            setSaving(false);
        }
    };

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Create List</Text>
                <View style={{ width: 40 }} />
            </View>

            <View style={styles.content}>
                {/* Name Input */}
                <View style={styles.inputGroup}>
                    <Text style={styles.label}>List Name *</Text>
                    <TextInput
                        style={styles.input}
                        value={name}
                        onChangeText={setName}
                        placeholder="e.g., Top 10 Horror Movies"
                        placeholderTextColor={colors.textMuted}
                        maxLength={100}
                    />
                </View>

                {/* Description Input */}
                <View style={styles.inputGroup}>
                    <Text style={styles.label}>Description</Text>
                    <TextInput
                        style={[styles.input, styles.textArea]}
                        value={description}
                        onChangeText={setDescription}
                        placeholder="What's this list about?"
                        placeholderTextColor={colors.textMuted}
                        multiline
                        numberOfLines={3}
                        maxLength={500}
                    />
                </View>

                {/* Visibility */}
                <View style={styles.inputGroup}>
                    <Text style={styles.label}>Visibility</Text>
                    <View style={styles.visibilityOptions}>
                        {VISIBILITY_OPTIONS.map((option) => {
                            const isSelected = visibility === option.key;
                            return (
                                <TouchableOpacity
                                    key={option.key}
                                    style={[styles.visibilityOption, isSelected && styles.visibilityOptionSelected]}
                                    onPress={() => setVisibility(option.key)}
                                >
                                    <Ionicons
                                        name={option.icon}
                                        size={18}
                                        color={isSelected ? colors.primary : colors.textMuted}
                                    />
                                    <Text style={[styles.visibilityOptionText, isSelected && styles.visibilityOptionTextSelected]}>
                                        {option.label}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </View>

                {/* Info */}
                <View style={styles.infoBox}>
                    <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
                    <Text style={styles.infoText}>
                        Lists can have up to 10 items. You can add items after creating the list.
                    </Text>
                </View>

                {/* Create Button */}
                <TouchableOpacity
                    style={[styles.createButton, saving && styles.createButtonDisabled]}
                    onPress={handleCreate}
                    disabled={saving}
                >
                    {saving ? (
                        <ActivityIndicator size="small" color={colors.textInverted} />
                    ) : (
                        <Text style={styles.createButtonText}>Create List</Text>
                    )}
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) =>
    StyleSheet.create({
        screen: {
            flex: 1,
            backgroundColor: colors.background,
        },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: spacing.md,
            paddingTop: spacing.lg,
            paddingBottom: spacing.md,
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
            flex: 1,
            textAlign: 'center',
            fontSize: 18,
            fontWeight: '600',
            color: colors.text,
        },
        content: {
            padding: spacing.md,
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
            borderRadius: radius.md,
            padding: spacing.md,
            fontSize: 16,
            color: colors.text,
            ...shadows.sm,
        },
        textArea: {
            minHeight: 80,
            textAlignVertical: 'top',
        },
        visibilityOptions: {
            flexDirection: 'row',
            gap: spacing.sm,
        },
        visibilityOption: {
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.xs,
            backgroundColor: colors.surface,
            paddingVertical: spacing.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
        },
        visibilityOptionSelected: {
            borderColor: colors.primary,
            backgroundColor: colors.primary + '10',
        },
        visibilityOptionText: {
            fontSize: 13,
            color: colors.textMuted,
        },
        visibilityOptionTextSelected: {
            color: colors.primary,
            fontWeight: '600',
        },
        infoBox: {
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: spacing.sm,
            backgroundColor: colors.surface,
            padding: spacing.md,
            borderRadius: radius.md,
            marginBottom: spacing.lg,
        },
        infoText: {
            flex: 1,
            fontSize: 13,
            color: colors.textMuted,
            lineHeight: 18,
        },
        createButton: {
            backgroundColor: colors.primary,
            paddingVertical: spacing.md,
            borderRadius: radius.md,
            alignItems: 'center',
        },
        createButtonDisabled: {
            opacity: 0.6,
        },
        createButtonText: {
            color: colors.textInverted,
            fontSize: 16,
            fontWeight: '600',
        },
    });
