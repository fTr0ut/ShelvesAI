import React, { useCallback, useContext, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Image,
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
import * as ImagePicker from 'expo-image-picker';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { CategoryIcon } from '../components/ui';
import { apiRequest, getValidToken } from '../services/api';
import { prepareImageUploadAsset } from '../services/imageUpload';
import { clearShelvesListCache } from '../services/shelvesListCache';
import useBottomFooterLayout from '../navigation/useBottomFooterLayout';

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private', icon: 'lock-closed' },
  { value: 'friends', label: 'Friends', icon: 'people' },
  { value: 'public', label: 'Public', icon: 'globe' },
];

const SHELF_TYPES = [
  { value: 'books', label: 'Books', icon: 'book' },
  { value: 'movies', label: 'Movies', icon: 'film' },
  { value: 'tv', label: 'TV', icon: 'tv' },
  { value: 'games', label: 'Games', icon: 'game-controller' },
  { value: 'music', label: 'Music', icon: 'musical-notes' },
  { value: 'vinyl', label: 'Vinyl', icon: 'disc' },
  { value: 'other', label: 'Other', icon: 'library' },
];

const GAME_PLATFORM_OPTIONS = [
  { value: '', label: 'No default' },
  { value: 'all', label: 'All' },
  { value: 'playstation', label: 'PlayStation' },
  { value: 'xbox', label: 'Xbox' },
  { value: 'nintendo', label: 'Nintendo' },
  { value: 'pc', label: 'PC' },
  { value: 'steam_deck', label: 'Steam Deck' },
  { value: 'custom', label: 'Custom' },
];

const GAME_FORMAT_OPTIONS = [
  { value: '', label: 'No default' },
  { value: 'physical', label: 'Physical' },
  { value: 'digital', label: 'Digital' },
];

