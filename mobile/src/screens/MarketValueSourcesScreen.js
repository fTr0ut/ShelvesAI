import React, { useContext, useEffect, useMemo, useState } from 'react';
import { CommonActions } from '@react-navigation/native';
import {
    ActivityIndicator,
    Alert,
    Linking,
    ScrollView,
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

function extractHostname(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
}

export default function MarketValueSourcesScreen({ navigation, route }) {
    const { collectableId, manualId, itemTitle, detailRouteKey, detailNavigatorKey } = route.params || {};
    const { apiBase, token } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();
    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);

    const [sources, setSources] = useState([]);
    const [loading, setLoading] = useState(true);
    const [estimate, setEstimate] = useState(null);
    const [showEstimateInput, setShowEstimateInput] = useState(false);
    const [estimateText, setEstimateText] = useState('');
    const [saving, setSaving] = useState(false);

    // Determine which ID and type to use for API calls
    const isManualItem = !collectableId && !!manualId;
    const targetId = collectableId || manualId;
    const typeParam = isManualItem ? '?type=manual' : '';

    useEffect(() => {
        if (!targetId || !apiBase || !token) {
            setLoading(false);
            return;
        }
        let active = true;
        (async () => {
            try {
                const [sourcesData, estimateData] = await Promise.all([
                    apiRequest({ apiBase, path: `/api/collectables/${targetId}/market-value-sources${typeParam}`, token }),
                    apiRequest({ apiBase, path: `/api/collectables/${targetId}/user-estimate${typeParam}`, token }),
                ]);
                if (!active) return;
                setSources(sourcesData?.sources || []);
                setEstimate(estimateData?.estimate || null);
                if (estimateData?.estimate?.value) {
                    setEstimateText(estimateData.estimate.value);
                }
            } catch (err) {
                console.warn('Failed to load market value sources:', err?.message || err);
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [targetId, typeParam, apiBase, token]);

    const handleSaveEstimate = async () => {
        const trimmed = estimateText.trim();
        if (!trimmed) {
            Alert.alert('Invalid', 'Please enter an estimate value.');
            return;
        }
        setSaving(true);
        try {
            const data = await apiRequest({
                apiBase,
                path: `/api/collectables/${targetId}/user-estimate${typeParam}`,
                token,
                method: 'PUT',
                body: { estimateValue: trimmed },
            });
            const saved = data?.estimate || null;
            setEstimate(saved);
            setShowEstimateInput(false);
            if (detailRouteKey && detailNavigatorKey) {
                navigation.dispatch({
                    ...CommonActions.setParams({
                        userEstimate: saved,
                        userEstimateAt: Date.now(),
                    }),
                    source: detailRouteKey,
                    target: detailNavigatorKey,
                });
            }
            navigation.goBack();
        } catch (err) {
            Alert.alert('Error', 'Could not save your estimate. Please try again.');
            console.warn('Save estimate error:', err?.message || err);
        } finally {
            setSaving(false);
        }
    };

    const openSource = (url) => {
        Linking.openURL(url).catch((err) =>
            console.warn("Couldn't open URL:", err)
        );
    };

    return (
        <View style={styles.screen}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            {/* Header */}
            <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={22} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle} numberOfLines={1}>Sources</Text>
                    <View style={{ width: 40 }} />
                </View>
            </SafeAreaView>

            <ScrollView contentContainerStyle={styles.content}>
                {/* Subtitle */}
                <Text style={styles.subtitle}>
                    Sources we used to come up with this estimate
                </Text>
                {itemTitle ? <Text style={styles.itemTitle} numberOfLines={2}>{itemTitle}</Text> : null}

                {/* Loading */}
                {loading && (
                    <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.xl }} />
                )}

                {/* Sources List */}
                {!loading && sources.length > 0 && (
                    <View style={styles.card}>
                        {sources.map((source, i) => (
                            <TouchableOpacity
                                key={`${source.url}-${i}`}
                                style={[styles.sourceRow, i < sources.length - 1 && styles.sourceRowBorder]}
                                onPress={() => openSource(source.url)}
                                activeOpacity={0.7}
                            >
                                <View style={styles.sourceInfo}>
                                    <Text style={styles.sourceLabel} numberOfLines={1}>
                                        {source.label || extractHostname(source.url)}
                                    </Text>
                                    <Text style={styles.sourceUrl} numberOfLines={1}>{source.url}</Text>
                                </View>
                                <Ionicons name="open-outline" size={18} color={colors.primary} />
                            </TouchableOpacity>
                        ))}
                    </View>
                )}

                {/* No sources */}
                {!loading && sources.length === 0 && (
                    <View style={styles.emptyCard}>
                        <Ionicons name="document-text-outline" size={32} color={colors.textMuted} />
                        <Text style={styles.emptyText}>No sources available for this estimate.</Text>
                    </View>
                )}

                {/* Divider */}
                {!loading && <View style={styles.divider} />}

                {/* Your Estimate Section */}
                {!loading && (
                    <View style={styles.estimateSection}>
                        <Text style={styles.sectionTitle}>Your Estimate</Text>

                        {estimate?.value && !showEstimateInput ? (
                            <View style={styles.card}>
                                <View style={styles.estimateRow}>
                                    <Text style={styles.estimateValue}>{estimate.value}</Text>
                                    <TouchableOpacity
                                        onPress={() => {
                                            setEstimateText(estimate.value);
                                            setShowEstimateInput(true);
                                        }}
                                        style={styles.editButton}
                                    >
                                        <Ionicons name="pencil" size={16} color={colors.primary} />
                                        <Text style={styles.editButtonText}>Edit</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        ) : !showEstimateInput ? (
                            <TouchableOpacity
                                style={styles.provideButton}
                                onPress={() => setShowEstimateInput(true)}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="add-circle-outline" size={20} color={colors.onPrimary || '#fff'} />
                                <Text style={styles.provideButtonText}>Provide Your Estimate</Text>
                            </TouchableOpacity>
                        ) : null}

                        {showEstimateInput && (
                            <View style={styles.card}>
                                <Text style={styles.inputLabel}>Enter your estimated market value</Text>
                                <TextInput
                                    style={styles.input}
                                    value={estimateText}
                                    onChangeText={setEstimateText}
                                    placeholder="e.g. USD $50"
                                    placeholderTextColor={colors.textMuted}
                                    autoFocus
                                    returnKeyType="done"
                                    onSubmitEditing={handleSaveEstimate}
                                />
                                <View style={styles.inputActions}>
                                    <TouchableOpacity
                                        onPress={() => setShowEstimateInput(false)}
                                        style={styles.cancelButton}
                                    >
                                        <Text style={styles.cancelButtonText}>Cancel</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        onPress={handleSaveEstimate}
                                        style={[styles.saveButton, saving && { opacity: 0.6 }]}
                                        disabled={saving}
                                    >
                                        {saving ? (
                                            <ActivityIndicator size="small" color={colors.onPrimary || '#fff'} />
                                        ) : (
                                            <Text style={styles.saveButtonText}>Save</Text>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

function createStyles({ colors, spacing, typography, shadows, radius }) {
    return StyleSheet.create({
        screen: {
            flex: 1,
            backgroundColor: colors.background,
        },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
        },
        backButton: {
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
        },
        headerTitle: {
            flex: 1,
            textAlign: 'center',
            fontSize: typography.lg,
            fontWeight: '600',
            color: colors.text,
        },
        content: {
            padding: spacing.md,
            paddingBottom: spacing.xl * 2,
        },
        subtitle: {
            fontSize: typography.md || 16,
            color: colors.textMuted,
            marginBottom: spacing.xs,
        },
        itemTitle: {
            fontSize: typography.lg || 18,
            fontWeight: '600',
            color: colors.text,
            marginBottom: spacing.md,
        },
        card: {
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: spacing.md,
            ...shadows.sm,
        },
        sourceRow: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: spacing.sm,
        },
        sourceRowBorder: {
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
        },
        sourceInfo: {
            flex: 1,
            marginRight: spacing.sm,
        },
        sourceLabel: {
            fontSize: 15,
            fontWeight: '500',
            color: colors.primary,
            marginBottom: 2,
        },
        sourceUrl: {
            fontSize: 12,
            color: colors.textMuted,
        },
        emptyCard: {
            alignItems: 'center',
            paddingVertical: spacing.xl,
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            ...shadows.sm,
        },
        emptyText: {
            fontSize: 14,
            color: colors.textMuted,
            marginTop: spacing.sm,
        },
        divider: {
            height: 1,
            backgroundColor: colors.border,
            marginVertical: spacing.lg,
        },
        estimateSection: {
            marginBottom: spacing.lg,
        },
        sectionTitle: {
            fontSize: typography.lg || 18,
            fontWeight: '600',
            color: colors.text,
            marginBottom: spacing.sm,
        },
        estimateRow: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
        },
        estimateValue: {
            fontSize: 16,
            fontWeight: '600',
            color: colors.text,
        },
        editButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
        },
        editButtonText: {
            fontSize: 14,
            color: colors.primary,
            fontWeight: '500',
        },
        provideButton: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            backgroundColor: colors.primary,
            borderRadius: radius.lg,
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.lg,
        },
        provideButtonText: {
            fontSize: 16,
            fontWeight: '600',
            color: colors.onPrimary || '#fff',
        },
        inputLabel: {
            fontSize: 14,
            color: colors.textMuted,
            marginBottom: spacing.sm,
        },
        input: {
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.md,
            padding: spacing.sm,
            fontSize: 16,
            color: colors.text,
            backgroundColor: colors.background,
        },
        inputActions: {
            flexDirection: 'row',
            justifyContent: 'flex-end',
            gap: 12,
            marginTop: spacing.md,
        },
        cancelButton: {
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
        },
        cancelButtonText: {
            fontSize: 14,
            color: colors.textMuted,
            fontWeight: '500',
        },
        saveButton: {
            backgroundColor: colors.primary,
            borderRadius: radius.md,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.lg,
            minWidth: 80,
            alignItems: 'center',
        },
        saveButtonText: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.onPrimary || '#fff',
        },
    });
}
