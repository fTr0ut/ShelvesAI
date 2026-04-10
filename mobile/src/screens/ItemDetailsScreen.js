import React, { useCallback, useContext, useMemo, useState } from 'react';
import { CommonActions } from '@react-navigation/native';
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
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';
import useBottomFooterLayout from '../navigation/useBottomFooterLayout';

function isGameCollectableKind(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'game' || normalized === 'games';
}

export default function ItemDetailsScreen({ route, navigation }) {
    const { item, shelfId, detailRouteKey, detailNavigatorKey } = route.params || {};
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius } = useTheme();
    const { contentBottomPadding } = useBottomFooterLayout();
    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius],
    );

    const userDetails = item?.userDetails || {};
    const collectableId = item?.collectable?.id || item?.collectableId || null;
    const isGameCollectable = isGameCollectableKind(
        item?.collectable?.kind || item?.collectable?.type || item?.collectableKind,
    );

    const [format, setFormat] = useState(userDetails?.format || '');
    const [series, setSeries] = useState(userDetails?.series || '');
    const [edition, setEdition] = useState(userDetails?.edition || '');
    const [specialMarkings, setSpecialMarkings] = useState(userDetails?.specialMarkings || '');
    const [ageStatement, setAgeStatement] = useState(userDetails?.ageStatement || '');
    const [labelColor, setLabelColor] = useState(userDetails?.labelColor || '');
    const [regional, setRegional] = useState(userDetails?.regional || '');
    const [barcode, setBarcode] = useState(userDetails?.barcode || '');
    const [itemSpecificText, setItemSpecificText] = useState(userDetails?.itemSpecificText || '');
    const [userMarketValue, setUserMarketValue] = useState(userDetails?.userMarketValue || '');
    const [saving, setSaving] = useState(false);

    const contentPaddingBottom = contentBottomPadding(40);

    const saveForItemId = useCallback(async (targetItemId) => (
        apiRequest({
            apiBase,
            path: `/api/shelves/${shelfId}/items/${targetItemId}/details`,
            method: 'PUT',
            token,
            body: {
                ...(!isGameCollectable ? { format } : {}),
                series,
                edition,
                specialMarkings,
                ageStatement,
                labelColor,
                regional,
                barcode,
                itemSpecificText,
                userMarketValue,
            },
        })
    ), [
        ageStatement,
        apiBase,
        barcode,
        edition,
        format,
        isGameCollectable,
        itemSpecificText,
        labelColor,
        regional,
        series,
        shelfId,
        specialMarkings,
        token,
        userMarketValue,
    ]);

    const resolveCollectionItemId = useCallback(async () => {
        const shelfData = await apiRequest({
            apiBase,
            path: `/api/shelves/${shelfId}/items?limit=200&skip=0`,
            token,
        });
        const items = Array.isArray(shelfData?.items) ? shelfData.items : [];
        const matchedItem = items.find((entry) => (
            String(entry?.id) === String(item?.id)
            || (collectableId && String(entry?.collectable?.id) === String(collectableId))
        ));
        return matchedItem?.id || null;
    }, [apiBase, collectableId, item?.id, shelfId, token]);

    const handleSave = useCallback(async () => {
        try {
            setSaving(true);
            let response;
            try {
                response = await saveForItemId(item?.id);
            } catch (err) {
                if (err?.status !== 404) {
                    throw err;
                }
                const resolvedItemId = await resolveCollectionItemId();
                if (!resolvedItemId) {
                    throw err;
                }
                response = await saveForItemId(resolvedItemId);
            }

            if (detailRouteKey && detailNavigatorKey && response?.item) {
                navigation.dispatch({
                    ...CommonActions.setParams({
                        updatedItemDetailsEntry: response.item,
                        updatedItemDetailsAt: Date.now(),
                    }),
                    source: detailRouteKey,
                    target: detailNavigatorKey,
                });
            }
            navigation.goBack();
        } catch (err) {
            Alert.alert('Error', err?.message || 'Failed to save item details');
        } finally {
            setSaving(false);
        }
    }, [detailNavigatorKey, detailRouteKey, item?.id, navigation, resolveCollectionItemId, saveForItemId]);

    const renderInput = (label, value, onChangeText, options = {}) => (
        <View style={styles.inputGroup}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
                style={[styles.input, options.multiline && styles.textArea]}
                value={value}
                onChangeText={onChangeText}
                placeholder={options.placeholder || 'Optional'}
                placeholderTextColor={colors.textMuted}
                editable={!saving}
                multiline={!!options.multiline}
                numberOfLines={options.multiline ? 4 : 1}
                textAlignVertical={options.multiline ? 'top' : 'center'}
            />
        </View>
    );

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <KeyboardAvoidingView
                style={styles.container}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
                        <Ionicons name="close" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Item Details</Text>
                    <TouchableOpacity
                        onPress={handleSave}
                        style={[styles.headerButton, styles.saveButton, saving && styles.saveButtonDisabled]}
                        disabled={saving}
                    >
                        {saving ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                            <Text style={styles.saveButtonText}>Save</Text>
                        )}
                    </TouchableOpacity>
                </View>

                <ScrollView
                    style={styles.container}
                    contentContainerStyle={[styles.content, { paddingBottom: contentPaddingBottom }]}
                    keyboardShouldPersistTaps="handled"
                >
                    {!isGameCollectable && renderInput('Format', format, setFormat, {
                        placeholder: 'e.g., Hardcover, Steelbook, Blu-ray',
                    })}
                    {renderInput('Series', series, setSeries, { placeholder: 'e.g., Criterion Collection' })}
                    {renderInput('Edition', edition, setEdition, { placeholder: 'e.g., First Edition' })}
                    {renderInput('Special Markings', specialMarkings, setSpecialMarkings, {
                        placeholder: 'Unique markings or identifiers',
                    })}
                    {renderInput('Age Statement', ageStatement, setAgeStatement, {
                        placeholder: 'e.g., 12 Year Old',
                    })}
                    {renderInput('Label Color', labelColor, setLabelColor, {
                        placeholder: 'e.g., Black Label',
                    })}
                    {renderInput('Regional', regional, setRegional, {
                        placeholder: 'e.g., Japan Import',
                    })}
                    {renderInput('Barcode', barcode, setBarcode, { placeholder: 'UPC / EAN' })}
                    {renderInput('Item-Specific Text', itemSpecificText, setItemSpecificText, {
                        placeholder: 'Store stickers, inscriptions, pressing notes, etc.',
                        multiline: true,
                    })}
                    {renderInput('Your Market Value', userMarketValue, setUserMarketValue, {
                        placeholder: 'e.g., $45',
                    })}
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

function createStyles({ colors, spacing, typography, shadows, radius }) {
    return StyleSheet.create({
        screen: {
            flex: 1,
            backgroundColor: colors.background,
        },
        container: {
            flex: 1,
        },
        content: {
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.lg,
        },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
        },
        headerButton: {
            minWidth: 44,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
        },
        headerTitle: {
            flex: 1,
            textAlign: 'center',
            color: colors.text,
            fontSize: typography.sizes.lg,
            fontWeight: '700',
        },
        saveButton: {
            alignItems: 'flex-end',
        },
        saveButtonDisabled: {
            opacity: 0.5,
        },
        saveButtonText: {
            color: colors.primary,
            fontSize: typography.sizes.base,
            fontWeight: '700',
        },
        inputGroup: {
            marginBottom: spacing.lg,
        },
        label: {
            color: colors.text,
            fontSize: typography.sizes.xs,
            fontWeight: '700',
            marginBottom: spacing.xs,
        },
        input: {
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            color: colors.text,
            fontSize: typography.sizes.base,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
            ...shadows.sm,
        },
        textArea: {
            minHeight: 120,
        },
    });
}
