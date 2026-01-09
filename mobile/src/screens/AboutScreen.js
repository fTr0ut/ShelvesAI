import React, { useMemo } from 'react';
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    Linking,
    StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

export default function AboutScreen({ navigation }) {
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();
    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);

    const openLink = (url) => {
        Linking.openURL(url).catch(() => { });
    };

    return (
        <View style={styles.screen}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>About</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                {/* Logo */}
                <View style={styles.logoSection}>
                    <View style={styles.logoBox}>
                        <Ionicons name="library" size={48} color={colors.primary} />
                    </View>
                    <Text style={styles.appName}>ShelvesAI</Text>
                    <Text style={styles.version}>Version 1.0.0</Text>
                </View>

                {/* Description */}
                <View style={styles.card}>
                    <Text style={styles.description}>
                        ShelvesAI helps you organize and catalog your collections.
                        Use AI-powered scanning to quickly add books, games, vinyl,
                        and more to your shelves.
                    </Text>
                </View>

                {/* Features */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Features</Text>
                    <View style={styles.featureList}>
                        <View style={styles.featureItem}>
                            <Ionicons name="camera" size={20} color={colors.primary} />
                            <Text style={styles.featureText}>AI Vision scanning</Text>
                        </View>
                        <View style={styles.featureItem}>
                            <Ionicons name="library" size={20} color={colors.primary} />
                            <Text style={styles.featureText}>Organize by shelves</Text>
                        </View>
                        <View style={styles.featureItem}>
                            <Ionicons name="people" size={20} color={colors.primary} />
                            <Text style={styles.featureText}>Share with friends</Text>
                        </View>
                        <View style={styles.featureItem}>
                            <Ionicons name="logo-steam" size={20} color={colors.primary} />
                            <Text style={styles.featureText}>Steam integration</Text>
                        </View>
                    </View>
                </View>

                {/* Links */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Legal</Text>
                    <TouchableOpacity style={styles.linkRow} onPress={() => openLink('https://shelvesai.com/privacy')}>
                        <Text style={styles.linkText}>Privacy Policy</Text>
                        <Ionicons name="open-outline" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.linkRow} onPress={() => openLink('https://shelvesai.com/terms')}>
                        <Text style={styles.linkText}>Terms of Service</Text>
                        <Ionicons name="open-outline" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                </View>

                {/* Attribution */}
                <Text style={styles.attribution}>
                    Made with ❤️ for collectors everywhere
                </Text>
            </ScrollView>
        </View>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) => StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
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
        fontSize: 18,
        fontWeight: '600',
        color: colors.text,
    },
    content: {
        padding: spacing.md,
        paddingBottom: 40,
    },
    logoSection: {
        alignItems: 'center',
        marginBottom: spacing.xl,
    },
    logoBox: {
        width: 88,
        height: 88,
        borderRadius: 22,
        backgroundColor: colors.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.md,
    },
    appName: {
        fontSize: 24,
        fontWeight: '700',
        color: colors.text,
    },
    version: {
        fontSize: 14,
        color: colors.textMuted,
        marginTop: 4,
    },
    card: {
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.md,
        ...shadows.sm,
    },
    cardTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: spacing.sm,
    },
    description: {
        fontSize: 15,
        color: colors.text,
        lineHeight: 22,
    },
    featureList: {
        gap: spacing.sm,
    },
    featureItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    featureText: {
        fontSize: 15,
        color: colors.text,
    },
    linkRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    linkText: {
        fontSize: 15,
        color: colors.text,
    },
    attribution: {
        textAlign: 'center',
        fontSize: 13,
        color: colors.textMuted,
        marginTop: spacing.lg,
    },
});
