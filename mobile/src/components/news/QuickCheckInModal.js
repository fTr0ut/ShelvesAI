import React, { useState, useContext } from 'react';
import {
    View,
    Text,
    Modal,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    Image,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { AuthContext } from '../../context/AuthContext';
import { apiRequest } from '../../services/api';

const STATUS_OPTIONS = [
    { key: 'starting', label: 'Starting', icon: 'play-circle-outline' },
    { key: 'continuing', label: 'Continuing', icon: 'refresh-outline' },
    { key: 'completed', label: 'Completed', icon: 'checkmark-circle-outline' },
];

const NOTE_MAX_LENGTH = 280;

const QuickCheckInModal = ({ visible, onClose, newsItem }) => {
    const { colors, spacing, typography, shadows } = useTheme();
    const { showToast } = useToast();
    const { token, apiBase } = useContext(AuthContext);

    const [status, setStatus] = useState(null);
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);

    // Reset state when modal opens
    React.useEffect(() => {
        if (visible) {
            setStatus(null);
            setNote('');
            setLoading(false);
        }
    }, [visible]);

    const handleSubmit = async () => {
        if (!status) {
            showToast({ message: 'Please select a status', type: 'warning' });
            return;
        }

        setLoading(true);

        try {
            // Step 1: Resolve news item to collectable
            const collectableResult = await apiRequest({
                apiBase,
                path: '/api/collectables/from-news',
                method: 'POST',
                token,
                body: {
                    externalId: newsItem.externalId || newsItem.id,
                    sourceApi: newsItem.sourceApi,
                    title: newsItem.title,
                    category: newsItem.category,
                    primaryCreator: newsItem.primaryCreator || newsItem.creator,
                    coverUrl: newsItem.coverImageUrl || newsItem.coverUrl,
                    year: newsItem.year,
                    description: newsItem.description,
                },
            });

            if (!collectableResult?.collectable?.id) {
                throw new Error('Failed to resolve collectable');
            }

            const collectableId = collectableResult.collectable.id;

            // Step 2: Create the check-in
            await apiRequest({
                apiBase,
                path: '/api/checkin',
                method: 'POST',
                token,
                body: {
                    collectableId,
                    status,
                    note: note.trim() || null,
                },
            });

            showToast({
                message: `Checked in to "${newsItem.title}"`,
                type: 'success',
            });

            onClose();
        } catch (err) {
            console.error('Check-in error:', err);
            showToast({
                message: err.message || 'Failed to check in',
                type: 'error',
            });
        } finally {
            setLoading(false);
        }
    };

    const styles = StyleSheet.create({
        overlay: {
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            justifyContent: 'flex-end',
        },
        modalContent: {
            backgroundColor: colors.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingBottom: Platform.OS === 'ios' ? 34 : spacing.lg,
            maxHeight: '85%',
        },
        handle: {
            width: 36,
            height: 4,
            backgroundColor: colors.border,
            borderRadius: 2,
            alignSelf: 'center',
            marginTop: spacing.sm,
            marginBottom: spacing.md,
        },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
        },
        headerTitle: {
            ...typography.h3,
            color: colors.text,
            fontWeight: 'bold',
        },
        closeButton: {
            padding: spacing.xs,
        },
        scrollContent: {
            padding: spacing.lg,
        },
        itemPreview: {
            flexDirection: 'row',
            marginBottom: spacing.lg,
        },
        coverContainer: {
            width: 80,
            height: 120,
            borderRadius: 8,
            overflow: 'hidden',
            backgroundColor: colors.surfaceVariant,
            ...shadows.sm,
        },
        cover: {
            width: '100%',
            height: '100%',
        },
        coverFallback: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
        },
        itemInfo: {
            flex: 1,
            marginLeft: spacing.md,
            justifyContent: 'center',
        },
        itemTitle: {
            ...typography.h4,
            color: colors.text,
            marginBottom: spacing.xs,
        },
        itemCreator: {
            ...typography.body2,
            color: colors.textMuted,
        },
        itemCategory: {
            ...typography.caption,
            color: colors.primary,
            textTransform: 'capitalize',
            marginTop: spacing.xs,
        },
        sectionLabel: {
            ...typography.body2,
            color: colors.textMuted,
            marginBottom: spacing.sm,
            fontWeight: '600',
        },
        statusContainer: {
            flexDirection: 'row',
            marginBottom: spacing.lg,
            gap: spacing.sm,
        },
        statusButton: {
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.sm,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: colors.border,
            backgroundColor: colors.background,
            gap: spacing.xs,
        },
        statusButtonSelected: {
            borderColor: colors.primary,
            backgroundColor: colors.primary + '15',
        },
        statusText: {
            ...typography.body2,
            color: colors.textMuted,
            fontWeight: '600',
        },
        statusTextSelected: {
            color: colors.primary,
        },
        noteInput: {
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: spacing.md,
            minHeight: 100,
            ...typography.body1,
            color: colors.text,
            backgroundColor: colors.background,
            textAlignVertical: 'top',
            marginBottom: spacing.xs,
        },
        charCount: {
            ...typography.caption,
            color: colors.textMuted,
            textAlign: 'right',
            marginBottom: spacing.lg,
        },
        charCountWarning: {
            color: colors.error,
        },
        submitButton: {
            backgroundColor: colors.primary,
            paddingVertical: spacing.md,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: spacing.sm,
        },
        submitButtonDisabled: {
            opacity: 0.5,
        },
        submitText: {
            ...typography.body1,
            color: '#FFFFFF',
            fontWeight: 'bold',
        },
    });

    if (!newsItem) return null;

    const remainingChars = NOTE_MAX_LENGTH - note.length;
    const isOverLimit = remainingChars < 0;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <KeyboardAvoidingView
                style={styles.overlay}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <TouchableOpacity
                    style={{ flex: 1 }}
                    activeOpacity={1}
                    onPress={onClose}
                />
                <View style={styles.modalContent}>
                    <View style={styles.handle} />

                    <View style={styles.header}>
                        <Text style={styles.headerTitle}>Quick Check-In</Text>
                        <TouchableOpacity
                            style={styles.closeButton}
                            onPress={onClose}
                        >
                            <Ionicons
                                name="close"
                                size={24}
                                color={colors.textMuted}
                            />
                        </TouchableOpacity>
                    </View>

                    <ScrollView
                        style={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                    >
                        {/* Item Preview */}
                        <View style={styles.itemPreview}>
                            <View style={styles.coverContainer}>
                                {newsItem.coverImageUrl ? (
                                    <Image
                                        source={{ uri: newsItem.coverImageUrl }}
                                        style={styles.cover}
                                        resizeMode="cover"
                                    />
                                ) : (
                                    <View style={styles.coverFallback}>
                                        <Ionicons
                                            name="image-outline"
                                            size={32}
                                            color={colors.textMuted}
                                        />
                                    </View>
                                )}
                            </View>
                            <View style={styles.itemInfo}>
                                <Text style={styles.itemTitle} numberOfLines={2}>
                                    {newsItem.title}
                                </Text>
                                {newsItem.primaryCreator || newsItem.creator ? (
                                    <Text style={styles.itemCreator} numberOfLines={1}>
                                        {newsItem.primaryCreator || newsItem.creator}
                                    </Text>
                                ) : null}
                                {newsItem.category ? (
                                    <Text style={styles.itemCategory}>
                                        {newsItem.category}
                                    </Text>
                                ) : null}
                            </View>
                        </View>

                        {/* Status Selection */}
                        <Text style={styles.sectionLabel}>What are you doing?</Text>
                        <View style={styles.statusContainer}>
                            {STATUS_OPTIONS.map((option) => (
                                <TouchableOpacity
                                    key={option.key}
                                    style={[
                                        styles.statusButton,
                                        status === option.key && styles.statusButtonSelected,
                                    ]}
                                    onPress={() => setStatus(option.key)}
                                >
                                    <Ionicons
                                        name={option.icon}
                                        size={18}
                                        color={status === option.key ? colors.primary : colors.textMuted}
                                    />
                                    <Text
                                        style={[
                                            styles.statusText,
                                            status === option.key && styles.statusTextSelected,
                                        ]}
                                    >
                                        {option.label}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {/* Note Input */}
                        <Text style={styles.sectionLabel}>Add a note (optional)</Text>
                        <TextInput
                            style={styles.noteInput}
                            placeholder="What do you think so far?"
                            placeholderTextColor={colors.textMuted}
                            value={note}
                            onChangeText={setNote}
                            multiline
                            maxLength={NOTE_MAX_LENGTH + 10}
                        />
                        <Text
                            style={[
                                styles.charCount,
                                isOverLimit && styles.charCountWarning,
                            ]}
                        >
                            {remainingChars} characters remaining
                        </Text>

                        {/* Submit Button */}
                        <TouchableOpacity
                            style={[
                                styles.submitButton,
                                (loading || !status || isOverLimit) && styles.submitButtonDisabled,
                            ]}
                            onPress={handleSubmit}
                            disabled={loading || !status || isOverLimit}
                        >
                            {loading ? (
                                <ActivityIndicator color="#FFFFFF" size="small" />
                            ) : (
                                <>
                                    <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
                                    <Text style={styles.submitText}>Check In</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </ScrollView>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
};

export default QuickCheckInModal;