export default function ShelfCreateScreen({ navigation, route }) {
  const { token, apiBase } = useContext(AuthContext);
  const { colors, spacing, typography, shadows, radius, isDark } = useTheme();
  const autoAddItem = route?.params?.autoAddItem;

  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [gamePlatformType, setGamePlatformType] = useState('');
  const [customPlatformText, setCustomPlatformText] = useState('');
  const [gameFormat, setGameFormat] = useState('');
  const [shelfPhotoAsset, setShelfPhotoAsset] = useState(null);
  const selectedType = type || 'other';
  const isOtherShelf = selectedType === 'other';
  const isGamesShelf = selectedType === 'games';

  const styles = createStyles({ colors, spacing, typography, shadows, radius });
  const { contentBottomPadding } = useBottomFooterLayout();
  const formBottomPadding = contentBottomPadding(spacing.md);

  const buildShelfPhotoFilename = useCallback((asset) => {
    if (asset?.name) return asset.name;
    if (asset?.fileName) return asset.fileName;
    const uriName = String(asset?.uri || '').split('/').pop();
    if (uriName && uriName.includes('.')) return uriName;
    const mime = String(asset?.type || asset?.mimeType || '').toLowerCase();
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    return `shelf-photo-${Date.now()}.${ext}`;
  }, []);

  const uploadShelfPhotoForShelf = useCallback(async ({ shelfId, asset }) => {
    if (!shelfId || !asset?.uri || !apiBase) return;
    const authToken = await getValidToken(token);
    if (!authToken) throw new Error('Authentication required');

    const formData = new FormData();
    formData.append('photo', {
      uri: asset.uri,
      name: buildShelfPhotoFilename(asset),
      type: asset.type || asset.mimeType || 'image/jpeg',
    });

    const response = await fetch(`${apiBase}/api/shelves/${shelfId}/photo`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'ngrok-skip-browser-warning': 'true',
      },
      body: formData,
    });

    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch (_err) {
      payload = {};
    }
    if (!response.ok) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    clearShelvesListCache();
  }, [apiBase, buildShelfPhotoFilename, token]);

  const handlePickShelfPhoto = useCallback(async () => {
    if (saving) return;

    const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
    const libraryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!cameraPermission.granted && !libraryPermission.granted) {
      Alert.alert('Permission required', 'Camera or photo library permission is required.');
      return;
    }

    let selectedSource = null;
    if (cameraPermission.granted && libraryPermission.granted) {
      selectedSource = await new Promise((resolve) => {
        Alert.alert('Shelf Photo', 'Choose photo source', [
          { text: 'Take Photo', onPress: () => resolve('camera') },
          { text: 'Choose from Library', onPress: () => resolve('library') },
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
        ]);
      });
      if (!selectedSource) return;
    } else if (cameraPermission.granted) {
      selectedSource = 'camera';
    } else {
      selectedSource = 'library';
    }

    const pickerConfig = {
      quality: 0.8,
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      exif: false,
    };

    const result = selectedSource === 'camera'
      ? await ImagePicker.launchCameraAsync(pickerConfig)
      : await ImagePicker.launchImageLibraryAsync(pickerConfig);

    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) {
      Alert.alert('Error', 'No photo selected');
      return;
    }
    const prepared = await prepareImageUploadAsset(asset, {
      namePrefix: 'shelf-photo',
      alwaysTranscode: true,
    });
    if (!prepared?.uri) {
      Alert.alert('Error', 'Failed to prepare photo for upload');
      return;
    }
    setShelfPhotoAsset(prepared);
  }, [saving]);

  const handleCreate = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    const resolvedType = type || 'other';
    if (!trimmedName) {
      setError('Please enter a shelf name');
      return;
    }
    if (resolvedType === 'other' && !trimmedDescription) {
      setError('Description is required for Other shelves');
      return;
    }
    if (resolvedType === 'games' && gamePlatformType === 'custom' && !customPlatformText.trim()) {
      setError('Custom platform text is required when Platform is Custom');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const payload = {
        name: trimmedName,
        type: resolvedType,
        description: trimmedDescription,
        visibility,
      };
      if (resolvedType === 'games') {
        const gameDefaults = {
          platformType: gamePlatformType || null,
          customPlatformText: gamePlatformType === 'custom' ? customPlatformText.trim() : null,
          format: gameFormat || null,
        };
        const hasValues = !!(gameDefaults.platformType || gameDefaults.customPlatformText || gameDefaults.format);
        payload.gameDefaults = hasValues ? gameDefaults : null;
      }
      const data = await apiRequest({ apiBase, path: '/api/shelves', method: 'POST', token, body: payload });
      if (shelfPhotoAsset?.uri) {
        try {
          await uploadShelfPhotoForShelf({ shelfId: data?.shelf?.id, asset: shelfPhotoAsset });
        } catch (uploadErr) {
          Alert.alert('Shelf created', uploadErr?.message || 'Shelf photo failed to upload. You can retry in Edit Shelf.');
        }
      }
      navigation.replace('ShelfDetail', {
        id: data.shelf.id,
        title: data.shelf.name,
        autoAddItem: !!autoAddItem,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }, [
    apiBase,
    name,
    type,
    description,
    visibility,
    navigation,
    token,
    autoAddItem,
    gamePlatformType,
    customPlatformText,
    gameFormat,
    shelfPhotoAsset,
    uploadShelfPhotoForShelf,
  ]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={[styles.content, { paddingBottom: formBottomPadding }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>New Shelf</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Error */}
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Name Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              placeholder="My Collection"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
              editable={!saving}
              autoFocus
            />
          </View>

          <View style={styles.shelfPhotoCard}>
            <View style={styles.shelfPhotoMedia}>
              {shelfPhotoAsset?.uri ? (
                <Image source={{ uri: shelfPhotoAsset.uri }} style={styles.shelfPhotoImage} />
              ) : (
                <View style={styles.shelfPhotoFallback}>
                  <CategoryIcon type={selectedType || 'other'} size={28} />
                </View>
              )}
            </View>
            <View style={styles.shelfPhotoContent}>
              <Text style={styles.shelfPhotoTitle}>Shelf Photo</Text>
              <Text style={styles.shelfPhotoSubtitle}>
                {shelfPhotoAsset?.uri
                  ? 'Selected photo will upload right after shelf creation.'
                  : 'Optional. Add a custom image for this shelf.'}
              </Text>
              <View style={styles.shelfPhotoActions}>
                <TouchableOpacity
                  style={[styles.shelfPhotoButton, saving && styles.shelfPhotoButtonDisabled]}
                  onPress={handlePickShelfPhoto}
                  disabled={saving}
                >
                  <Ionicons name="image-outline" size={16} color={colors.primary} />
                  <Text style={styles.shelfPhotoButtonText}>
                    {shelfPhotoAsset?.uri ? 'Replace' : 'Upload'}
                  </Text>
                </TouchableOpacity>
                {shelfPhotoAsset?.uri ? (
                  <TouchableOpacity
                    style={[styles.shelfPhotoRemoveButton, saving && styles.shelfPhotoButtonDisabled]}
                    onPress={() => setShelfPhotoAsset(null)}
                    disabled={saving}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                    <Text style={styles.shelfPhotoRemoveText}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>

          {/* Type Selection */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Type</Text>
            <View style={styles.chipGrid}>
              {SHELF_TYPES.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.chip, type === opt.value && styles.chipActive]}
                  onPress={() => setType(opt.value)}
                  disabled={saving}
                >
                  <Ionicons
                    name={opt.icon}
                    size={16}
                    color={type === opt.value ? colors.textInverted : colors.textSecondary}
                  />
                  <Text style={[styles.chipText, type === opt.value && styles.chipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Description */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>
              Description{' '}
              <Text style={styles.optional}>
                {isOtherShelf ? '(required for Other shelves)' : '(optional)'}
              </Text>
            </Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder={isOtherShelf ? 'Describe what this Other shelf contains' : "What's in this collection?"}
              placeholderTextColor={colors.textMuted}
              value={description}
              onChangeText={setDescription}
              editable={!saving}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {isGamesShelf ? (
            <View style={styles.defaultsCard}>
              <Text style={styles.label}>Games Defaults</Text>
              <Text style={styles.helperText}>Used to fill your collection automatically.</Text>

              <View style={styles.defaultsSection}>
                <Text style={styles.subLabel}>Platform Type (optional)</Text>
                <View style={styles.optionRow}>
                  {GAME_PLATFORM_OPTIONS.map((option) => {
                    const selected = gamePlatformType === option.value;
                    return (
                      <TouchableOpacity
                        key={option.value || 'none'}
                        style={[styles.optionChip, selected && styles.optionChipActive]}
                        onPress={() => setGamePlatformType(option.value)}
                        disabled={saving}
                      >
                        <Text style={[styles.optionChipText, selected && styles.optionChipTextActive]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {gamePlatformType === 'custom' ? (
                  <TextInput
                    style={[styles.input, styles.inlineInput]}
                    placeholder="Enter custom platform"
                    placeholderTextColor={colors.textMuted}
                    value={customPlatformText}
                    onChangeText={setCustomPlatformText}
                    editable={!saving}
                  />
                ) : null}
              </View>

              <View style={styles.defaultsSection}>
                <Text style={styles.subLabel}>Format Type (optional)</Text>
                <View style={styles.optionRow}>
                  {GAME_FORMAT_OPTIONS.map((option) => {
                    const selected = gameFormat === option.value;
                    return (
                      <TouchableOpacity
                        key={option.value || 'none'}
                        style={[styles.optionChip, selected && styles.optionChipActive]}
                        onPress={() => setGameFormat(option.value)}
                        disabled={saving}
                      >
                        <Text style={[styles.optionChipText, selected && styles.optionChipTextActive]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>
          ) : null}

          {/* Visibility */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Visibility</Text>
            <View style={styles.visibilityRow}>
              {VISIBILITY_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.visibilityOption, visibility === opt.value && styles.visibilityActive]}
                  onPress={() => setVisibility(opt.value)}
                  disabled={saving}
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
        </ScrollView>

        {/* Fixed Create Button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.createButton, saving && styles.createButtonDisabled]}
            onPress={handleCreate}
            disabled={saving || !name.trim()}
          >
            {saving ? (
              <Text style={styles.createButtonText}>{shelfPhotoAsset?.uri ? 'Creating & Uploading...' : 'Creating...'}</Text>
            ) : (
              <>
                <Ionicons name="add-circle" size={20} color={colors.textInverted} />
                <Text style={styles.createButtonText}>Create Shelf</Text>
              </>
            )}
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
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.error + '15',
    padding: spacing.sm,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
    flex: 1,
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
  optional: {
    fontWeight: '400',
    color: colors.textMuted,
  },
  helperText: {
    fontSize: 13,
    color: colors.textMuted,
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
    minHeight: 100,
    paddingTop: spacing.md,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.textInverted,
    fontWeight: '500',
  },
  shelfPhotoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.sm,
  },
  shelfPhotoMedia: {
    width: 84,
    height: 84,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
  },
  shelfPhotoImage: {
    width: '100%',
    height: '100%',
  },
  shelfPhotoFallback: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary + '12',
  },
  shelfPhotoContent: {
    flex: 1,
  },
  shelfPhotoTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  shelfPhotoSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  shelfPhotoActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  shelfPhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.primary + '55',
    backgroundColor: colors.primary + '10',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  shelfPhotoButtonText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  shelfPhotoRemoveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.error + '55',
    backgroundColor: colors.error + '10',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  shelfPhotoRemoveText: {
    fontSize: 12,
    color: colors.error,
    fontWeight: '600',
  },
  shelfPhotoButtonDisabled: {
    opacity: 0.55,
  },
  defaultsCard: {
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadows.sm,
  },
  defaultsSection: {
    marginTop: spacing.sm,
  },
  subLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  optionChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  optionChipActive: {
    backgroundColor: colors.primary + '18',
    borderColor: colors.primary,
  },
  optionChipText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  optionChipTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  inlineInput: {
    marginTop: spacing.sm,
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
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    ...shadows.md,
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
