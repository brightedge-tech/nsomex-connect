import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { unregisterCurrentAndroidPushDevice } from '../lib/pushNotifications';
import {
  getOtpCooldownSeconds,
  markOtpRequest,
  normalizePhoneNumber,
  sanitizeReturnTo,
} from '../lib/auth';
import {
  getTranslations,
  resolveLanguage,
  type AuthMode,
  type Language,
  type OnboardingRole,
} from '../lib/translations';

type AccountCopy = ReturnType<typeof getTranslations>['account'];

function getAuthErrorMessage(reason: unknown, copy: AccountCopy, verifying: boolean) {
  const code =
    typeof reason === 'object' &&
    reason !== null &&
    'code' in reason &&
    typeof reason.code === 'string'
      ? reason.code.toLowerCase()
      : '';
  const message =
    typeof reason === 'object' &&
    reason !== null &&
    'message' in reason &&
    typeof reason.message === 'string'
      ? reason.message.toLowerCase()
      : '';

  if (code.includes('rate') || code.includes('too_many') || message.includes('rate limit')) {
    return copy.rateLimited;
  }
  if (verifying && (code.includes('expired') || message.includes('expired'))) {
    return copy.expiredCode;
  }
  if (
    verifying &&
    (code.includes('otp') || message.includes('invalid') || message.includes('token'))
  ) {
    return copy.incorrectCode;
  }

  return verifying ? copy.verifyCodeError : copy.sendCodeError;
}

async function clearUnverifiedSession() {
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) console.error('Unable to clear an unverified session', error);
  } catch (error) {
    console.error('Unable to clear an unverified session', error);
  }
}

