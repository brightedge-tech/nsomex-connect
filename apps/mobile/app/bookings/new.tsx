import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Stack, router, useLocalSearchParams, type Href } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { startConversationAndNavigate } from '../../lib/messaging';
import { appendQueryParams } from '../../lib/auth';
import { getTranslations, resolveLanguage, type Language } from '../../lib/translations';

type SelectionOption = { id: string; name: string };
type PickerName = 'service' | 'country' | 'region' | 'city';

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function createRequestId() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    bytes.forEach((_, index) => {
      bytes[index] = Math.floor(Math.random() * 256);
    });
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function SelectionField({
  label,
  value,
  placeholder,
  options,
  expanded,
  emptyMessage,
  disabled,
  onToggle,
  onSelect,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: SelectionOption[];
  expanded: boolean;
  emptyMessage: string;
  disabled?: boolean;
  onToggle: () => void;
  onSelect: (option: SelectionOption) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={[styles.input, styles.selector, disabled && styles.disabled]}
        onPress={onToggle}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled: !!disabled }}
      >
        <Text style={value ? styles.inputText : styles.placeholderText}>
          {value || placeholder}
        </Text>
        <Text style={styles.selectorChevron}>{expanded ? '⌃' : '⌄'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.options}>
          {options.length ? (
            options.map((option) => (
              <Pressable
                key={option.id}
                style={styles.option}
                onPress={() => onSelect(option)}
                accessibilityRole="button"
              >
                <Text style={styles.optionText}>{option.name}</Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.emptyOption}>{emptyMessage}</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

export default function NewRequestScreen() {
  const params = useLocalSearchParams<{
    serviceId?: string | string[];
    providerId?: string | string[];
    providerName?: string | string[];
    language?: string | string[];
  }>();
  const serviceIdParam = firstParam(params.serviceId);
  const providerId = firstParam(params.providerId);
  const providerName = firstParam(params.providerName);
  const [language, setLanguage] = useState<Language>(resolveLanguage(firstParam(params.language)));
  const copy = getTranslations(language).customerRequests;
  const [services, setServices] = useState<SelectionOption[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState(serviceIdParam ?? '');
  const [countries, setCountries] = useState<SelectionOption[]>([]);
  const [regions, setRegions] = useState<SelectionOption[]>([]);
  const [cities, setCities] = useState<SelectionOption[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<SelectionOption | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<SelectionOption | null>(null);
  const [selectedCity, setSelectedCity] = useState<SelectionOption | null>(null);
  const [expandedPicker, setExpandedPicker] = useState<PickerName | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingLocationLevel, setLoadingLocationLevel] = useState<'regions' | 'cities' | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedRequestId, setSubmittedRequestId] = useState<string | null>(null);
  const [openingConversation, setOpeningConversation] = useState(false);
  const [messageError, setMessageError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [locationError, setLocationError] = useState('');
  const regionLoadId = useRef(0);
  const cityLoadId = useRef(0);
  const submissionId = useRef<string | null>(null);
  const submissionInFlight = useRef(false);

  async function loadForm() {
    const [serviceResult, countryResult, userResult] = await Promise.all([
      supabase.from('services').select('id, name').eq('is_active', true).order('name').limit(500),
      supabase.from('countries').select('id, name').eq('is_active', true).order('name').limit(500),
      supabase.auth.getUser(),
    ]);

    if (serviceResult.error) throw serviceResult.error;
    if (countryResult.error) throw countryResult.error;
    if (userResult.error) throw userResult.error;

    let profile: {
      id: string;
      first_name: string | null;
      last_name: string | null;
      display_name: string | null;
      phone: string | null;
    } | null = null;

    if (userResult.data.user) {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, display_name, phone')
        .eq('user_id', userResult.data.user.id)
        .maybeSingle();
      if (error) throw error;
      profile = data;
    }

    return {
      services: (serviceResult.data ?? []) as SelectionOption[],
      countries: (countryResult.data ?? []) as SelectionOption[],
      userId: userResult.data.user?.id ?? null,
      profile,
    };
  }

  const applyFormData = useCallback(
    (data: Awaited<ReturnType<typeof loadForm>>) => {
      setServices(data.services);
      setCountries(data.countries);
      const initialService = serviceIdParam
        ? data.services.find((service) => service.id === serviceIdParam)
        : undefined;
      setSelectedServiceId(initialService?.id ?? '');
      setUserId(data.userId);
      setProfileId(data.profile?.id ?? null);
      setContactName(
        data.profile?.display_name ||
          [data.profile?.first_name, data.profile?.last_name].filter(Boolean).join(' '),
      );
      setContactPhone(data.profile?.phone ?? '');
    },
    [serviceIdParam],
  );

  const applyLoadError = useCallback((error: unknown) => {
    setLoadError(error instanceof Error ? error.message : 'Unable to load request form.');
  }, []);

  useEffect(() => {
    let active = true;
    void loadForm()
      .then((data) => {
        if (active) applyFormData(data);
      })
      .catch((error: unknown) => {
        if (active) applyLoadError(error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [applyFormData, applyLoadError, serviceIdParam]);

  function retryLoadForm() {
    setLoading(true);
    setLoadError('');
    void loadForm()
      .then(applyFormData)
      .catch(applyLoadError)
      .finally(() => setLoading(false));
  }

  async function selectCountry(option: SelectionOption) {
    const requestId = ++regionLoadId.current;
    cityLoadId.current += 1;
    setSelectedCountry(option);
    setSelectedRegion(null);
    setSelectedCity(null);
    setRegions([]);
    setCities([]);
    setLocationError('');
    setExpandedPicker(null);
    setLoadingLocationLevel('regions');

    try {
      const { data, error } = await supabase
        .from('regions')
        .select('id, name')
        .eq('country_id', option.id)
        .eq('is_active', true)
        .order('name')
        .limit(500);
      if (error) throw error;
      if (requestId === regionLoadId.current) {
        setRegions((data ?? []) as SelectionOption[]);
      }
    } catch (error) {
      if (requestId === regionLoadId.current) {
        setLocationError(error instanceof Error ? error.message : copy.requestError);
      }
    } finally {
      if (requestId === regionLoadId.current) setLoadingLocationLevel(null);
    }
  }

  async function selectRegion(option: SelectionOption) {
    if (!selectedCountry || !regions.some((region) => region.id === option.id)) return;
    const requestId = ++cityLoadId.current;
    setSelectedRegion(option);
    setSelectedCity(null);
    setCities([]);
    setLocationError('');
    setExpandedPicker(null);
    setLoadingLocationLevel('cities');

    try {
      const { data, error } = await supabase
        .from('cities')
        .select('id, name')
        .eq('country_id', selectedCountry.id)
        .eq('region_id', option.id)
        .eq('is_active', true)
        .order('name')
        .limit(500);
      if (error) throw error;
      if (requestId === cityLoadId.current) {
        setCities((data ?? []) as SelectionOption[]);
      }
    } catch (error) {
      if (requestId === cityLoadId.current) {
        setLocationError(error instanceof Error ? error.message : copy.requestError);
      }
    } finally {
      if (requestId === cityLoadId.current) setLoadingLocationLevel(null);
    }
  }

  function openSignIn() {
    router.push({
      pathname: '/account',
      params: {
        role: 'customer',
        mode: 'login',
        language,
        returnTo: appendQueryParams('/bookings/new', {
          serviceId: serviceIdParam,
          providerId,
          providerName,
          language,
        }),
      },
    } as Href);
  }

  async function submitRequest() {
    if (submissionInFlight.current) return;
    setSubmitError('');
    setMessageError('');

    if (!userId) {
      openSignIn();
      return;
    }
    if (!profileId) {
      setSubmitError(copy.missingProfile);
      return;
    }
    if (
      !selectedServiceId ||
      !description.trim() ||
      !contactName.trim() ||
      !contactPhone.trim() ||
      !location.trim() ||
      !selectedCountry ||
      !selectedRegion ||
      !selectedCity
    ) {
      setSubmitError(copy.missingFields);
      return;
    }

    const phone = contactPhone.trim();
    if (!/^\+[1-9]\d{1,14}$/.test(phone)) {
      setSubmitError(copy.invalidPhone);
      return;
    }
    if (date && !isValidDate(date.trim())) {
      setSubmitError(copy.invalidDate);
      return;
    }
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time.trim())) {
      setSubmitError(copy.invalidTime);
      return;
    }
    if (time && !date.trim()) {
      setSubmitError(copy.timeNeedsDate);
      return;
    }

    submissionInFlight.current = true;
    setSubmitting(true);

    try {
      const [serviceResult, countryResult, regionResult, cityResult] = await Promise.all([
        supabase
          .from('services')
          .select('id')
          .eq('id', selectedServiceId)
          .eq('is_active', true)
          .maybeSingle(),
        supabase
          .from('countries')
          .select('id')
          .eq('id', selectedCountry.id)
          .eq('is_active', true)
          .maybeSingle(),
        supabase
          .from('regions')
          .select('id')
          .eq('id', selectedRegion.id)
          .eq('country_id', selectedCountry.id)
          .eq('is_active', true)
          .maybeSingle(),
        supabase
          .from('cities')
          .select('id')
          .eq('id', selectedCity.id)
          .eq('country_id', selectedCountry.id)
          .eq('region_id', selectedRegion.id)
          .eq('is_active', true)
          .maybeSingle(),
      ]);
      if (serviceResult.error) throw serviceResult.error;
      if (countryResult.error) throw countryResult.error;
      if (regionResult.error) throw regionResult.error;
      if (cityResult.error) throw cityResult.error;
      if (!serviceResult.data) {
        setSubmitError(copy.serviceUnavailable);
        return;
      }
      if (!countryResult.data || !regionResult.data || !cityResult.data) {
        setSubmitError(copy.invalidLocationSelection);
        return;
      }

      if (providerId) {
        const { data: providerListing, error: providerListingError } = await supabase
          .from('provider_services')
          .select('id')
          .eq('provider_id', providerId)
          .eq('service_id', selectedServiceId)
          .eq('is_active', true)
          .maybeSingle();
        if (providerListingError) throw providerListingError;
        if (!providerListing) {
          setSubmitError(copy.providerUnavailable);
          return;
        }
      }

      const requestId = (submissionId.current ??= createRequestId());
      const requestPayload = {
        id: requestId,
        customer_id: profileId,
        service_id: selectedServiceId,
        description: description.trim(),
        requested_date: date.trim() || null,
        requested_time: time.trim() || null,
        time_zone: date.trim() ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' : null,
        location: location.trim(),
        country_id: selectedCountry.id,
        region_id: selectedRegion.id,
        city_id: selectedCity.id,
        contact_name: contactName.trim(),
        contact_phone: phone,
        status: 'pending',
      };
      const { data: request, error } = await supabase
        .from('service_requests')
        .insert(requestPayload)
        .select('id')
        .single();

      if (error?.code === '23505') {
        const { data: existingRequest, error: existingRequestError } = await supabase
          .from('service_requests')
          .select(
            'id, customer_id, service_id, description, requested_date, requested_time, time_zone, location, country_id, region_id, city_id, contact_name, contact_phone',
          )
          .eq('id', requestId)
          .eq('customer_id', profileId)
          .maybeSingle();
        if (existingRequestError) throw existingRequestError;
        const isSameRequest =
          existingRequest &&
          existingRequest.service_id === requestPayload.service_id &&
          existingRequest.description === requestPayload.description &&
          existingRequest.requested_date === requestPayload.requested_date &&
          existingRequest.requested_time === requestPayload.requested_time &&
          existingRequest.time_zone === requestPayload.time_zone &&
          existingRequest.location === requestPayload.location &&
          existingRequest.country_id === requestPayload.country_id &&
          existingRequest.region_id === requestPayload.region_id &&
          existingRequest.city_id === requestPayload.city_id &&
          existingRequest.contact_name === requestPayload.contact_name &&
          existingRequest.contact_phone === requestPayload.contact_phone;
        if (!isSameRequest) throw error;
        setSubmittedRequestId(existingRequest.id);
        setSubmitted(true);
        return;
      }
      if (error) throw error;
      setSubmittedRequestId(request.id);
      setSubmitted(true);
    } catch {
      setSubmitError(copy.requestError);
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  }

  function editRequest() {
    submissionId.current = null;
    setSubmitError('');
    setReviewing(false);
  }

  async function messageSelectedProvider() {
    if (!providerId || !submittedRequestId || openingConversation) return;
    setOpeningConversation(true);
    setMessageError('');
    try {
      await startConversationAndNavigate({
        requestId: submittedRequestId,
        providerId,
        language,
      });
    } catch (error) {
      console.error('Unable to open the provider conversation', error);
      setMessageError(copy.messageError);
    } finally {
      setOpeningConversation(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <Pressable onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.back}>‹ {getTranslations(language).back}</Text>
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
                  style={[styles.languageText, language === option && styles.languageTextActive]}
                >
                  {option.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={styles.brand}>NSOMEX CONNECT</Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
            <Text style={styles.muted}>{copy.loadingLocations}</Text>
          </View>
        ) : loadError ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>{copy.loadErrorTitle}</Text>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable style={styles.secondaryButton} onPress={retryLoadForm}>
              <Text style={styles.secondaryButtonText}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : submitted ? (
          <View style={styles.successCard}>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.title}>{copy.successTitle}</Text>
            <Text style={styles.subtitle}>{copy.successMessage}</Text>
            {providerName ? (
              <Text style={styles.providerContext}>
                {copy.requestingFrom.replace('{provider}', providerName)}
              </Text>
            ) : null}
            {messageError ? <Text style={styles.errorText}>{messageError}</Text> : null}
            {providerId ? (
              <Pressable
                style={[styles.secondaryButton, openingConversation && styles.disabled]}
                onPress={() => void messageSelectedProvider()}
                disabled={!submittedRequestId || openingConversation}
              >
                {openingConversation ? (
                  <ActivityIndicator color="#16804A" />
                ) : (
                  <Text style={styles.secondaryButtonText}>{copy.messageProvider}</Text>
                )}
              </Pressable>
            ) : null}
            <Pressable
              style={styles.button}
              onPress={() =>
                router.replace({
                  pathname: '/bookings',
                  params: { language },
                } as Href)
              }
            >
              <Text style={styles.buttonText}>{copy.viewRequests}</Text>
            </Pressable>
          </View>
        ) : !userId ? (
          <View style={styles.notice}>
            <Text style={styles.title}>{copy.title}</Text>
            <Text style={styles.subtitle}>{copy.signInRequired}</Text>
            <Pressable style={styles.button} onPress={openSignIn}>
              <Text style={styles.buttonText}>{copy.signIn}</Text>
            </Pressable>
          </View>
        ) : reviewing ? (
          <>
            <Text style={styles.title}>{copy.reviewTitle}</Text>
            <Text style={styles.subtitle}>{copy.reviewSubtitle}</Text>
            <View style={styles.reviewCard}>
              {providerName ? (
                <>
                  <Text style={styles.reviewLabel}>{copy.provider}</Text>
                  <Text style={styles.reviewValue}>{providerName}</Text>
                </>
              ) : null}
              <Text style={styles.reviewLabel}>{copy.service}</Text>
              <Text style={styles.reviewValue}>
                {services.find((service) => service.id === selectedServiceId)?.name}
              </Text>
              <Text style={styles.reviewLabel}>{copy.contactName}</Text>
              <Text style={styles.reviewValue}>{contactName.trim()}</Text>
              <Text style={styles.reviewLabel}>{copy.contactPhone}</Text>
              <Text style={styles.reviewValue}>{contactPhone.trim()}</Text>
              <Text style={styles.reviewLabel}>{copy.address}</Text>
              <Text style={styles.reviewValue}>
                {[selectedCountry?.name, selectedRegion?.name, selectedCity?.name, location.trim()]
                  .filter(Boolean)
                  .join(', ')}
              </Text>
              {date.trim() ? (
                <>
                  <Text style={styles.reviewLabel}>{copy.preferredDate}</Text>
                  <Text style={styles.reviewValue}>{date.trim()}</Text>
                </>
              ) : null}
              {time.trim() ? (
                <>
                  <Text style={styles.reviewLabel}>{copy.preferredTime}</Text>
                  <Text style={styles.reviewValue}>{time.trim()}</Text>
                </>
              ) : null}
              <Text style={styles.reviewLabel}>{copy.description}</Text>
              <Text style={styles.reviewValue}>{description.trim()}</Text>
            </View>
            {submitError ? <Text style={styles.errorBanner}>{submitError}</Text> : null}
            <Pressable
              style={[styles.secondaryButton, submitting && styles.disabled]}
              onPress={editRequest}
              disabled={submitting}
            >
              <Text style={styles.secondaryButtonText}>{copy.editRequest}</Text>
            </Pressable>
            <Pressable
              style={[styles.button, submitting && styles.disabled]}
              onPress={() => void submitRequest()}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>{copy.confirmRequest}</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.title}>{copy.title}</Text>
            <Text style={styles.subtitle}>{copy.subtitle}</Text>

            {services.length === 0 ? (
              <View style={styles.notice}>
                <Text style={styles.errorText}>{copy.noServices}</Text>
              </View>
            ) : null}

            <SelectionField
              label={copy.service}
              value={services.find((service) => service.id === selectedServiceId)?.name ?? ''}
              placeholder={copy.chooseService}
              options={services}
              expanded={expandedPicker === 'service'}
              emptyMessage={copy.noServices}
              onToggle={() => setExpandedPicker(expandedPicker === 'service' ? null : 'service')}
              onSelect={(option) => {
                setSelectedServiceId(option.id);
                setExpandedPicker(null);
              }}
            />

            <Text style={styles.sectionTitle}>{copy.contactName}</Text>
            <TextInput
              style={styles.input}
              placeholder={copy.contactNamePlaceholder}
              placeholderTextColor="#89958B"
              value={contactName}
              onChangeText={setContactName}
              autoCapitalize="words"
              autoComplete="name"
              maxLength={200}
            />
            <Text style={styles.label}>{copy.contactPhone}</Text>
            <TextInput
              style={styles.input}
              placeholder={copy.contactPhonePlaceholder}
              placeholderTextColor="#89958B"
              value={contactPhone}
              onChangeText={setContactPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              maxLength={16}
            />
            <Text style={styles.hint}>{copy.phoneHint}</Text>

            <Text style={styles.sectionTitle}>{copy.address}</Text>
            <SelectionField
              label={copy.country}
              value={selectedCountry?.name ?? ''}
              placeholder={copy.selectCountry}
              options={countries}
              expanded={expandedPicker === 'country'}
              emptyMessage={copy.noCountries}
              onToggle={() => setExpandedPicker(expandedPicker === 'country' ? null : 'country')}
              onSelect={(option) => void selectCountry(option)}
            />
            <SelectionField
              label={copy.region}
              value={selectedRegion?.name ?? ''}
              placeholder={copy.selectRegion}
              options={regions}
              expanded={expandedPicker === 'region'}
              emptyMessage={copy.noRegions}
              disabled={!selectedCountry || loadingLocationLevel !== null}
              onToggle={() => setExpandedPicker(expandedPicker === 'region' ? null : 'region')}
              onSelect={(option) => void selectRegion(option)}
            />
            <SelectionField
              label={copy.city}
              value={selectedCity?.name ?? ''}
              placeholder={copy.selectCity}
              options={cities}
              expanded={expandedPicker === 'city'}
              emptyMessage={copy.noCities}
              disabled={!selectedRegion || loadingLocationLevel !== null}
              onToggle={() => setExpandedPicker(expandedPicker === 'city' ? null : 'city')}
              onSelect={(option) => {
                setSelectedCity(option);
                setExpandedPicker(null);
              }}
            />
            {loadingLocationLevel ? (
              <View style={styles.inlineLoading}>
                <ActivityIndicator size="small" color="#16804A" />
                <Text style={styles.muted}>
                  {loadingLocationLevel === 'regions' ? copy.loadingRegions : copy.loadingCities}
                </Text>
              </View>
            ) : null}
            {selectedCountry && !loadingLocationLevel && !locationError && regions.length === 0 ? (
              <Text style={styles.locationFallback}>{copy.noRegionsFallback}</Text>
            ) : null}
            {selectedRegion && !loadingLocationLevel && !locationError && cities.length === 0 ? (
              <Text style={styles.locationFallback}>{copy.noCitiesFallback}</Text>
            ) : null}
            {locationError ? <Text style={styles.errorText}>{locationError}</Text> : null}
            <TextInput
              style={styles.input}
              placeholder={copy.addressPlaceholder}
              placeholderTextColor="#89958B"
              value={location}
              onChangeText={setLocation}
              maxLength={2000}
            />

            <Text style={styles.sectionTitle}>{copy.preferredDate}</Text>
            <TextInput
              style={styles.input}
              placeholder={copy.datePlaceholder}
              placeholderTextColor="#89958B"
              value={date}
              onChangeText={setDate}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
            <Text style={styles.hint}>{copy.dateHint}</Text>
            <Text style={styles.label}>{copy.preferredTime}</Text>
            <TextInput
              style={styles.input}
              placeholder={copy.timePlaceholder}
              placeholderTextColor="#89958B"
              value={time}
              onChangeText={setTime}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
            />

            <Text style={styles.sectionTitle}>{copy.description}</Text>
            <TextInput
              style={[styles.input, styles.description]}
              placeholder={copy.descriptionPlaceholder}
              placeholderTextColor="#89958B"
              value={description}
              onChangeText={setDescription}
              multiline
              textAlignVertical="top"
              maxLength={10000}
            />

            {submitError ? <Text style={styles.errorBanner}>{submitError}</Text> : null}
            <Pressable
              style={[styles.button, (submitting || services.length === 0) && styles.disabled]}
              onPress={() => {
                setSubmitError('');
                setReviewing(true);
              }}
              disabled={submitting || services.length === 0}
            >
              <Text style={styles.buttonText}>{copy.reviewRequest}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F8F5' },
  content: { padding: 22, paddingTop: 55, paddingBottom: 45 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 25,
  },
  back: { color: '#16804A', fontSize: 17, fontWeight: '700' },
  languageOptions: { flexDirection: 'row', gap: 6 },
  languageOption: {
    borderWidth: 1,
    borderColor: '#DDE6DE',
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 9,
    backgroundColor: '#FFFFFF',
  },
  languageOptionActive: { backgroundColor: '#EAF6EE', borderColor: '#16804A' },
  languageText: { color: '#66736A', fontSize: 11, fontWeight: '700' },
  languageTextActive: { color: '#16804A' },
  brand: { color: '#16804A', fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  title: { fontSize: 30, fontWeight: '800', color: '#15251A', marginTop: 12 },
  subtitle: { fontSize: 15, lineHeight: 23, color: '#66736A', marginTop: 8, marginBottom: 20 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#26382B',
    marginBottom: 8,
    marginTop: 22,
  },
  label: { fontSize: 14, fontWeight: '700', color: '#26382B', marginBottom: 8, marginTop: 16 },
  field: { marginTop: 16 },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 12,
    padding: 15,
    fontSize: 15,
    color: '#15251A',
  },
  selector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputText: { color: '#15251A', fontSize: 15, flex: 1 },
  placeholderText: { color: '#89958B', fontSize: 15, flex: 1 },
  selectorChevron: { color: '#16804A', fontSize: 18, fontWeight: '800', marginLeft: 10 },
  options: {
    marginTop: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 12,
    overflow: 'hidden',
  },
  option: { padding: 14, borderBottomWidth: 1, borderBottomColor: '#EDF2EE' },
  optionText: { color: '#26382B', fontSize: 15 },
  emptyOption: { color: '#66736A', padding: 14, fontSize: 14 },
  disabled: { opacity: 0.55 },
  hint: { marginTop: 6, color: '#66736A', fontSize: 12, lineHeight: 18 },
  muted: { color: '#66736A', fontSize: 14, marginLeft: 8 },
  center: { paddingVertical: 65, alignItems: 'center' },
  inlineLoading: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  locationFallback: {
    color: '#8A5A14',
    backgroundColor: '#FFF7E8',
    padding: 11,
    marginTop: 8,
    borderRadius: 9,
    fontSize: 13,
    lineHeight: 19,
  },
  notice: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5ECE6',
    borderRadius: 15,
    padding: 18,
    marginTop: 22,
  },
  noticeTitle: { color: '#15251A', fontSize: 18, fontWeight: '800', marginBottom: 8 },
  errorText: { color: '#A12A2A', marginTop: 8, lineHeight: 20 },
  errorBanner: {
    color: '#8E2525',
    backgroundColor: '#FCECEC',
    borderRadius: 10,
    padding: 12,
    marginTop: 18,
    lineHeight: 20,
  },
  successCard: {
    backgroundColor: '#FFFFFF',
    padding: 22,
    borderRadius: 18,
    marginTop: 24,
    alignItems: 'center',
  },
  providerContext: { color: '#536358', fontSize: 13, fontWeight: '700', marginTop: 10 },
  successIcon: {
    color: '#16804A',
    fontSize: 32,
    fontWeight: '900',
    backgroundColor: '#E7F5EB',
    overflow: 'hidden',
    borderRadius: 30,
    paddingHorizontal: 15,
    paddingVertical: 7,
  },
  description: { minHeight: 120 },
  reviewCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 16,
    padding: 17,
    marginTop: 16,
  },
  reviewLabel: { color: '#16804A', fontSize: 12, fontWeight: '800', marginTop: 14 },
  reviewValue: { color: '#26382B', fontSize: 15, lineHeight: 21, marginTop: 4 },
  button: {
    backgroundColor: '#16804A',
    padding: 17,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 53,
    marginTop: 24,
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  secondaryButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  secondaryButtonText: { color: '#16804A', fontWeight: '800' },
});
