import { useCallback, useEffect, useRef, useState } from 'react';
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
import { router, Stack, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { getTranslations, resolveLanguage, type Language } from '../../lib/translations';

type Option = { id: string; name: string };
type Profession = Option & { category_id: string };
type Service = Option & { profession_id: string };
type ProviderOffer = {
  id: string;
  service_id: string;
  title: string;
  image_path: string | null;
};
type Provider = {
  provider_id: string;
  professional_name: string;
  description: string | null;
  years_experience: number;
  avatar_url: string | null;
  availability_status: 'available' | 'unavailable' | 'busy';
  profession_names: string[];
  service_area_labels: string[];
  created_at: string;
};
type ProviderListingRow = {
  id: string;
  provider_id: string;
  service_id: string;
  title: string | null;
  image_path: string | null;
  services: { name: string } | null;
};
type Cursor = { createdAt: string; id: string };
type Picker = 'category' | 'profession' | 'service' | 'country' | 'region' | 'city';
const pageSize = 20;

function ChoiceField({
  label,
  value,
  placeholder,
  options,
  expanded,
  onToggle,
  onSelect,
  disabled,
  allLabel,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: Option[];
  expanded: boolean;
  onToggle: () => void;
  onSelect: (option: Option | null) => void;
  disabled?: boolean;
  allLabel: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={[styles.selector, disabled && styles.disabled]}
        onPress={onToggle}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled: !!disabled }}
      >
        <Text style={value ? styles.selectorText : styles.placeholder}>{value || placeholder}</Text>
        <Text style={styles.chevron}>{expanded ? '⌃' : '⌄'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.options}>
          <Pressable style={styles.option} onPress={() => onSelect(null)}>
            <Text style={styles.optionText}>{allLabel}</Text>
          </Pressable>
          {options.map((option) => (
            <Pressable key={option.id} style={styles.option} onPress={() => onSelect(option)}>
              <Text style={styles.optionText}>{option.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function ProviderDiscoveryScreen() {
  const params = useLocalSearchParams<{
    language?: string | string[];
    categoryId?: string | string[];
    professionId?: string | string[];
    serviceId?: string | string[];
    search?: string | string[];
  }>();
  const initialCategory = Array.isArray(params.categoryId)
    ? params.categoryId[0]
    : params.categoryId;
  const initialProfession = Array.isArray(params.professionId)
    ? params.professionId[0]
    : params.professionId;
  const initialService = Array.isArray(params.serviceId) ? params.serviceId[0] : params.serviceId;
  const initialSearch = Array.isArray(params.search) ? params.search[0] : params.search;
  const languageParam = Array.isArray(params.language) ? params.language[0] : params.language;
  const [language, setLanguage] = useState<Language>(resolveLanguage(languageParam));
  const copy = getTranslations(language).providerDiscovery;
  const [categories, setCategories] = useState<Option[]>([]);
  const [professions, setProfessions] = useState<Profession[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [categoryId, setCategoryId] = useState(initialCategory ?? '');
  const [countries, setCountries] = useState<Option[]>([]);
  const [regions, setRegions] = useState<Option[]>([]);
  const [cities, setCities] = useState<Option[]>([]);
  const [professionId, setProfessionId] = useState(initialProfession ?? '');
  const [serviceId, setServiceId] = useState(initialService ?? '');
  const [country, setCountry] = useState<Option | null>(null);
  const [region, setRegion] = useState<Option | null>(null);
  const [city, setCity] = useState<Option | null>(null);
  const [search, setSearch] = useState(initialSearch ?? '');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [expandedPicker, setExpandedPicker] = useState<Picker | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loadingRegions, setLoadingRegions] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerOffers, setProviderOffers] = useState<Record<string, ProviderOffer[]>>({});
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [filtersReady, setFiltersReady] = useState(false);
  const regionRequestId = useRef(0);
  const cityRequestId = useRef(0);

  const filteredProfessions = professions.filter(
    (profession) => !categoryId || profession.category_id === categoryId,
  );
  const filteredServices = services.filter((service) => {
    const profession = professions.find((item) => item.id === service.profession_id);
    return (
      (!categoryId || profession?.category_id === categoryId) &&
      (!professionId || service.profession_id === professionId)
    );
  });

  const loadOptions = useCallback(async () => {
    try {
      const [categoryResult, professionResult, serviceResult, countryResult] = await Promise.all([
        supabase
          .from('service_categories')
          .select('id, name')
          .eq('is_active', true)
          .order('name')
          .limit(500),
        supabase
          .from('professions')
          .select('id, name, category_id')
          .eq('is_active', true)
          .order('name')
          .limit(1000),
        supabase
          .from('services')
          .select('id, name, profession_id')
          .eq('is_active', true)
          .order('name')
          .limit(2000),
        supabase
          .from('countries')
          .select('id, name')
          .eq('is_active', true)
          .order('name')
          .limit(500),
      ]);
      if (categoryResult.error) throw categoryResult.error;
      if (professionResult.error) throw professionResult.error;
      if (serviceResult.error) throw serviceResult.error;
      if (countryResult.error) throw countryResult.error;
      const activeCategories = (categoryResult.data ?? []) as Option[];
      const activeCategoryIds = new Set(activeCategories.map((category) => category.id));
      const activeProfessions = ((professionResult.data ?? []) as Profession[]).filter(
        (profession) => activeCategoryIds.has(profession.category_id),
      );
      const activeProfessionIds = new Set(activeProfessions.map((profession) => profession.id));
      setCategories(activeCategories);
      setProfessions(activeProfessions);
      setServices(
        ((serviceResult.data ?? []) as Service[]).filter((service) =>
          activeProfessionIds.has(service.profession_id),
        ),
      );
      setCountries((countryResult.data ?? []) as Option[]);
      setFiltersReady(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.loadError);
    } finally {
      setLoadingOptions(false);
    }
  }, [copy.loadError]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadOptions();
    });
    return () => {
      active = false;
    };
  }, [loadOptions]);

  const fetchProviders = useCallback(
    async (before: Cursor | null, append: boolean) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError('');
      }

      try {
        const { data, error: rpcError } = await supabase.rpc('search_public_providers', {
          p_search: search.trim() || null,
          p_profession_id: professionId || null,
          p_country_id: country?.id ?? null,
          p_region_id: region?.id ?? null,
          p_city_id: city?.id ?? null,
          p_service_id: serviceId || null,
          p_available_only: availableOnly,
          p_before_created_at: before?.createdAt ?? null,
          p_before_id: before?.id ?? null,
          p_page_size: pageSize + 1,
        });
        if (rpcError) throw rpcError;

        const page = (data ?? []) as Provider[];
        const moreAvailable = page.length > pageSize;
        const pageProviders = page.slice(0, pageSize);
        const providerIds = pageProviders.map((provider) => provider.provider_id);
        let offerQuery = supabase
          .from('provider_services')
          .select('id, provider_id, service_id, title, image_path, services(name)')
          .eq('is_active', true)
          .in('provider_id', providerIds);
        if (serviceId) offerQuery = offerQuery.eq('service_id', serviceId);
        const offerResult = providerIds.length
          ? await offerQuery.order('created_at', { ascending: false }).limit(1000)
          : { data: [], error: null };
        if (offerResult.error) throw offerResult.error;

        const offersByProvider: Record<string, ProviderOffer[]> = {};
        for (const row of (offerResult.data ?? []) as unknown as ProviderListingRow[]) {
          if (!row.services) continue;
          (offersByProvider[row.provider_id] ??= []).push({
            id: row.id,
            service_id: row.service_id,
            title: row.title?.trim() || row.services.name,
            image_path: row.image_path,
          });
        }

        const visible = pageProviders.filter((provider) => offersByProvider[provider.provider_id]);
        setProviders((current) => (append ? [...current, ...visible] : visible));
        setProviderOffers((current) =>
          append ? { ...current, ...offersByProvider } : offersByProvider,
        );
        setHasMore(moreAvailable);
        const last = pageProviders[pageProviders.length - 1];
        setCursor(
          moreAvailable && last ? { createdAt: last.created_at, id: last.provider_id } : null,
        );
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : copy.loadError);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [availableOnly, city, copy.loadError, country, professionId, region, search, serviceId],
  );

  useFocusEffect(
    useCallback(() => {
      if (!filtersReady) return;
      if (categoryId && !professionId && !serviceId) {
        setProviders([]);
        setProviderOffers({});
        setHasMore(false);
        setLoading(false);
        return;
      }
      void fetchProviders(null, false);
    }, [categoryId, fetchProviders, filtersReady, professionId, serviceId]),
  );

  async function selectCountry(option: Option | null) {
    const requestId = ++regionRequestId.current;
    cityRequestId.current += 1;
    setCountry(option);
    setRegion(null);
    setCity(null);
    setRegions([]);
    setCities([]);
    setExpandedPicker(null);
    if (!option) return;

    setLoadingRegions(true);
    setError('');
    try {
      const { data, error: queryError } = await supabase
        .from('regions')
        .select('id, name')
        .eq('country_id', option.id)
        .eq('is_active', true)
        .order('name')
        .limit(1000);
      if (queryError) throw queryError;
      if (requestId === regionRequestId.current) setRegions((data ?? []) as Option[]);
    } catch (reason) {
      if (requestId === regionRequestId.current) {
        setError(reason instanceof Error ? reason.message : copy.loadError);
      }
    } finally {
      if (requestId === regionRequestId.current) setLoadingRegions(false);
    }
  }

  async function selectRegion(option: Option | null) {
    const requestId = ++cityRequestId.current;
    setRegion(option);
    setCity(null);
    setCities([]);
    setExpandedPicker(null);
    if (!option || !country) return;

    setLoadingCities(true);
    setError('');
    try {
      const { data, error: queryError } = await supabase
        .from('cities')
        .select('id, name')
        .eq('country_id', country.id)
        .eq('region_id', option.id)
        .eq('is_active', true)
        .order('name')
        .limit(1500);
      if (queryError) throw queryError;
      if (requestId === cityRequestId.current) setCities((data ?? []) as Option[]);
    } catch (reason) {
      if (requestId === cityRequestId.current) {
        setError(reason instanceof Error ? reason.message : copy.loadError);
      }
    } finally {
      if (requestId === cityRequestId.current) setLoadingCities(false);
    }
  }

  function chooseProfession(option: Option | null) {
    setProfessionId(option?.id ?? '');
    if (
      option &&
      serviceId &&
      !services.some((service) => service.id === serviceId && service.profession_id === option.id)
    ) {
      setServiceId('');
    }
    setExpandedPicker(null);
  }

  function chooseCategory(option: Option | null) {
    const nextCategoryId = option?.id ?? '';
    setCategoryId(nextCategoryId);
    if (
      professionId &&
      nextCategoryId &&
      !professions.some(
        (profession) => profession.id === professionId && profession.category_id === nextCategoryId,
      )
    ) {
      setProfessionId('');
      setServiceId('');
    } else if (serviceId) {
      const serviceProfessionId = services.find(
        (service) => service.id === serviceId,
      )?.profession_id;
      if (
        nextCategoryId &&
        !professions.some(
          (profession) =>
            profession.id === serviceProfessionId && profession.category_id === nextCategoryId,
        )
      ) {
        setServiceId('');
      }
    }
    setExpandedPicker(null);
  }

  function chooseService(option: Option | null) {
    setServiceId(option?.id ?? '');
    setExpandedPicker(null);
  }

  function applyFilters() {
    if (categoryId && !professionId && !serviceId) return;
    setProviders([]);
    setCursor(null);
    setHasMore(false);
    void fetchProviders(null, false);
  }

  function openProvider(provider: Provider) {
    router.push({
      pathname: '/providers/[id]',
      params: { id: provider.provider_id, language },
    } as Href);
  }

  function requestOffer(provider: Provider, offer: ProviderOffer) {
    router.push({
      pathname: '/bookings/new',
      params: {
        serviceId: offer.service_id,
        providerId: provider.provider_id,
        providerName: provider.professional_name,
        language,
      },
    } as Href);
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
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
        <Text style={styles.subtitle}>{copy.subtitle}</Text>

        {loadingOptions ? (
          <View style={styles.center}>
            <ActivityIndicator color="#16804A" />
            <Text style={styles.muted}>{copy.loadingFilters}</Text>
          </View>
        ) : (
          <View style={styles.filterCard}>
            <TextInput
              style={styles.searchInput}
              placeholder={copy.searchPlaceholder}
              placeholderTextColor="#89958A"
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
              maxLength={200}
            />
            <ChoiceField
              label={copy.category}
              value={categories.find((item) => item.id === categoryId)?.name ?? ''}
              placeholder={copy.anyCategory}
              options={categories}
              expanded={expandedPicker === 'category'}
              allLabel={copy.anyCategory}
              onToggle={() => setExpandedPicker(expandedPicker === 'category' ? null : 'category')}
              onSelect={chooseCategory}
            />
            {categoryId && !professionId && !serviceId ? (
              <Text style={styles.loadingHint}>{copy.categoryNeedsProfession}</Text>
            ) : null}
            <ChoiceField
              label={copy.profession}
              value={professions.find((item) => item.id === professionId)?.name ?? ''}
              placeholder={copy.anyProfession}
              options={filteredProfessions}
              expanded={expandedPicker === 'profession'}
              allLabel={copy.anyProfession}
              onToggle={() =>
                setExpandedPicker(expandedPicker === 'profession' ? null : 'profession')
              }
              onSelect={chooseProfession}
            />
            <ChoiceField
              label={copy.service}
              value={filteredServices.find((item) => item.id === serviceId)?.name ?? ''}
              placeholder={copy.anyService}
              options={filteredServices}
              expanded={expandedPicker === 'service'}
              allLabel={copy.anyService}
              onToggle={() => setExpandedPicker(expandedPicker === 'service' ? null : 'service')}
              onSelect={chooseService}
            />
            <ChoiceField
              label={copy.country}
              value={country?.name ?? ''}
              placeholder={copy.anyCountry}
              options={countries}
              expanded={expandedPicker === 'country'}
              allLabel={copy.anyCountry}
              onToggle={() => setExpandedPicker(expandedPicker === 'country' ? null : 'country')}
              onSelect={(option) => void selectCountry(option)}
            />
            {loadingRegions ? <Text style={styles.loadingHint}>{copy.loadingRegions}</Text> : null}
            <ChoiceField
              label={copy.region}
              value={region?.name ?? ''}
              placeholder={copy.anyRegion}
              options={regions}
              expanded={expandedPicker === 'region'}
              allLabel={copy.anyRegion}
              disabled={!country || loadingRegions}
              onToggle={() => setExpandedPicker(expandedPicker === 'region' ? null : 'region')}
              onSelect={(option) => void selectRegion(option)}
            />
            {loadingCities ? <Text style={styles.loadingHint}>{copy.loadingCities}</Text> : null}
            <ChoiceField
              label={copy.city}
              value={city?.name ?? ''}
              placeholder={copy.anyCity}
              options={cities}
              expanded={expandedPicker === 'city'}
              allLabel={copy.anyCity}
              disabled={!region || loadingCities}
              onToggle={() => setExpandedPicker(expandedPicker === 'city' ? null : 'city')}
              onSelect={(option) => {
                setCity(option);
                setExpandedPicker(null);
              }}
            />
            <Pressable
              style={styles.availableToggle}
              onPress={() => setAvailableOnly((current) => !current)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: availableOnly }}
            >
              <Text style={[styles.checkbox, availableOnly && styles.checkboxChecked]}>
                {availableOnly ? '✓' : ''}
              </Text>
              <Text style={styles.toggleText}>{copy.availableOnly}</Text>
            </Pressable>
            <View style={styles.verifiedNote}>
              <Text style={styles.verifiedIcon}>✓</Text>
              <Text style={styles.verifiedText}>{copy.verifiedOnly}</Text>
            </View>
            <Pressable
              style={[
                styles.applyButton,
                categoryId && !professionId && !serviceId && styles.disabled,
              ]}
              onPress={applyFilters}
              disabled={Boolean(categoryId && !professionId && !serviceId)}
            >
              <Text style={styles.applyButtonText}>{copy.applyFilters}</Text>
            </Pressable>
          </View>
        )}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              onPress={() => {
                if (filtersReady) {
                  applyFilters();
                } else {
                  setLoadingOptions(true);
                  void loadOptions();
                }
              }}
            >
              <Text style={styles.retry}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
            <Text style={styles.muted}>{copy.loading}</Text>
          </View>
        ) : providers.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{copy.noProviders}</Text>
            <Text style={styles.muted}>{copy.noProvidersHint}</Text>
            {hasMore ? (
              <Pressable
                style={styles.loadMore}
                onPress={() => void fetchProviders(cursor, true)}
                disabled={loadingMore || !cursor}
              >
                {loadingMore ? (
                  <ActivityIndicator color="#16804A" />
                ) : (
                  <Text style={styles.loadMoreText}>{copy.loadMore}</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            <Text style={styles.resultCount}>{copy.results}</Text>
            {providers.map((provider) => (
              <View key={provider.provider_id} style={styles.providerCard}>
                <Pressable
                  style={styles.providerHeader}
                  onPress={() => openProvider(provider)}
                  accessibilityRole="button"
                >
                  {provider.avatar_url ? (
                    <Image source={{ uri: provider.avatar_url }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarInitial}>
                        {provider.professional_name.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.providerInfo}>
                    <View style={styles.nameRow}>
                      <Text style={styles.providerName}>{provider.professional_name}</Text>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>✓ {copy.verified}</Text>
                      </View>
                    </View>
                    <Text style={styles.providerMeta}>
                      {provider.profession_names.join(' · ') || copy.professional}
                    </Text>
                    <Text style={styles.providerMeta}>
                      {provider.availability_status === 'available'
                        ? copy.available
                        : provider.availability_status === 'busy'
                          ? copy.busy
                          : copy.unavailable}
                      {' · '}
                      {copy.experience.replace('{years}', String(provider.years_experience))}
                    </Text>
                    <Text style={styles.providerAreas} numberOfLines={2}>
                      {provider.service_area_labels.join(' • ')}
                    </Text>
                    {provider.description ? (
                      <Text style={styles.providerDescription} numberOfLines={2}>
                        {provider.description}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.arrow}>›</Text>
                </Pressable>
                <View style={styles.offers}>
                  <Text style={styles.offersTitle}>{copy.servicesOffered}</Text>
                  {(providerOffers[provider.provider_id] ?? []).slice(0, 3).map((offer) => (
                    <View key={offer.id} style={styles.offerCard}>
                      {offer.image_path ? (
                        <Image
                          source={{
                            uri: supabase.storage
                              .from('service-images')
                              .getPublicUrl(offer.image_path).data.publicUrl,
                          }}
                          style={styles.offerImage}
                        />
                      ) : null}
                      <View style={styles.offerInfo}>
                        <Text style={styles.offerTitle} numberOfLines={2}>
                          {offer.title}
                        </Text>
                        <Pressable
                          style={styles.offerRequest}
                          onPress={() => requestOffer(provider, offer)}
                        >
                          <Text style={styles.offerRequestText}>{copy.requestService}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))}
            {hasMore ? (
              <Pressable
                style={[styles.loadMore, loadingMore && styles.disabled]}
                onPress={() => void fetchProviders(cursor, true)}
                disabled={loadingMore || !cursor}
              >
                {loadingMore ? (
                  <ActivityIndicator color="#16804A" />
                ) : (
                  <Text style={styles.loadMoreText}>{copy.loadMore}</Text>
                )}
              </Pressable>
            ) : null}
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
  title: { color: '#15251A', fontSize: 28, fontWeight: '900' },
  subtitle: { color: '#66736A', fontSize: 14, lineHeight: 21, marginTop: 6, marginBottom: 14 },
  filterCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 14,
    padding: 13,
    marginBottom: 15,
  },
  searchInput: {
    minHeight: 47,
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#15251A',
    marginBottom: 7,
  },
  field: { marginTop: 8 },
  label: { color: '#536358', fontSize: 12, fontWeight: '800', marginBottom: 5 },
  selector: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 9,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectorText: { flex: 1, color: '#15251A', fontSize: 13 },
  placeholder: { flex: 1, color: '#89958A', fontSize: 13 },
  chevron: { color: '#16804A', fontWeight: '800', marginLeft: 8 },
  options: {
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 9,
    marginTop: 4,
    maxHeight: 190,
    backgroundColor: '#FFFFFF',
  },
  option: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 11 },
  optionText: { color: '#26362B', fontSize: 13 },
  disabled: { opacity: 0.55 },
  loadingHint: { color: '#66736A', fontSize: 12, marginTop: 6 },
  availableToggle: { flexDirection: 'row', alignItems: 'center', marginTop: 15 },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 5,
    color: '#FFFFFF',
    textAlign: 'center',
    textAlignVertical: 'center',
    marginRight: 9,
  },
  checkboxChecked: { backgroundColor: '#16804A', overflow: 'hidden' },
  toggleText: { color: '#26362B', fontSize: 13, fontWeight: '700' },
  verifiedNote: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  verifiedIcon: { color: '#16804A', fontWeight: '900', marginRight: 8 },
  verifiedText: { color: '#536358', fontSize: 12 },
  applyButton: {
    minHeight: 44,
    borderRadius: 9,
    backgroundColor: '#16804A',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 14,
  },
  applyButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  center: { paddingVertical: 36, alignItems: 'center' },
  muted: { color: '#66736A', fontSize: 13, lineHeight: 20, marginTop: 7 },
  empty: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 20, alignItems: 'center' },
  emptyTitle: { color: '#15251A', fontSize: 16, fontWeight: '900', textAlign: 'center' },
  resultCount: { color: '#66736A', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  providerCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  providerHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  avatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#EAF6EE' },
  avatarFallback: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#EAF6EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: '#16804A', fontSize: 22, fontWeight: '900' },
  providerInfo: { flex: 1, marginLeft: 11 },
  nameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  providerName: { color: '#15251A', fontSize: 15, fontWeight: '900', flexShrink: 1 },
  badge: { backgroundColor: '#EAF6EE', borderRadius: 8, paddingVertical: 3, paddingHorizontal: 6 },
  badgeText: { color: '#16804A', fontSize: 9, fontWeight: '900' },
  providerMeta: { color: '#536358', fontSize: 11, lineHeight: 17, marginTop: 4 },
  providerAreas: { color: '#16804A', fontSize: 11, lineHeight: 16, marginTop: 4 },
  providerDescription: { color: '#66736A', fontSize: 11, lineHeight: 16, marginTop: 4 },
  arrow: { color: '#16804A', fontSize: 23, fontWeight: '700', marginLeft: 6 },
  offers: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#EDF1ED' },
  offersTitle: { color: '#66736A', fontSize: 11, fontWeight: '800', marginTop: 9 },
  offerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#EDF1ED',
  },
  offerImage: { width: 56, height: 56, borderRadius: 9, backgroundColor: '#EAF6EE' },
  offerInfo: { flex: 1, marginLeft: 10 },
  offerTitle: { color: '#15251A', fontSize: 13, fontWeight: '800' },
  offerRequest: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: 7,
    backgroundColor: '#16804A',
  },
  offerRequestText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  loadMore: {
    minHeight: 45,
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 3,
  },
  loadMoreText: { color: '#16804A', fontWeight: '800', fontSize: 13 },
  errorCard: { backgroundColor: '#FCECEC', padding: 13, borderRadius: 10, marginBottom: 12 },
  errorText: { color: '#8E2525', lineHeight: 20 },
  retry: { color: '#16804A', fontWeight: '800', marginTop: 8 },
});
