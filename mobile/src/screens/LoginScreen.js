import React, { useContext, useState } from 'react';
import { View, Text, StyleSheet, StatusBar, KeyboardAvoidingView, Platform, ScrollView, Image } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { AuthContext } from '../App';
import { apiRequest, saveToken } from '../services/api';
import { colors, spacing, typography } from '../theme';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';

export default function LoginScreen() {
  const { setToken, apiBase, setNeedsOnboarding } = useContext(AuthContext);
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async () => {
    if (!username || !password) {
      setMessage('Please fill in all fields');
      return;
    }

    try {
      setLoading(true);
      setMessage('');
      if (mode === 'login') {
        const data = await apiRequest({ apiBase, path: '/api/login', method: 'POST', body: { username, password } });
        await saveToken(data.token);
        setNeedsOnboarding(false);
        setToken(data.token);
      } else {
        await apiRequest({ apiBase, path: '/api/register', method: 'POST', body: { username, password } });
        setMessage('Registration successful. You can now log in.');
        setMode('login');
        setPassword('');
      }
    } catch (e) {
      setMessage(e.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setMessage('');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

        <Animated.View entering={FadeInDown.delay(100).duration(800).springify()} style={styles.header}>
          {/* Logo */}
          <View style={styles.logoContainer}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.title}>Shelves.AI</Text>
          <Text style={styles.subtitle}>Display your physical media, digitally.</Text>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(300).duration(800).springify()} style={styles.form}>
          <Text style={styles.formTitle}>{mode === 'login' ? 'Welcome Back' : 'Create Account'}</Text>

          {!!message && (
            <Text style={[styles.message, message.includes('successful') ? styles.success : styles.error]}>
              {message}
            </Text>
          )}

          <Input
            label="Username"
            placeholder="Enter your username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            leftIcon={<Text style={{ fontSize: 18 }}>👤</Text>}
          />

          <Input
            label="Password"
            placeholder="Enter your password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            leftIcon={<Text style={{ fontSize: 18 }}>🔒</Text>}
          />

          <Button
            title={mode === 'login' ? 'Sign In' : 'Sign Up'}
            onPress={submit}
            loading={loading}
            fullWidth
            style={styles.submitButton}
            size="lg"
          />

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              {mode === 'login' ? "Don't have an account? " : "Already have an account? "}
            </Text>
            <Button
              title={mode === 'login' ? 'Sign Up' : 'Log In'}
              variant="ghost"
              size="sm"
              onPress={toggleMode}
            />
          </View>
        </Animated.View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing['2xl'],
  },
  logoContainer: {
    width: 100,
    height: 100,
    marginBottom: spacing.md,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  title: {
    fontFamily: typography.fontFamily.bold,
    fontSize: typography.sizes['3xl'],
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  form: {
    width: '100%',
  },
  formTitle: {
    fontFamily: typography.fontFamily.bold,
    fontSize: typography.sizes.xl,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  submitButton: {
    marginTop: spacing.md,
  },
  message: {
    marginBottom: spacing.md,
    textAlign: 'center',
    fontFamily: typography.fontFamily.medium,
  },
  error: {
    color: colors.error,
  },
  success: {
    color: colors.success,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  footerText: {
    color: colors.textSecondary,
    fontFamily: typography.fontFamily.regular,
  },
});
