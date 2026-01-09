import React from 'react';
import { ScrollView, Text, View, Linking, Image, StyleSheet } from 'react-native';

export default function AboutScreen() {
    return (
        <ScrollView style={styles.container}>
            <Text style={styles.title}>ShelvesAI</Text>
            <Text style={styles.version}>Version 1.0.0</Text>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Data Sources</Text>

                <View style={styles.attribution}>
                    <Text style={styles.serviceName}>Books</Text>
                    <Text>Data provided by Open Library</Text>
                    <Text
                        style={styles.link}
                        onPress={() => Linking.openURL('https://openlibrary.org')}>
                        openlibrary.org
                    </Text>
                </View>

                <View style={styles.attribution}>
                    <Text style={styles.serviceName}>Movies & TV</Text>
                    <Text>This product uses the TMDB API but is not endorsed or certified by TMDB.</Text>
                    {/* Add TMDB logo here */}
                    <Text
                        style={styles.link}
                        onPress={() => Linking.openURL('https://themoviedb.org')}>
                        themoviedb.org
                    </Text>
                </View>

                <View style={styles.attribution}>
                    <Text style={styles.serviceName}>Video Games</Text>
                    <Text>Game data provided by IGDB.com</Text>
                    <Text
                        style={styles.link}
                        onPress={() => Linking.openURL('https://igdb.com')}>
                        igdb.com
                    </Text>
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Contact</Text>
                <Text>support@yourapp.com</Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, padding: 16 },
    title: { fontSize: 24, fontWeight: 'bold' },
    version: { color: '#666', marginBottom: 24 },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
    attribution: { marginBottom: 16 },
    serviceName: { fontWeight: '600' },
    link: { color: '#007AFF' },
});