export default function AccountScreen() {
  const params = useLocalSearchParams<{
    role?: string;
    mode?: string;
    continue?: string;
    language?: string;
    returnTo?: string | string[];
    phone?: string;
  }>();
  const role: OnboardingRole = params.role === 'provider' ? 'provider' : 'customer';
  const [language, setLanguage] = useState<Language>(resolveLanguage(params.language));
  const copy = getTranslations(language);
  const [mode, setMode] = useState<AuthMode>(params.mode === 'login' ? 'login' : 'signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState(params.phone ?? '');
  const [otpCooldownSeconds, setOtpCooldownSeconds] = useState(() => {
    const initialPhone = normalizePhoneNumber(params.phone ?? '');
    return initialPhone ? getOtpCooldownSeconds(initialPhone) : 0;
  });
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const autoContinueStarted = useRef(false);
  const normalizedPhone = normalizePhoneNumber(phone);

  useEffect(() => {
    if (otpCooldownSeconds <= 0) return;
    const timer = setTimeout(
      () => setOtpCooldownSeconds((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [otpCooldownSeconds]);

  const continueToCustomerDestination = useCallback(() => {
    const returnTo = sanitizeReturnTo(params.returnTo);
    if (returnTo) router.replace(returnTo as Href);
    else router.replace('/');
  }, [params.returnTo]);

  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          Alert.alert(copy.account.errorTitle, copy.account.accountError);
          return;
        }
        if (data.session && !data.session.user.phone_confirmed_at) {
          setSession(null);
          void clearUnverifiedSession();
          return;
        }
        setSession(data.session);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('Unable to restore the authentication session', error);
        Alert.alert(copy.account.errorTitle, copy.account.accountError);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession && !newSession.user.phone_confirmed_at) {
        setSession(null);
        setTimeout(() => void clearUnverifiedSession(), 0);
        return;
      }
      setSession(newSession);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [copy.account.accountError, copy.account.errorTitle]);

  const continueToRoleHome = useCallback(
    async (userId: string) => {
      setLoading(true);

      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, role')
          .eq('user_id', userId)
          .maybeSingle();

        if (profileError) throw profileError;

        if (profile?.role === 'admin') {
          router.replace('/admin' as Href);
          return;
        }

        if (role === 'customer') {
          continueToCustomerDestination();
          return;
        }

        const { data: application, error } = await supabase
          .from('provider_applications')
          .select('id, verification_status')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;

        if (application?.verification_status === 'approved' && profile) {
          const { data: provider, error: providerError } = await supabase
            .from('provider_profiles')
            .select('id, verification_status')
            .eq('profile_id', profile.id)
            .maybeSingle();

          if (providerError) throw providerError;
          router.replace(
            provider?.verification_status === 'verified'
              ? ('/provider/dashboard' as Href)
              : ('/provider/setup' as Href),
          );
          return;
        }

        if (application) {
          router.replace({
            pathname: '/provider/verification/[id]',
            params: { id: application.id },
          } as unknown as Href);
        } else {
          router.replace('/provider/register');
        }
      } catch {
        Alert.alert(copy.account.errorTitle, copy.account.applicationLookupError);
      } finally {
        setLoading(false);
      }
    },
    [
      copy.account.applicationLookupError,
      copy.account.errorTitle,
      continueToCustomerDestination,
      role,
    ],
  );

  useEffect(() => {
    if (params.continue !== 'true' || !session || loading || autoContinueStarted.current) {
      return;
    }

    autoContinueStarted.current = true;
    void continueToRoleHome(session.user.id);
  }, [continueToRoleHome, loading, params.continue, session]);

  async function handleSubmit() {
    const cleanName = name.trim().replace(/\s+/g, ' ');
    const cleanEmail = email.trim().toLowerCase();
    if (mode === 'signup' && (cleanName.length < 2 || cleanName.length > 150)) {
      Alert.alert(copy.account.errorTitle, copy.account.invalidName);
      return;
    }
    if (
      mode === 'signup' &&
      (cleanEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))
    ) {
      Alert.alert(copy.account.errorTitle, copy.account.invalidEmail);
      return;
    }
    if (!normalizedPhone) {
      Alert.alert(copy.account.errorTitle, copy.account.invalidPhone);
      return;
    }
    if (getOtpCooldownSeconds(normalizedPhone) > 0) {
      Alert.alert(copy.account.errorTitle, copy.account.rateLimited);
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: normalizedPhone,
        options:
          mode === 'signup'
            ? {
                shouldCreateUser: true,
                data: { full_name: cleanName, email: cleanEmail },
              }
            : { shouldCreateUser: false },
      });
      if (error) throw error;

      markOtpRequest(normalizedPhone);
      setOtpCooldownSeconds(getOtpCooldownSeconds(normalizedPhone));
      router.push({
        pathname: '/auth/verify',
        params: {
          role,
          mode,
          phone: normalizedPhone,
          language,
          returnTo: sanitizeReturnTo(params.returnTo) ?? undefined,
        },
      } as unknown as Href);
    } catch (error) {
      Alert.alert(copy.account.errorTitle, getAuthErrorMessage(error, copy.account, false));
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setLoading(true);
    let pushUnregisterFailed = false;
    try {
      try {
        await unregisterCurrentAndroidPushDevice();
      } catch (error) {
        pushUnregisterFailed = true;
        console.error('Unable to unregister Android push device during sign-out', error);
      }
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setSession(null);
      router.replace({
        pathname: '/account',
        params: { role, mode: 'login', language },
      } as Href);
      Alert.alert(
        copy.account.signOut,
        pushUnregisterFailed ? copy.account.signOutDeviceError : copy.account.signedOut,
      );
    } catch {
      Alert.alert(copy.account.signOutErrorTitle, copy.account.signOutError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ title: copy.account[role] }} />

        <View style={styles.topRow}>
          <Pressable onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.back}>‹ {copy.back}</Text>
          </Pressable>
          <View style={styles.languageOptions}>
            {(['en', 'fr'] as const).map((option) => (
              <Pressable
                key={option}
                style={[styles.languageOption, language === option && styles.languageOptionActive]}
                onPress={() => setLanguage(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: language === option }}
              >
                <Text
                  style={[
                    styles.languageOptionText,
                    language === option && styles.languageOptionTextActive,
                  ]}
                >
                  {option === 'en' ? copy.english : copy.french}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={styles.brand}>{copy.brand}</Text>

        {session ? (
          <View style={styles.card}>
            <Text style={styles.title}>{copy.account.signedInTitle}</Text>
            <Text style={styles.subtitle}>{copy.account[role]}</Text>
            <Text style={styles.email}>
              {session.user.phone || session.user.email || copy.account.phone}
            </Text>

            <Pressable
              style={styles.primaryButton}
              onPress={() => void continueToRoleHome(session.user.id)}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>{copy.account.continue}</Text>
              )}
            </Pressable>

            <Pressable
              style={styles.secondaryButton}
              onPress={() => void handleLogout()}
              disabled={loading}
            >
              <Text style={styles.secondaryButtonText}>{copy.account.signOut}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>{copy.account[role]}</Text>
            </View>
            <Text style={styles.title}>
              {mode === 'signup' ? copy.account.createTitle : copy.account.loginTitle}
            </Text>
            <Text style={styles.subtitle}>
              {(mode === 'signup'
                ? copy.account.createSubtitle
                : copy.account.loginSubtitle
              ).replace('{role}', copy.account[role])}
            </Text>

            {mode === 'signup' && (
              <TextInput
                style={styles.input}
                placeholder={copy.account.fullName}
                placeholderTextColor="#89958B"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoComplete="name"
                maxLength={150}
              />
            )}

            <TextInput
              style={styles.input}
              placeholder={copy.account.phone}
              placeholderTextColor="#89958B"
              value={phone}
              onChangeText={(value) => {
                setPhone(value);
                const nextPhone = normalizePhoneNumber(value);
                setOtpCooldownSeconds(nextPhone ? getOtpCooldownSeconds(nextPhone) : 0);
              }}
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="tel"
              accessibilityLabel={copy.account.phone}
            />
            <Text style={styles.hint}>{copy.account.phoneHint}</Text>

            {mode === 'signup' && (
              <TextInput
                style={styles.input}
                placeholder={copy.account.email}
                placeholderTextColor="#89958B"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                maxLength={320}
              />
            )}

            <Pressable
              style={[styles.primaryButton, (loading || otpCooldownSeconds > 0) && styles.disabled]}
              onPress={() => void handleSubmit()}
              disabled={loading || otpCooldownSeconds > 0}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {otpCooldownSeconds > 0
                    ? copy.account.resendCountdown.replace('{seconds}', String(otpCooldownSeconds))
                    : copy.account.sendCode}
                </Text>
              )}
            </Pressable>

            <Pressable
              style={styles.switchButton}
              onPress={() => setMode(mode === 'signup' ? 'login' : 'signup')}
              disabled={loading}
            >
              <Text style={styles.switchText}>
                {mode === 'signup' ? copy.account.alreadyHaveAccount : copy.account.needAccount}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F8F5' },
  content: { flexGrow: 1, padding: 22, paddingTop: 28, paddingBottom: 40 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 34,
  },
  back: { color: '#16804A', fontSize: 15, fontWeight: '700' },
  languageOptions: { flexDirection: 'row', gap: 5 },
  languageOption: {
    borderWidth: 1,
    borderColor: '#DDE6DE',
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#FFFFFF',
  },
  languageOptionActive: { backgroundColor: '#EAF6EE', borderColor: '#16804A' },
  languageOptionText: { color: '#66736A', fontSize: 12, fontWeight: '700' },
  languageOptionTextActive: { color: '#16804A' },
  brand: {
    color: '#16804A',
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: 1.3,
    marginBottom: 26,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 22,
    borderWidth: 1,
    borderColor: '#E2EAE3',
  },
  rolePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#EAF6EE',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 13,
  },
  rolePillText: { color: '#16804A', fontSize: 12, fontWeight: '800' },
  title: { color: '#15251A', fontSize: 24, fontWeight: '900' },
  subtitle: { color: '#66736A', fontSize: 14, lineHeight: 21, marginTop: 8 },
  input: {
    backgroundColor: '#F8FAF8',
    borderWidth: 1,
    borderColor: '#DDE6DE',
    borderRadius: 11,
    paddingHorizontal: 14,
    height: 51,
    marginTop: 16,
    color: '#15251A',
  },
  hint: { color: '#66736A', fontSize: 12, marginTop: 7 },
  primaryButton: {
    backgroundColor: '#16804A',
    borderRadius: 11,
    minHeight: 51,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  secondaryButton: {
    borderColor: '#16804A',
    borderWidth: 1,
    borderRadius: 11,
    minHeight: 49,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  secondaryButtonText: { color: '#16804A', fontSize: 14, fontWeight: '800' },
  switchButton: { alignItems: 'center', marginTop: 20 },
  switchText: { color: '#16804A', fontSize: 13, fontWeight: '700' },
  email: { color: '#526258', fontSize: 14, marginTop: 18 },
  disabled: { opacity: 0.6 },
});
