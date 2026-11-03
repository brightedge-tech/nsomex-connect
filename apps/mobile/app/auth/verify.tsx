import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { supabase } from '../../lib/supabase';
import {
  getOtpCooldownSeconds,
  markOtpRequest,
  normalizePhoneNumber,
  sanitizeReturnTo,
} from '../../lib/auth';
import {
  getTranslations,
  resolveLanguage,
  type AuthMode,
  type Language,
  type OnboardingRole,
} from '../../lib/translations';

export default function VerifyPhoneScreen() {
  const params = useLocalSearchParams<{
    role?: string;
    mode?: string;
    phone?: string;
    language?: string;
    returnTo?: string | string[];
  }>();
  const language: Language = resolveLanguage(params.language);
  const copy = getTranslations(language);
  const role: OnboardingRole = params.role === 'provider' ? 'provider' : 'customer';
  const mode: AuthMode = params.mode === 'signup' ? 'signup' : 'login';
  const phone = params.phone ?? '';
  const normalizedPhone = normalizePhoneNumber(phone);
  const returnTo = sanitizeReturnTo(params.returnTo);
  const [code, setCode] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    normalizedPhone ? getOtpCooldownSeconds(normalizedPhone) : 0,
  );
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!normalizedPhone) {
      router.replace({ pathname: '/account', params: { role, mode, language } } as Href);
    }
  }, [language, mode, normalizedPhone, role]);

  useEffect(() => {
    if (remainingSeconds <= 0) return;
    const timer = setTimeout(
      () => setRemainingSeconds((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [remainingSeconds]);

  function openAccount() {
    router.replace({
      pathname: '/account',
      params: {
        role,
        mode,
        language,
        phone,
        returnTo: returnTo ?? undefined,
      },
    } as Href);
  }

  async function verifyCode() {
    if (!normalizedPhone) {
      setErrorMessage(copy.account.invalidPhone);
      return;
    }
    const token = code.trim();
    if (!/^\d{6}$/.test(token)) {
      setErrorMessage(copy.account.invalidCode);
      return;
    }

    setVerifying(true);
    setErrorMessage('');
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: normalizedPhone,
        token,
        type: 'sms',
      });
      if (error) {
        const codeName = error.code?.toLowerCase() ?? '';
        const message = error.message.toLowerCase();
        if (codeName.includes('rate') || codeName.includes('too_many')) {
          setErrorMessage(copy.account.rateLimited);
        } else if (codeName.includes('expired') || message.includes('expired')) {
          setErrorMessage(copy.account.expiredCode);
        } else if (
          codeName.includes('otp') ||
          message.includes('invalid') ||
          message.includes('token')
        ) {
          setErrorMessage(copy.account.incorrectCode);
        } else {
          setErrorMessage(copy.account.verifyCodeError);
        }
        return;
      }

      if (!data.session || !data.user?.phone_confirmed_at) {
        setErrorMessage(copy.account.verifyCodeError);
        return;
      }

      router.replace({
        pathname: '/account',
        params: {
          role,
          mode,
          continue: 'true',
          language,
          returnTo: returnTo ?? undefined,
        },
      } as Href);
    } catch {
      setErrorMessage(copy.account.verifyCodeError);
    } finally {
      setVerifying(false);
    }
  }

  async function resendCode() {
    if (remainingSeconds > 0 || resending || !normalizedPhone) return;

    setResending(true);
    setErrorMessage('');
    try {
      const { error } = await supabase.auth.resend({ type: 'sms', phone: normalizedPhone });
      if (error) {
        const codeName = error.code?.toLowerCase() ?? '';
        setErrorMessage(
          codeName.includes('rate') || codeName.includes('too_many')
            ? copy.account.rateLimited
            : copy.account.sendCodeError,
        );
        return;
      }
      setCode('');
      markOtpRequest(normalizedPhone);
      setRemainingSeconds(getOtpCooldownSeconds(normalizedPhone));
    } catch {
      setErrorMessage(copy.account.sendCodeError);
    } finally {
      setResending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ title: copy.account.verifyTitle }} />
        <Pressable onPress={openAccount} accessibilityRole="button">
          <Text style={styles.back}>‹ {copy.back}</Text>
        </Pressable>
        <Text style={styles.brand}>{copy.brand}</Text>
        <View style={styles.card}>
          <Text style={styles.title}>{copy.account.verifyTitle}</Text>
          <Text style={styles.subtitle}>
            {copy.account.codeSent.replace('{phone}', phone || copy.account.phone)}
          </Text>

          <TextInput
            style={styles.input}
            placeholder={copy.account.otpCode}
            placeholderTextColor="#89958B"
            value={code}
            onChangeText={(value) => {
              setCode(value.replace(/\D/g, '').slice(0, 6));
              setErrorMessage('');
            }}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={6}
            accessibilityLabel={copy.account.otpCode}
          />

          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

          <Pressable
            style={[styles.primaryButton, verifying && styles.disabled]}
            onPress={() => void verifyCode()}
            disabled={verifying || resending}
          >
            {verifying ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>{copy.account.verifyCode}</Text>
            )}
          </Pressable>

          <Pressable
            style={[styles.secondaryButton, (remainingSeconds > 0 || resending) && styles.disabled]}
            onPress={() => void resendCode()}
            disabled={remainingSeconds > 0 || resending || verifying}
          >
            {resending ? (
              <ActivityIndicator color="#16804A" />
            ) : (
              <Text style={styles.secondaryButtonText}>
                {remainingSeconds > 0
                  ? copy.account.resendCountdown.replace('{seconds}', String(remainingSeconds))
                  : copy.account.resendCode}
              </Text>
            )}
          </Pressable>

          <Pressable style={styles.switchButton} onPress={openAccount}>
            <Text style={styles.switchText}>{copy.account.useAnotherPhone}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F8F5' },
  content: { flexGrow: 1, padding: 22, paddingTop: 54, paddingBottom: 40 },
  back: { color: '#16804A', fontSize: 15, fontWeight: '700' },
  brand: { color: '#16804A', fontSize: 13, fontWeight: '800', letterSpacing: 1.5, marginTop: 30 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 22,
    borderWidth: 1,
    borderColor: '#E2EAE3',
    marginTop: 24,
  },
  title: { color: '#15251A', fontSize: 24, fontWeight: '900' },
  subtitle: { color: '#66736A', fontSize: 14, lineHeight: 21, marginTop: 8 },
  input: {
    backgroundColor: '#F8FAF8',
    borderWidth: 1,
    borderColor: '#DDE6DE',
    borderRadius: 11,
    paddingHorizontal: 14,
    height: 54,
    marginTop: 22,
    color: '#15251A',
    textAlign: 'center',
    fontSize: 20,
    letterSpacing: 8,
  },
  error: { color: '#A12A2A', marginTop: 12, lineHeight: 20 },
  primaryButton: {
    backgroundColor: '#16804A',
    borderRadius: 11,
    minHeight: 51,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
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
  disabled: { opacity: 0.6 },
});
