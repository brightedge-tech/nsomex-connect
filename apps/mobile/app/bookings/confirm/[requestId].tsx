import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { startConversationAndNavigate } from '../../../lib/messaging';
import { getTranslations, resolveLanguage, type Language } from '../../../lib/translations';

type Option = { id: string; name: string };
type Currency = Option & { code: string };
type RequestOffer = {
  id: string;
  service_id: string;
  requested_date: string | null;
  requested_time: string | null;
  time_zone: string | null;
  location: string | null;
  country_id: string;
  region_id: string;
  city_id: string;
  neighborhood_id: string | null;
  latitude: number | null;
  longitude: number | null;
};
type Provider = { professional_name: string; display_name: string | null };

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function BookingConfirmationScreen() {
  const params = useLocalSearchParams<{
    requestId?: string | string[];
    language?: string | string[];
  }>();
  const requestId = firstParam(params.requestId);
  const [language, setLanguage] = useState<Language>(resolveLanguage(firstParam(params.language)));
  const copy = getTranslations(language).bookingConfirmation;
  const [request, setRequest] = useState<RequestOffer | null>(null);
  const [serviceName, setServiceName] = useState('');
  const [providerName, setProviderName] = useState('');
  const [providerId, setProviderId] = useState<string | null>(null);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | null>(null);
  const [price, setPrice] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [existingBooking, setExistingBooking] = useState(false);
  const [existingBookingId, setExistingBookingId] = useState<string | null>(null);
  const [openingConversation, setOpeningConversation] = useState(false);
  const [messageError, setMessageError] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const loadOffer = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (!requestId) throw new Error(copy.loadError);
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userResult.user) throw new Error(copy.signInRequired);

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', userResult.user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) throw new Error(copy.loadError);

      const { data: requestRow, error: requestError } = await supabase
        .from('service_requests')
        .select(
          'id, service_id, requested_date, requested_time, time_zone, location, country_id, region_id, city_id, neighborhood_id, latitude, longitude',
        )
        .eq('id', requestId)
        .eq('customer_id', profile.id)
        .maybeSingle();
      if (requestError) throw requestError;
      if (!requestRow) throw new Error(copy.loadError);

      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .select('id, provider_id')
        .eq('request_id', requestId)
        .maybeSingle();
      if (bookingError) throw bookingError;
      if (booking) {
        setExistingBooking(true);
        setExistingBookingId(booking.id);
        setProviderId(booking.provider_id);
        setRequest(requestRow as RequestOffer);
        return;
      }

      const { data: response, error: responseError } = await supabase
        .from('service_request_responses')
        .select('provider_id')
        .eq('request_id', requestId)
        .eq('status', 'accepted')
        .maybeSingle();
      if (responseError) throw responseError;
      if (!response) throw new Error(copy.loadError);

      const [serviceResult, providerResult, currencyResult] = await Promise.all([
        supabase.from('services').select('name').eq('id', requestRow.service_id).single(),
        supabase
          .from('provider_directory')
          .select('professional_name, display_name')
          .eq('provider_id', response.provider_id)
          .single(),
        supabase
          .from('currencies')
          .select('id, name, code')
          .eq('is_active', true)
          .order('code')
          .limit(100),
      ]);
      if (serviceResult.error) throw serviceResult.error;
      if (providerResult.error) throw providerResult.error;
      if (currencyResult.error) throw currencyResult.error;

      setRequest(requestRow as RequestOffer);
      setServiceName(serviceResult.data.name);
      setProviderId(response.provider_id);
      setProviderName(
        (providerResult.data as Provider).professional_name ||
          (providerResult.data as Provider).display_name ||
          copy.provider,
      );
      setCurrencies((currencyResult.data ?? []) as Currency[]);
      setSelectedCurrency(null);
      setExistingBooking(false);
      setExistingBookingId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [copy.loadError, copy.provider, copy.signInRequired, requestId]);

  useFocusEffect(
    useCallback(() => {
      void loadOffer();
    }, [loadOffer]),
  );

  async function createBooking() {
    setError('');
    if (!request || !selectedCurrency || !price.trim()) {
      setError(copy.missingFields);
      return;
    }
    const cleanPrice = price.trim().replace(',', '.');
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(cleanPrice) || !Number.isFinite(Number(cleanPrice))) {
      setError(copy.invalidPrice);
      return;
    }

    setSubmitting(true);
    try {
      const { data: bookingId, error: bookingError } = await supabase.rpc(
        'customer_create_booking',
        {
          p_request_id: request.id,
          p_agreed_price: Number(cleanPrice),
          p_currency_id: selectedCurrency.id,
        },
      );
      if (bookingError) throw bookingError;
      if (typeof bookingId !== 'string' || !bookingId) {
        throw new Error(copy.error);
      }
      setExistingBookingId(bookingId);
      setSuccess(true);
    } catch {
      setError(copy.error);
    } finally {
      setSubmitting(false);
    }
  }

  function returnToRequests() {
    router.replace({ pathname: '/bookings', params: { language } } as Href);
  }

  async function messageProvider() {
    if (!request || !providerId || openingConversation) return;
    setOpeningConversation(true);
    setMessageError('');
    try {
      await startConversationAndNavigate(
        existingBookingId
          ? { bookingId: existingBookingId, language }
          : { requestId: request.id, providerId, language },
      );
    } catch {
      setMessageError(getTranslations(language).customerRequests.messageError);
    } finally {
      setOpeningConversation(false);
    }
  }

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
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
            <Text style={styles.muted}>{copy.loading}</Text>
          </View>
        ) : success ? (
          <View style={styles.card}>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.title}>{copy.success}</Text>
            {messageError ? <Text style={styles.errorText}>{messageError}</Text> : null}
            <Pressable
              style={[styles.secondaryButton, openingConversation && styles.disabled]}
              onPress={() => void messageProvider()}
              disabled={!providerId || openingConversation}
            >
              {openingConversation ? (
                <ActivityIndicator color="#16804A" />
              ) : (
                <Text style={styles.secondaryButtonText}>
                  {getTranslations(language).messaging.messageProvider}
                </Text>
              )}
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={returnToRequests}>
              <Text style={styles.primaryButtonText}>{getTranslations(language).back}</Text>
            </Pressable>
          </View>
        ) : existingBooking ? (
          <View style={styles.card}>
            <Text style={styles.title}>{copy.success}</Text>
            {messageError ? <Text style={styles.errorText}>{messageError}</Text> : null}
            <Pressable
              style={[styles.secondaryButton, openingConversation && styles.disabled]}
              onPress={() => void messageProvider()}
              disabled={!providerId || openingConversation}
            >
              {openingConversation ? (
                <ActivityIndicator color="#16804A" />
              ) : (
                <Text style={styles.secondaryButtonText}>
                  {getTranslations(language).messaging.messageProvider}
                </Text>
              )}
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={returnToRequests}>
              <Text style={styles.primaryButtonText}>{copy.confirm}</Text>
            </Pressable>
          </View>
        ) : error && !request ? (
          <View style={styles.card}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.secondaryButton} onPress={() => void loadOffer()}>
              <Text style={styles.secondaryButtonText}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : request ? (
          <>
            <Text style={styles.title}>{copy.title}</Text>
            <Text style={styles.subtitle}>{copy.subtitle}</Text>
            <View style={styles.card}>
              <Text style={styles.label}>{copy.provider}</Text>
              <Text style={styles.value}>{providerName}</Text>
              <Text style={styles.label}>{copy.service}</Text>
              <Text style={styles.value}>{serviceName}</Text>
              <Text style={styles.label}>{copy.location}</Text>
              <Text style={styles.value}>{request.location || '—'}</Text>

              <Text style={styles.hint}>{copy.negotiationHint}</Text>
              <Pressable
                style={[styles.secondaryButton, openingConversation && styles.disabled]}
                onPress={() => void messageProvider()}
                disabled={!providerId || openingConversation}
              >
                {openingConversation ? (
                  <ActivityIndicator color="#16804A" />
                ) : (
                  <Text style={styles.secondaryButtonText}>
                    {getTranslations(language).messaging.messageProvider}
                  </Text>
                )}
              </Pressable>
              {messageError ? <Text style={styles.errorText}>{messageError}</Text> : null}
              <Text style={styles.label}>{copy.agreedPrice}</Text>
              <TextInput
                style={styles.input}
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
                placeholder={copy.pricePlaceholder}
                placeholderTextColor="#89958B"
                maxLength={13}
              />
              <Text style={styles.label}>{copy.currency}</Text>
              {currencies.length ? (
                <View style={styles.currencyList}>
                  {currencies.map((currency) => (
                    <Pressable
                      key={currency.id}
                      style={[
                        styles.currencyOption,
                        selectedCurrency?.id === currency.id && styles.currencySelected,
                      ]}
                      onPress={() => setSelectedCurrency(currency)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedCurrency?.id === currency.id }}
                    >
                      <Text
                        style={[
                          styles.currencyText,
                          selectedCurrency?.id === currency.id && styles.currencyTextSelected,
                        ]}
                      >
                        {currency.code}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={styles.errorText}>{copy.currencyUnavailable}</Text>
              )}
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <Pressable
                style={[styles.primaryButton, submitting && styles.disabled]}
                onPress={() => void createBooking()}
                disabled={submitting || currencies.length === 0}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>{copy.confirm}</Text>
                )}
              </Pressable>
            </View>
          </>
        ) : null}
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
  content: { padding: 20, paddingBottom: 45 },
  title: { color: '#15251A', fontSize: 25, fontWeight: '900' },
  subtitle: { color: '#66736A', lineHeight: 21, marginTop: 7, marginBottom: 17 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 16,
    padding: 17,
  },
  label: { color: '#16804A', fontSize: 12, fontWeight: '900', marginTop: 16, marginBottom: 6 },
  value: { color: '#15251A', fontSize: 15, fontWeight: '700' },
  hint: { color: '#66736A', lineHeight: 20, marginTop: 16 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#15251A',
  },
  currencyList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  currencyOption: {
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 13,
  },
  currencySelected: { backgroundColor: '#16804A', borderColor: '#16804A' },
  currencyText: { color: '#536358', fontWeight: '700' },
  currencyTextSelected: { color: '#FFFFFF' },
  primaryButton: {
    backgroundColor: '#16804A',
    minHeight: 48,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 18,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  secondaryButton: {
    minHeight: 45,
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 13,
  },
  secondaryButtonText: { color: '#16804A', fontWeight: '800' },
  errorText: { color: '#A12A2A', marginTop: 10, lineHeight: 20 },
  successIcon: { color: '#16804A', fontSize: 32, fontWeight: '900', marginBottom: 11 },
  disabled: { opacity: 0.6 },
  center: { paddingVertical: 55, alignItems: 'center' },
  muted: { color: '#66736A', marginTop: 9 },
});
