import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import {
  PushRegistrationError,
  registerCurrentAndroidPushDevice,
} from '../../lib/pushNotifications';
import { getTranslations, resolveLanguage, type Language } from '../../lib/translations';

type Preferences = {
  user_id: string;
  push_enabled: boolean;
  service_requests: boolean;
  provider_responses: boolean;
  booking_updates: boolean;
  messages: boolean;
  verification_updates: boolean;
  preferred_language: Language;
};

type PreferenceField =
  | 'push_enabled'
  | 'service_requests'
  | 'provider_responses'
  | 'booking_updates'
  | 'messages'
  | 'verification_updates';

const defaults = {
  push_enabled: false,
  service_requests: true,
  provider_responses: true,
  booking_updates: true,
  messages: true,
  verification_updates: true,
  preferred_language: 'en' as Language,
};

export default function NotificationPreferencesScreen() {
  const params = useLocalSearchParams<{ language?: string }>();
  const [language, setLanguage] = useState<Language>(resolveLanguage(params.language));
  const copy = getTranslations(language).notificationPreferences;
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [signedIn, setSignedIn] = useState(false);

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userResult.user) {
        setSignedIn(false);
        setPreferences(null);
        return;
      }

      setSignedIn(true);
      const { data, error: readError } = await supabase
        .from('notification_preferences')
        .select(
          'user_id, push_enabled, service_requests, provider_responses, booking_updates, messages, verification_updates, preferred_language',
        )
        .eq('user_id', userResult.user.id)
        .maybeSingle();
      if (readError) throw readError;

      if (data) {
        const row = data as Preferences;
        setPreferences(row);
        setLanguage(row.preferred_language);
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('notification_preferences')
          .insert({ user_id: userResult.user.id, ...defaults })
          .select(
            'user_id, push_enabled, service_requests, provider_responses, booking_updates, messages, verification_updates, preferred_language',
          )
          .single();
        if (insertError) throw insertError;
        const row = inserted as Preferences;
        setPreferences(row);
        setLanguage(row.preferred_language);
      }
    } catch {
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [copy.loadError]);

  useFocusEffect(
    useCallback(() => {
      void loadPreferences();
    }, [loadPreferences]),
  );

  async function updatePreference(field: PreferenceField, value: boolean) {
    if (!preferences || saving) return;
    setSaving(true);
    setError('');
    try {
      if (field === 'push_enabled' && value) {
        try {
          await registerCurrentAndroidPushDevice();
        } catch (reason) {
          if (reason instanceof PushRegistrationError) {
            const reasonCopy = getTranslations(language).notificationPreferences;
            setError(reasonCopy[reason.reason]);
            return;
          }
          setError(copy.saveError);
          return;
        }
      }

      const { data, error: updateError } = await supabase
        .from('notification_preferences')
        .update({ [field]: value })
        .eq('user_id', preferences.user_id)
        .select(
          'user_id, push_enabled, service_requests, provider_responses, booking_updates, messages, verification_updates, preferred_language',
        )
        .single();
      if (updateError) throw updateError;
      setPreferences(data as Preferences);
    } catch {
      setError(copy.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function updateLanguage(nextLanguage: Language) {
    if (!preferences || saving || nextLanguage === language) return;
    setSaving(true);
    setError('');
    try {
      const { data, error: updateError } = await supabase
        .from('notification_preferences')
        .update({ preferred_language: nextLanguage })
        .eq('user_id', preferences.user_id)
        .select(
          'user_id, push_enabled, service_requests, provider_responses, booking_updates, messages, verification_updates, preferred_language',
        )
        .single();
      if (updateError) throw updateError;
      setPreferences(data as Preferences);
      setLanguage(nextLanguage);
    } catch {
      setError(copy.saveError);
    } finally {
      setSaving(false);
    }
  }

  const rows: { field: PreferenceField; label: string }[] = [
    { field: 'push_enabled', label: copy.pushEnabled },
    { field: 'service_requests', label: copy.serviceRequests },
    { field: 'provider_responses', label: copy.providerResponses },
    { field: 'booking_updates', label: copy.bookingUpdates },
    { field: 'messages', label: copy.messages },
    { field: 'verification_updates', label: copy.verificationUpdates },
  ];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: copy.title }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.back}>‹ {getTranslations(language).back}</Text>
        </Pressable>
        <Text style={styles.brand}>NSOMEX CONNECT</Text>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
          </View>
        ) : !signedIn ? (
          <View style={styles.card}>
            <Text style={styles.body}>{copy.signInRequired}</Text>
          </View>
        ) : preferences ? (
          <>
            <View style={styles.card}>
              {rows.map((row) => (
                <View key={row.field} style={styles.preferenceRow}>
                  <Text style={styles.preferenceLabel}>{row.label}</Text>
                  {saving && row.field === 'push_enabled' ? (
                    <ActivityIndicator color="#16804A" />
                  ) : (
                    <Switch
                      value={preferences[row.field]}
                      onValueChange={(value) => void updatePreference(row.field, value)}
                      disabled={saving}
                      trackColor={{ false: '#CBD5CC', true: '#8AC8A1' }}
                      thumbColor={preferences[row.field] ? '#16804A' : '#F4F4F4'}
                      accessibilityLabel={row.label}
                    />
                  )}
                </View>
              ))}
            </View>

            <Text style={styles.sectionTitle}>{copy.language}</Text>
            <View style={styles.languageOptions}>
              {(['en', 'fr'] as const).map((option) => (
                <Pressable
                  key={option}
                  style={[
                    styles.languageOption,
                    language === option && styles.languageOptionActive,
                    saving && styles.disabled,
                  ]}
                  onPress={() => void updateLanguage(option)}
                  disabled={saving}
                >
                  <Text
                    style={[styles.languageText, language === option && styles.languageTextActive]}
                  >
                    {option === 'en'
                      ? getTranslations(language).english
                      : getTranslations(language).french}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void loadPreferences()}>
              <Text style={styles.retry}>{getTranslations(language).customerRequests.retry}</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F8F5' },
  content: { padding: 20, paddingTop: 54, paddingBottom: 45 },
  back: { color: '#16804A', fontSize: 15, fontWeight: '700' },
  brand: { color: '#16804A', fontSize: 13, fontWeight: '800', letterSpacing: 1.5, marginTop: 22 },
  title: { color: '#15251A', fontSize: 27, fontWeight: '900', marginTop: 18 },
  subtitle: { color: '#66736A', fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 20 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 16,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  preferenceRow: {
    minHeight: 58,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF1ED',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  preferenceLabel: { flex: 1, color: '#26372B', fontSize: 14, fontWeight: '700' },
  sectionTitle: { color: '#15251A', fontSize: 15, fontWeight: '800', marginBottom: 10 },
  languageOptions: { flexDirection: 'row', gap: 10 },
  languageOption: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#DDE6DE',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  languageOptionActive: { backgroundColor: '#EAF6EE', borderColor: '#16804A' },
  languageText: { color: '#66736A', fontSize: 13, fontWeight: '700' },
  languageTextActive: { color: '#16804A' },
  body: { color: '#536358', lineHeight: 21, paddingVertical: 16 },
  center: { paddingVertical: 50, alignItems: 'center' },
  errorCard: { backgroundColor: '#FCECEC', borderRadius: 10, padding: 14, marginTop: 14 },
  errorText: { color: '#8E2525', lineHeight: 20 },
  retry: { color: '#16804A', fontWeight: '800', marginTop: 8 },
  disabled: { opacity: 0.6 },
});
