import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../../context/ThemeContext';

/**
 * Overlay component that renders a list of friend suggestions for @mentions.
 * Positioned absolutely above the comment input.
 *
 * Props:
 *   suggestions - array of friend objects { id, username, name, picture, profileMediaUrl }
 *   visible     - whether to show the overlay
 *   onSelect    - callback when a friend is tapped
 *   loading     - show spinner while friends are loading
 */
export default function MentionSuggestions({ suggestions, visible, onSelect, loading }) {
  const { colors, spacing, shadows } = useTheme();
  const styles = useMemo(() => createStyles({ colors, spacing, shadows }), [colors, spacing, shadows]);

  if (!visible) return null;

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Loading friends...</Text>
        </View>
      </View>
    );
  }

  if (!suggestions || suggestions.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyRow}>
          <Text style={styles.emptyText}>No matching friends</Text>
        </View>
      </View>
    );
  }

  const renderItem = ({ item }) => {
    const displayName = item.name || item.username || '?';
    const initial = displayName.charAt(0).toUpperCase();
    const avatarUri = item.profileMediaUrl || item.picture || null;

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => onSelect(item)}
        activeOpacity={0.7}
      >
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        )}
        <View style={styles.info}>
          <Text style={styles.username} numberOfLines={1}>@{item.username}</Text>
          {item.name ? (
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={suggestions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        keyboardShouldPersistTaps="always"
        nestedScrollEnabled
        style={styles.list}
      />
    </View>
  );
}

const createStyles = ({ colors, spacing, shadows }) => StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    maxHeight: 200,
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 4,
    ...shadows.lg,
    zIndex: 999,
    elevation: 10,
    overflow: 'hidden',
  },
  list: {
    maxHeight: 200,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarFallback: {
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: colors.textInverted,
    fontWeight: '600',
    fontSize: 14,
  },
  info: {
    flex: 1,
  },
  username: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  name: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  emptyRow: {
    padding: spacing.md,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
  },
});
