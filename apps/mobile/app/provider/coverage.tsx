import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { getTranslations } from '../../lib/translations';
import { usePersistentLanguage } from '../../lib/usePersistentLanguage';

type Option = { id: string; name: string };
type Area = { id: string; city_id: string; label: string };
type ProviderIdentity = { id: string; verification_status: string };
type AreaRow = { id: string; city_id: string; region_id: string; country_id: string };

export default function ProviderCoverageScreen() {
  const params = useLocalSearchParams<{ language?: string | string[] }>();
  const [language, setLanguage] = usePersistentLanguage(params.language);
  const copy = getTranslations(language).providerCoverage;
  const [provider, setProvider] = useState<ProviderIdentity | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [countries, setCountries] = useState<Option[]>([]);
  const [regions, setRegions] = useState<Option[]>([]);
  const [cities, setCities] = useState<Option[]>([]);
  const [country, setCountry] = useState<Option | null>(null);
  const [region, setRegion] = useState<Option | null>(null);
  const [city, setCity] = useState<Option | null>(null);
  const [expanded, setExpanded] = useState<'country' | 'region' | 'city' | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOptions, setLoadingOptions] = useState<'regions' | 'cities' | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadCoverage = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userResult.user) throw new Error(copy.signInRequired);
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', userResult.user.id)
        .single();
      if (profileError) throw profileError;
      const { data: providerData, error: providerError } = await supabase
        .from('provider_profiles')
        .select('id, verification_status')
        .eq('profile_id', profile.id)
        .maybeSingle();
      if (providerError) throw providerError;
      if (!providerData || providerData.verification_status !== 'verified') {
        throw new Error(copy.signInRequired);
      }

      const [countryResult, areaResult] = await Promise.all([
        supabase
          .from('countries')
          .select('id, name')
          .eq('is_active', true)
          .order('name')
          .limit(500),
        supabase
          .from('provider_service_areas')
          .select('id, city_id, region_id, country_id')
          .eq('provider_id', providerData.id)
          .limit(500),
      ]);
      if (countryResult.error) throw countryResult.error;
      if (areaResult.error) throw areaResult.error;

      const rows = (areaResult.data ?? []) as AreaRow[];
      const cityIds = [...new Set(rows.map((item) => item.city_id))];
      const regionIds = [...new Set(rows.map((item) => item.region_id))];
      const countryIds = [...new Set(rows.map((item) => item.country_id))];
      const [cityResult, regionResult, areaCountryResult] =
        cityIds.length && regionIds.length && countryIds.length
          ? await Promise.all([
              supabase.from('cities').select('id, name').in('id', cityIds),
              supabase.from('regions').select('id, name').in('id', regionIds),
              supabase.from('countries').select('id, name').in('id', countryIds),
            ])
          : [
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
            ];
      if (cityResult.error) throw cityResult.error;
      if (regionResult.error) throw regionResult.error;
      if (areaCountryResult.error) throw areaCountryResult.error;

      const cityNames = new Map((cityResult.data ?? []).map((item) => [item.id, item.name]));
      const regionNames = new Map((regionResult.data ?? []).map((item) => [item.id, item.name]));
      const countryNames = new Map(
        (areaCountryResult.data ?? []).map((item) => [item.id, item.name]),
      );
      setProvider(providerData as ProviderIdentity);
      setCountries((countryResult.data ?? []) as Option[]);
      setAreas(
        rows.map((item) => ({
          id: item.id,
          city_id: item.city_id,
          label: [
            cityNames.get(item.city_id),
            regionNames.get(item.region_id),
            countryNames.get(item.country_id),
          ]
            .filter(Boolean)
            .join(', '),
        })),
      );
    } catch {
      setError(copy.error);
    } finally {
      setLoading(false);
    }
  }, [copy.error, copy.signInRequired]);

  useFocusEffect(
    useCallback(() => {
      void loadCoverage();
    }, [loadCoverage]),
  );

  async function selectCountry(option: Option) {
    setCountry(option);
    setRegion(null);
    setCity(null);
    setRegions([]);
    setCities([]);
    setExpanded(null);
    setLoadingOptions('regions');
    try {
      const { data, error: queryError } = await supabase
        .from('regions')
        .select('id, name')
        .eq('country_id', option.id)
        .eq('is_active', true)
        .order('name')
        .limit(1000);
      if (queryError) throw queryError;
      setRegions((data ?? []) as Option[]);
    } catch {
      setError(copy.error);
    } finally {
      setLoadingOptions(null);
    }
  }

  async function selectRegion(option: Option) {
    if (!country) return;
    setRegion(option);
    setCity(null);
    setCities([]);
    setExpanded(null);
    setLoadingOptions('cities');
    try {
      const { data, error: queryError } = await supabase
        .from('cities')
        .select('id, name')
        .eq('country_id', country.id)
        .eq('region_id', option.id)
        .eq('is_active', true)
        .order('name')
        .limit(1000);
      if (queryError) throw queryError;
      setCities((data ?? []) as Option[]);
    } catch {
      setError(copy.error);
    } finally {
      setLoadingOptions(null);
    }
  }

  async function addArea() {
    if (!provider || !country || !region || !city || saving) return;
    setSaving(true);
    setError('');
    try {
      const { data, error: insertError } = await supabase
        .from('provider_service_areas')
        .insert({
          provider_id: provider.id,
          country_id: country.id,
          region_id: region.id,
          city_id: city.id,
        })
        .select('id, city_id')
        .single();
      if (insertError) throw insertError;
      setAreas((current) => [
        ...current,
        {
          id: data.id,
          city_id: data.city_id,
          label: [city.name, region.name, country.name].join(', '),
        },
      ]);
      setCity(null);
    } catch {
      setError(copy.error);
    } finally {
      setSaving(false);
    }
  }

  async function removeArea(area: Area) {
    setRemovingId(area.id);
    setError('');
    try {
      const { error: deleteError } = await supabase
        .from('provider_service_areas')
        .delete()
        .eq('id', area.id)
        .eq('provider_id', provider?.id);
      if (deleteError) throw deleteError;
      setAreas((current) => current.filter((entry) => entry.id !== area.id));
    } catch {
      setError(copy.error);
    } finally {
      setRemovingId(null);
    }
  }

  function renderSelector(
    type: 'country' | 'region' | 'city',
    label: string,
    selected: Option | null,
    options: Option[],
    emptyMessage: string,
    disabled = false,
    onSelect?: (option: Option) => void,
  ) {
    const isExpanded = expanded === type;
    return (
      <View style={styles.selectorGroup}>
        <Text style={styles.label}>{label}</Text>
        <Pressable
          style={[styles.selector, disabled && styles.disabled]}
          onPress={() => setExpanded(isExpanded ? null : type)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ expanded: isExpanded, disabled }}
        >
          <Text style={selected ? styles.selectorText : styles.placeholder}>
            {selected?.name ?? label}
          </Text>
          <Text style={styles.chevron}>{isExpanded ? '⌃' : '⌄'}</Text>
        </Pressable>
        {isExpanded ? (
          <View style={styles.options}>
            {options.length ? (
              options.map((option) => (
                <Pressable
                  key={option.id}
                  style={styles.option}
                  onPress={() => {
                    if (onSelect) onSelect(option);
                    else {
                      setCity(option);
                      setExpanded(null);
                    }
                  }}
                >
                  <Text style={styles.optionText}>{option.name}</Text>
                </Pressable>
              ))
            ) : (
              <Text style={styles.muted}>{emptyMessage}</Text>
            )}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: copy.title }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.back}>‹ {getTranslations(language).back}</Text>
        </Pressable>
        <View style={styles.languageOptions}>
          {(['en', 'fr'] as const).map((option) => (
            <Pressable
              key={option}
              style={[styles.languageOption, language === option && styles.languageActive]}
              onPress={() => setLanguage(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: language === option }}
            >
              <Text style={styles.languageText}>{option.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>{getTranslations(language).brand}</Text>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void loadCoverage()}>
              <Text style={styles.retry}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : null}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
            <Text style={styles.muted}>{copy.loading}</Text>
          </View>
        ) : provider ? (
          <>
            <View style={styles.card}>
              {renderSelector(
                'country',
                copy.chooseCountry,
                country,
                countries,
                copy.noCountries,
                false,
                (option) => void selectCountry(option),
              )}
              {renderSelector(
                'region',
                copy.chooseRegion,
                region,
                regions,
                copy.noRegions,
                !country || loadingOptions !== null,
                (option) => void selectRegion(option),
              )}
              {renderSelector(
                'city',
                copy.chooseCity,
                city,
                cities,
                copy.noCities,
                !region || loadingOptions !== null,
              )}
              {loadingOptions ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color="#16804A" />
                  <Text style={styles.muted}>
                    {loadingOptions === 'cities' ? copy.loadingCities : copy.loadingRegions}
                  </Text>
                </View>
              ) : null}
              <Pressable
                style={[styles.primaryButton, (!city || saving) && styles.disabled]}
                onPress={() => void addArea()}
                disabled={!city || saving}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>{copy.add}</Text>
                )}
              </Pressable>
            </View>
            <Text style={styles.sectionTitle}>{copy.currentAreas}</Text>
            {areas.length ? (
              areas.map((area) => (
                <View key={area.id} style={styles.areaRow}>
                  <Text style={styles.areaLabel}>{area.label}</Text>
                  <Pressable
                    onPress={() => void removeArea(area)}
                    disabled={removingId === area.id}
                  >
                    {removingId === area.id ? (
                      <ActivityIndicator color="#A12A2A" />
                    ) : (
                      <Text style={styles.remove}>{copy.remove}</Text>
                    )}
                  </Pressable>
                </View>
              ))
            ) : (
              <View style={styles.card}>
                <Text style={styles.muted}>{copy.noAreas}</Text>
              </View>
            )}
          </>
        ) : (
          <View style={styles.card}>
            <Text style={styles.errorText}>{copy.error}</Text>
            <Pressable onPress={() => void loadCoverage()}>
              <Text style={styles.retry}>{copy.retry}</Text>
            </Pressable>
          </View>
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
    paddingBottom: 15,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5ECE6',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  content: { padding: 20, paddingBottom: 45 },
  brand: { color: '#16804A', fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: '#15251A', fontSize: 27, fontWeight: '900', marginTop: 14 },
  subtitle: { color: '#66736A', fontSize: 14, lineHeight: 21, marginTop: 7, marginBottom: 18 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 15,
    padding: 16,
    marginBottom: 13,
  },
  selectorGroup: { marginBottom: 12 },
  label: { color: '#16804A', fontSize: 12, fontWeight: '800', marginBottom: 6 },
  selector: {
    minHeight: 47,
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 9,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectorText: { flex: 1, color: '#15251A' },
  placeholder: { flex: 1, color: '#89958B' },
  chevron: { color: '#16804A', fontSize: 18, fontWeight: '800' },
  options: {
    maxHeight: 210,
    marginTop: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 9,
  },
  option: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#EDF2EE' },
  optionText: { color: '#15251A', fontSize: 14 },
  primaryButton: {
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: '#16804A',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  sectionTitle: { color: '#15251A', fontSize: 19, fontWeight: '900', marginVertical: 10 },
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 12,
    padding: 13,
    marginBottom: 8,
  },
  areaLabel: { flex: 1, color: '#26382B', fontSize: 13, lineHeight: 19 },
  remove: { color: '#A12A2A', fontSize: 12, fontWeight: '800' },
  muted: { color: '#66736A', fontSize: 13, lineHeight: 19, marginTop: 5 },
  disabled: { opacity: 0.55 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  center: { paddingVertical: 45, alignItems: 'center' },
  errorCard: { backgroundColor: '#FCECEC', borderRadius: 11, padding: 13, marginBottom: 12 },
  errorText: { color: '#8E2525', lineHeight: 20 },
  retry: { color: '#16804A', fontWeight: '800', marginTop: 8 },
});
