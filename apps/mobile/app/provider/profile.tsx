import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { getTranslations } from '../../lib/translations';
import { getLocalDateString } from '../../lib/dateTime';
import { usePersistentLanguage } from '../../lib/usePersistentLanguage';

type ProviderProfile = {
  id: string;
  profile_id: string;
  professional_name: string;
  description: string | null;
  years_experience: number;
  verification_status: string;
  availability_status: 'available' | 'unavailable' | 'busy';
};
type WorkingHour = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};
type AvailabilityException = {
  id: string;
  exception_date: string;
  is_available: boolean;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
};
type PickedPhoto = DocumentPicker.DocumentPickerAsset;
const allowedImages = ['image/jpeg', 'image/png', 'image/webp'] as const;
const maxImageSize = 10 * 1024 * 1024;

export default function ProviderProfileScreen() {
  const params = useLocalSearchParams<{ language?: string | string[] }>();
  const [language, setLanguage] = usePersistentLanguage(params.language);
  const copy = getTranslations(language).providerProfile;
  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [experience, setExperience] = useState('0');
  const [availability, setAvailability] =
    useState<ProviderProfile['availability_status']>('unavailable');
  const [hours, setHours] = useState<WorkingHour[]>([]);
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([]);
  const [day, setDay] = useState(1);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [exceptionDate, setExceptionDate] = useState('');
  const [exceptionAvailable, setExceptionAvailable] = useState(false);
  const [exceptionStartTime, setExceptionStartTime] = useState('09:00');
  const [exceptionEndTime, setExceptionEndTime] = useState('17:00');
  const [exceptionReason, setExceptionReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userResult.user) throw new Error(copy.signInRequired);

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, avatar_url')
        .eq('user_id', userResult.user.id)
        .single();
      if (profileError) throw profileError;

      const { data: providerData, error: providerError } = await supabase
        .from('provider_profiles')
        .select(
          'id, profile_id, professional_name, description, years_experience, verification_status, availability_status',
        )
        .eq('profile_id', profileData.id)
        .maybeSingle();
      if (providerError) throw providerError;
      if (!providerData || providerData.verification_status !== 'verified') {
        throw new Error(copy.verifiedRequired);
      }

      const [hoursResult, exceptionsResult] = await Promise.all([
        supabase
          .from('provider_availability')
          .select('id, day_of_week, start_time, end_time')
          .eq('provider_id', providerData.id)
          .order('day_of_week')
          .order('start_time')
          .limit(100),
        supabase
          .from('provider_availability_exceptions')
          .select('id, exception_date, is_available, start_time, end_time, reason')
          .eq('provider_id', providerData.id)
          .gte('exception_date', getLocalDateString())
          .order('exception_date')
          .limit(100),
      ]);
      if (hoursResult.error) throw hoursResult.error;
      if (exceptionsResult.error) throw exceptionsResult.error;

      setProvider(providerData as ProviderProfile);
      setAvatarUrl(profileData.avatar_url);
      setName(providerData.professional_name);
      setDescription(providerData.description ?? '');
      setExperience(String(providerData.years_experience));
      setAvailability(providerData.availability_status);
      setHours((hoursResult.data ?? []) as WorkingHour[]);
      setExceptions((exceptionsResult.data ?? []) as AvailabilityException[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.error);
    } finally {
      setLoading(false);
    }
  }, [copy.error, copy.signInRequired, copy.verifiedRequired]);

  useFocusEffect(
    useCallback(() => {
      void loadProfile();
    }, [loadProfile]),
  );

  async function choosePhoto() {
    setError('');
    setNotice('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...allowedImages],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (
        !asset ||
        !allowedImages.includes(asset.mimeType as (typeof allowedImages)[number]) ||
        (asset.size !== undefined && asset.size > maxImageSize)
      ) {
        throw new Error(copy.photoError);
      }
      setPhoto(asset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.photoError);
    }
  }

  async function saveProfile() {
    setError('');
    setNotice('');
    const years = Number(experience);
    if (!name.trim()) {
      setError(copy.nameRequired);
      return;
    }
    if (!Number.isInteger(years) || years < 0 || years > 100) {
      setError(copy.error);
      return;
    }
    if (!provider) {
      setError(copy.error);
      return;
    }

    setSaving(true);
    let uploadedPath: string | null = null;
    try {
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userResult.user) throw new Error(copy.signInRequired);

      let nextAvatarUrl = avatarUrl;
      if (photo) {
        const response = await fetch(photo.uri);
        if (!response.ok) throw new Error(copy.photoError);
        const fileData = await response.arrayBuffer();
        if (fileData.byteLength > maxImageSize) throw new Error(copy.photoError);
        const extension =
          photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg';
        uploadedPath = `${userResult.user.id}/${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2)}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from('provider-avatars')
          .upload(uploadedPath, fileData, {
            contentType: photo.mimeType ?? undefined,
            upsert: false,
          });
        if (uploadError) throw uploadError;
        nextAvatarUrl = supabase.storage.from('provider-avatars').getPublicUrl(uploadedPath)
          .data.publicUrl;
      }

      const { error: updateProviderError } = await supabase
        .from('provider_profiles')
        .update({
          professional_name: name.trim(),
          description: description.trim() || null,
          years_experience: years,
          availability_status: availability,
        })
        .eq('id', provider.id);
      if (updateProviderError) throw updateProviderError;

      if (photo) {
        const { error: updatePhotoError } = await supabase
          .from('profiles')
          .update({ avatar_url: nextAvatarUrl })
          .eq('id', provider.profile_id);
        if (updatePhotoError) throw updatePhotoError;
      }

      setAvatarUrl(nextAvatarUrl);
      setPhoto(null);
      setNotice(copy.success);
    } catch (reason) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage
          .from('provider-avatars')
          .remove([uploadedPath]);
        if (cleanupError) {
          setError(
            `${reason instanceof Error ? reason.message : copy.error} ${cleanupError.message}`,
          );
          setSaving(false);
          return;
        }
      }
      setError(reason instanceof Error ? reason.message : copy.error);
    } finally {
      setSaving(false);
    }
  }

  async function addHours() {
    if (!provider || savingHours) return;
    if (
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
      startTime >= endTime
    ) {
      setError(copy.invalidHours);
      return;
    }
    setSavingHours(true);
    setError('');
    setNotice('');
    try {
      const { data, error: insertError } = await supabase
        .from('provider_availability')
        .insert({
          provider_id: provider.id,
          day_of_week: day,
          start_time: startTime,
          end_time: endTime,
          is_available: true,
        })
        .select('id, day_of_week, start_time, end_time')
        .single();
      if (insertError) throw insertError;
      setHours((current) =>
        [...current, data as WorkingHour].sort(
          (left, right) =>
            left.day_of_week - right.day_of_week || left.start_time.localeCompare(right.start_time),
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.error);
    } finally {
      setSavingHours(false);
    }
  }

  async function removeHours(hour: WorkingHour) {
    setError('');
    setNotice('');
    const { error: deleteError } = await supabase
      .from('provider_availability')
      .delete()
      .eq('id', hour.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setHours((current) => current.filter((item) => item.id !== hour.id));
  }

  function isValidFutureDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, date] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, date));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== date
    ) {
      return false;
    }
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    return value >= today;
  }

  async function saveException() {
    if (!provider || savingHours) return;
    if (!isValidFutureDate(exceptionDate)) {
      setError(copy.invalidExceptionDate);
      return;
    }
    if (
      exceptionAvailable &&
      (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(exceptionStartTime) ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(exceptionEndTime) ||
        exceptionStartTime >= exceptionEndTime)
    ) {
      setError(copy.invalidHours);
      return;
    }

    setSavingHours(true);
    setError('');
    setNotice('');
    try {
      const { data, error: upsertError } = await supabase
        .from('provider_availability_exceptions')
        .upsert(
          {
            provider_id: provider.id,
            exception_date: exceptionDate,
            is_available: exceptionAvailable,
            start_time: exceptionAvailable ? exceptionStartTime : null,
            end_time: exceptionAvailable ? exceptionEndTime : null,
            reason: exceptionReason.trim() || null,
          },
          { onConflict: 'provider_id,exception_date' },
        )
        .select('id, exception_date, is_available, start_time, end_time, reason')
        .single();
      if (upsertError) throw upsertError;
      setExceptions((current) =>
        [...current.filter((item) => item.exception_date !== data.exception_date), data].sort(
          (left, right) => left.exception_date.localeCompare(right.exception_date),
        ),
      );
      setExceptionDate('');
      setExceptionReason('');
      setNotice(copy.success);
    } catch {
      setError(copy.exceptionError);
    } finally {
      setSavingHours(false);
    }
  }

  async function removeException(exception: AvailabilityException) {
    setError('');
    setNotice('');
    const { error: deleteError } = await supabase
      .from('provider_availability_exceptions')
      .delete()
      .eq('id', exception.id)
      .eq('provider_id', provider?.id);
    if (deleteError) {
      setError(copy.exceptionError);
      return;
    }
    setExceptions((current) => current.filter((item) => item.id !== exception.id));
  }

  const days = getTranslations(language).providerProfile.days;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: copy.title }} />
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.back}>‹ {getTranslations(language).back}</Text>
          </Pressable>
          <View style={styles.languageOptions}>
            {(['en', 'fr'] as const).map((option) => (
              <Pressable
                key={option}
                style={[styles.languageOption, language === option && styles.languageActive]}
                onPress={() => setLanguage(option)}
              >
                <Text style={styles.languageText}>{option.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Text style={styles.brand}>NSOMEX CONNECT</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{copy.title}</Text>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
            <Text style={styles.muted}>{copy.loading}</Text>
          </View>
        ) : !provider ? (
          <View style={styles.card}>
            <Text style={styles.errorText}>{error || copy.error}</Text>
            <Pressable style={styles.secondaryButton} onPress={() => void loadProfile()}>
              <Text style={styles.secondaryButtonText}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>{copy.photo}</Text>
              <View style={styles.photoRow}>
                {photo ? (
                  <Text style={styles.photoName}>{photo.name}</Text>
                ) : avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarInitial}>
                      {name.slice(0, 1).toUpperCase() || 'N'}
                    </Text>
                  </View>
                )}
                <Pressable style={styles.secondaryButton} onPress={() => void choosePhoto()}>
                  <Text style={styles.secondaryButtonText}>{copy.choosePhoto}</Text>
                </Pressable>
              </View>

              <Text style={styles.label}>{copy.name}</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                maxLength={200}
                autoCapitalize="words"
              />
              <Text style={styles.label}>{copy.description}</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={description}
                onChangeText={setDescription}
                maxLength={10000}
                multiline
                textAlignVertical="top"
              />
              <Text style={styles.label}>{copy.experience}</Text>
              <TextInput
                style={styles.input}
                value={experience}
                onChangeText={setExperience}
                keyboardType="number-pad"
                maxLength={3}
              />
              <Pressable
                style={styles.availableRow}
                onPress={() =>
                  setAvailability((current) =>
                    current === 'available' ? 'unavailable' : 'available',
                  )
                }
                accessibilityRole="checkbox"
                accessibilityState={{ checked: availability === 'available' }}
              >
                <Text
                  style={[styles.checkbox, availability === 'available' && styles.checkboxActive]}
                >
                  {availability === 'available' ? '✓' : ''}
                </Text>
                <Text style={styles.body}>{copy.availableNow}</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, saving && styles.disabled]}
                onPress={() => void saveProfile()}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>{copy.save}</Text>
                )}
              </Pressable>
              {notice ? <Text style={styles.successText}>{notice}</Text> : null}
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{copy.hours}</Text>
              {hours.length ? (
                hours.map((hour) => (
                  <View key={hour.id} style={styles.hourRow}>
                    <Text style={styles.body}>
                      {days[hour.day_of_week]} · {hour.start_time.slice(0, 5)}–
                      {hour.end_time.slice(0, 5)}
                    </Text>
                    <Pressable onPress={() => void removeHours(hour)}>
                      <Text style={styles.removeText}>{copy.remove}</Text>
                    </Pressable>
                  </View>
                ))
              ) : (
                <Text style={styles.muted}>{copy.noHours}</Text>
              )}
              <Text style={styles.label}>{copy.day}</Text>
              <View style={styles.dayOptions}>
                {days.map((dayName, index) => (
                  <Pressable
                    key={dayName}
                    style={[styles.dayOption, day === index && styles.daySelected]}
                    onPress={() => setDay(index)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: day === index }}
                  >
                    <Text style={[styles.dayText, day === index && styles.dayTextSelected]}>
                      {dayName.slice(0, 3)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.timeRow}>
                <View style={styles.timeField}>
                  <Text style={styles.label}>{copy.startTime}</Text>
                  <TextInput
                    style={styles.input}
                    value={startTime}
                    onChangeText={setStartTime}
                    maxLength={5}
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.timeField}>
                  <Text style={styles.label}>{copy.endTime}</Text>
                  <TextInput
                    style={styles.input}
                    value={endTime}
                    onChangeText={setEndTime}
                    maxLength={5}
                    autoCapitalize="none"
                  />
                </View>
              </View>
              <Pressable
                style={[styles.secondaryButton, savingHours && styles.disabled]}
                onPress={() => void addHours()}
                disabled={savingHours}
              >
                {savingHours ? (
                  <ActivityIndicator color="#16804A" />
                ) : (
                  <Text style={styles.secondaryButtonText}>{copy.addHours}</Text>
                )}
              </Pressable>
              <Text style={styles.sectionTitle}>{copy.exceptions}</Text>
              <Text style={styles.muted}>{copy.exceptionsHint}</Text>
              {exceptions.length ? (
                exceptions.map((exception) => (
                  <View key={exception.id} style={styles.hourRow}>
                    <View style={styles.exceptionText}>
                      <Text style={styles.body}>
                        {new Date(`${exception.exception_date}T00:00:00`).toLocaleDateString(
                          language === 'fr' ? 'fr-FR' : 'en',
                          { dateStyle: 'medium' },
                        )}
                        {' · '}
                        {exception.is_available
                          ? `${copy.availableDate} · ${exception.start_time?.slice(0, 5)}–${exception.end_time?.slice(0, 5)}`
                          : copy.unavailableDate}
                      </Text>
                      {exception.reason ? (
                        <Text style={styles.muted}>{exception.reason}</Text>
                      ) : null}
                    </View>
                    <Pressable onPress={() => void removeException(exception)}>
                      <Text style={styles.removeText}>{copy.removeException}</Text>
                    </Pressable>
                  </View>
                ))
              ) : (
                <Text style={styles.muted}>{copy.noExceptions}</Text>
              )}
              <Text style={styles.label}>{copy.exceptionDate}</Text>
              <TextInput
                style={styles.input}
                value={exceptionDate}
                onChangeText={setExceptionDate}
                placeholder={copy.exceptionDate}
                maxLength={10}
                autoCapitalize="none"
              />
              <Pressable
                style={styles.availableRow}
                onPress={() => setExceptionAvailable((current) => !current)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: exceptionAvailable }}
              >
                <Text style={[styles.checkbox, exceptionAvailable && styles.checkboxActive]}>
                  {exceptionAvailable ? '✓' : ''}
                </Text>
                <Text style={styles.body}>{copy.availableDate}</Text>
              </Pressable>
              {exceptionAvailable ? (
                <View style={styles.timeRow}>
                  <View style={styles.timeField}>
                    <Text style={styles.label}>{copy.startTime}</Text>
                    <TextInput
                      style={styles.input}
                      value={exceptionStartTime}
                      onChangeText={setExceptionStartTime}
                      maxLength={5}
                    />
                  </View>
                  <View style={styles.timeField}>
                    <Text style={styles.label}>{copy.endTime}</Text>
                    <TextInput
                      style={styles.input}
                      value={exceptionEndTime}
                      onChangeText={setExceptionEndTime}
                      maxLength={5}
                    />
                  </View>
                </View>
              ) : (
                <Text style={styles.hint}>{copy.unavailableDate}</Text>
              )}
              <Text style={styles.label}>{copy.exceptionReason}</Text>
              <TextInput
                style={styles.input}
                value={exceptionReason}
                onChangeText={setExceptionReason}
                placeholder={copy.exceptionReasonPlaceholder}
                maxLength={500}
              />
              <Pressable
                style={[styles.secondaryButton, savingHours && styles.disabled]}
                onPress={() => void saveException()}
                disabled={savingHours}
              >
                {savingHours ? (
                  <ActivityIndicator color="#16804A" />
                ) : (
                  <Text style={styles.secondaryButtonText}>{copy.addException}</Text>
                )}
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                onPress={() =>
                  router.push({ pathname: '/provider/portfolio', params: { language } })
                }
              >
                <Text style={styles.secondaryButtonText}>
                  {getTranslations(language).providerPortfolio.title}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F8F5' },
  header: {
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 17,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5ECE6',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  back: { color: '#16804A', fontSize: 15, fontWeight: '700' },
  languageOptions: { flexDirection: 'row', gap: 6 },
  languageOption: {
    borderWidth: 1,
    borderColor: '#DDE6DE',
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 9,
  },
  languageActive: { backgroundColor: '#EAF6EE', borderColor: '#16804A' },
  languageText: { color: '#16804A', fontSize: 11, fontWeight: '800' },
  brand: { color: '#16804A', fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  content: { padding: 18, paddingBottom: 45 },
  title: { color: '#15251A', fontSize: 26, fontWeight: '900', marginBottom: 13 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 15,
    padding: 15,
    marginBottom: 12,
  },
  label: { color: '#16804A', fontSize: 12, fontWeight: '800', marginTop: 13, marginBottom: 6 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 9,
    paddingHorizontal: 11,
    color: '#15251A',
  },
  multiline: { minHeight: 90, paddingTop: 11 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#EAF6EE' },
  avatarFallback: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#EAF6EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: '#16804A', fontSize: 23, fontWeight: '900' },
  photoName: { flex: 1, color: '#536358', fontSize: 12 },
  body: { color: '#536358', fontSize: 13, lineHeight: 20 },
  hint: { color: '#66736A', fontSize: 12, lineHeight: 18, marginTop: 6 },
  exceptionText: { flex: 1 },
  sectionTitle: { color: '#15251A', fontSize: 17, fontWeight: '900', marginTop: 22 },
  availableRow: { flexDirection: 'row', alignItems: 'center', marginTop: 15 },
  checkbox: {
    width: 21,
    height: 21,
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 5,
    color: '#FFFFFF',
    textAlign: 'center',
    textAlignVertical: 'center',
    marginRight: 9,
  },
  checkboxActive: { backgroundColor: '#16804A', overflow: 'hidden' },
  primaryButton: {
    backgroundColor: '#16804A',
    borderRadius: 10,
    minHeight: 47,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 17,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 9,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginTop: 10,
  },
  secondaryButtonText: { color: '#16804A', fontSize: 12, fontWeight: '800' },
  successText: { color: '#16804A', marginTop: 11, fontWeight: '700' },
  errorText: { color: '#A12A2A', marginTop: 10, lineHeight: 20 },
  muted: { color: '#66736A', fontSize: 13, marginTop: 7 },
  hourRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#EDF1ED',
    paddingVertical: 10,
  },
  removeText: { color: '#A12A2A', fontSize: 11, fontWeight: '800' },
  dayOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dayOption: {
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  daySelected: { backgroundColor: '#16804A', borderColor: '#16804A' },
  dayText: { color: '#536358', fontSize: 10, fontWeight: '700' },
  dayTextSelected: { color: '#FFFFFF' },
  timeRow: { flexDirection: 'row', gap: 10 },
  timeField: { flex: 1 },
  disabled: { opacity: 0.6 },
  center: { paddingVertical: 50, alignItems: 'center' },
});
