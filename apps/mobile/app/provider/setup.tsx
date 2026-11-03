import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, Stack, type Href } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { getTranslations } from '../../lib/translations';
import { usePersistentLanguage } from '../../lib/usePersistentLanguage';

type Option = { id: string; name: string };
type Profession = Option;
type Service = Option & { profession_id: string };
type ServiceArea = { city_id: string; name: string };

function ChoiceList({
  label,
  placeholder,
  options,
  selected,
  expanded,
  emptyMessage,
  disabled,
  onToggle,
  onSelect,
}: {
  label: string;
  placeholder: string;
  options: Option[];
  selected: Option | null;
  expanded: boolean;
  emptyMessage: string;
  disabled?: boolean;
  onToggle: () => void;
  onSelect: (option: Option) => void;
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
        <Text style={selected ? styles.selectorText : styles.placeholder}>
          {selected?.name ?? placeholder}
        </Text>
        <Text style={styles.chevron}>{expanded ? '⌃' : '⌄'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.options}>
          {options.length ? (
            options.map((option) => (
              <Pressable key={option.id} style={styles.option} onPress={() => onSelect(option)}>
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

export default function ProviderSetupScreen() {
  const [language, setLanguage] = usePersistentLanguage();
  const copy = getTranslations(language).providerSetup;
  const [professions, setProfessions] = useState<Profession[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [countries, setCountries] = useState<Option[]>([]);
  const [regions, setRegions] = useState<Option[]>([]);
  const [cities, setCities] = useState<Option[]>([]);
  const [selectedProfessionIds, setSelectedProfessionIds] = useState<string[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<Option | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<Option | null>(null);
  const [selectedCity, setSelectedCity] = useState<Option | null>(null);
  const [selectedAreas, setSelectedAreas] = useState<ServiceArea[]>([]);
  const [expanded, setExpanded] = useState<'country' | 'region' | 'city' | null>(null);
  const [loadingLocation, setLoadingLocation] = useState<'regions' | 'cities' | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const regionRequestId = useRef(0);
  const cityRequestId = useRef(0);

  const loadSetup = useCallback(async () => {
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!userResult.user) throw new Error(copy.signInRequired);

    const [applicationResult, professionResult, serviceResult, countryResult] = await Promise.all([
      supabase
        .from('provider_applications')
        .select('id')
        .eq('user_id', userResult.user.id)
        .eq('verification_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('professions')
        .select('id, name')
        .eq('is_active', true)
        .order('name')
        .limit(500),
      supabase
        .from('services')
        .select('id, name, profession_id')
        .eq('is_active', true)
        .order('name')
        .limit(1000),
      supabase.from('countries').select('id, name').eq('is_active', true).order('name').limit(500),
    ]);

    if (applicationResult.error) throw applicationResult.error;
    if (professionResult.error) throw professionResult.error;
    if (serviceResult.error) throw serviceResult.error;
    if (countryResult.error) throw countryResult.error;
    if (!applicationResult.data) throw new Error(copy.approvedRequired);

    return {
      professions: (professionResult.data ?? []) as Profession[],
      services: (serviceResult.data ?? []) as Service[],
      countries: (countryResult.data ?? []) as Option[],
    };
  }, [copy.approvedRequired, copy.signInRequired]);

  const applySetup = useCallback((data: Awaited<ReturnType<typeof loadSetup>>) => {
    setProfessions(data.professions);
    setServices(data.services);
    setCountries(data.countries);
  }, []);

  const showLoadError = useCallback((reason: unknown) => {
    setError(reason instanceof Error ? reason.message : 'Provider setup could not be loaded.');
  }, []);

  useEffect(() => {
    let active = true;
    void loadSetup()
      .then((data) => {
        if (active) applySetup(data);
      })
      .catch((reason: unknown) => {
        if (active) showLoadError(reason);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [applySetup, loadSetup, showLoadError]);

  async function selectCountry(option: Option) {
    const requestId = ++regionRequestId.current;
    cityRequestId.current += 1;
    setSelectedCountry(option);
    setSelectedRegion(null);
    setSelectedCity(null);
    setRegions([]);
    setCities([]);
    setExpanded(null);
    setLoadingLocation('regions');

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
        setError(reason instanceof Error ? reason.message : copy.error);
      }
    } finally {
      if (requestId === regionRequestId.current) setLoadingLocation(null);
    }
  }

  async function selectRegion(option: Option) {
    if (!selectedCountry || !regions.some((region) => region.id === option.id)) return;
    const requestId = ++cityRequestId.current;
    setSelectedRegion(option);
    setSelectedCity(null);
    setCities([]);
    setExpanded(null);
    setLoadingLocation('cities');

    try {
      const { data, error: queryError } = await supabase
        .from('cities')
        .select('id, name')
        .eq('country_id', selectedCountry.id)
        .eq('region_id', option.id)
        .eq('is_active', true)
        .order('name')
        .limit(1000);
      if (queryError) throw queryError;
      if (requestId === cityRequestId.current) setCities((data ?? []) as Option[]);
    } catch (reason) {
      if (requestId === cityRequestId.current) {
        setError(reason instanceof Error ? reason.message : copy.error);
      }
    } finally {
      if (requestId === cityRequestId.current) setLoadingLocation(null);
    }
  }

  function toggleProfession(professionId: string) {
    setSelectedProfessionIds((current) => {
      const next = current.includes(professionId)
        ? current.filter((id) => id !== professionId)
        : [...current, professionId];
      setSelectedServiceIds((selected) =>
        selected.filter((serviceId) => {
          const service = services.find((item) => item.id === serviceId);
          return service !== undefined && next.includes(service.profession_id);
        }),
      );
      return next;
    });
  }

  function toggleService(serviceId: string) {
    setSelectedServiceIds((current) =>
      current.includes(serviceId)
        ? current.filter((id) => id !== serviceId)
        : [...current, serviceId],
    );
  }

  function addArea() {
    if (!selectedCity) return;
    setSelectedAreas((current) =>
      current.some((area) => area.city_id === selectedCity.id)
        ? current
        : [...current, { city_id: selectedCity.id, name: selectedCity.name }],
    );
    setSelectedCity(null);
  }

  async function submitSetup() {
    setError('');
    if (!selectedProfessionIds.length) {
      setError(copy.chooseProfession);
      return;
    }
    if (!selectedServiceIds.length) {
      setError(copy.chooseServices);
      return;
    }
    if (!selectedAreas.length) {
      setError(copy.chooseLocation);
      return;
    }

    setSaving(true);
    try {
      const { error: rpcError } = await supabase.rpc('provider_complete_setup', {
        p_profession_ids: selectedProfessionIds,
        p_service_ids: selectedServiceIds,
        p_service_areas: selectedAreas.map((area) => ({
          city_id: area.city_id,
          neighborhood_id: null,
        })),
      });
      if (rpcError) throw rpcError;
      router.replace('/provider/dashboard' as Href);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.error);
    } finally {
      setSaving(false);
    }
  }

  const visibleServices = services.filter((service) =>
    selectedProfessionIds.includes(service.profession_id),
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ title: copy.title }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
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
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
            <Text style={styles.muted}>{copy.loading}</Text>
          </View>
        ) : error && professions.length === 0 && services.length === 0 ? (
          <View style={styles.notice}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                setLoading(true);
                setError('');
                void loadSetup()
                  .then(applySetup)
                  .catch(showLoadError)
                  .finally(() => setLoading(false));
              }}
            >
              <Text style={styles.secondaryButtonText}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>{copy.professions}</Text>
            {professions.length ? (
              <View style={styles.choiceList}>
                {professions.map((profession) => {
                  const selected = selectedProfessionIds.includes(profession.id);
                  return (
                    <Pressable
                      key={profession.id}
                      style={styles.checkRow}
                      onPress={() => toggleProfession(profession.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                    >
                      <Text style={[styles.checkbox, selected && styles.checkboxSelected]}>
                        {selected ? '✓' : ''}
                      </Text>
                      <Text style={styles.optionText}>{profession.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.muted}>{copy.noProfessions}</Text>
            )}

            <Text style={styles.sectionTitle}>{copy.services}</Text>
            {visibleServices.length ? (
              <View style={styles.choiceList}>
                {visibleServices.map((service) => {
                  const selected = selectedServiceIds.includes(service.id);
                  return (
                    <Pressable
                      key={service.id}
                      style={styles.checkRow}
                      onPress={() => toggleService(service.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                    >
                      <Text style={[styles.checkbox, selected && styles.checkboxSelected]}>
                        {selected ? '✓' : ''}
                      </Text>
                      <Text style={styles.optionText}>{service.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.muted}>{copy.noServices}</Text>
            )}

            <Text style={styles.sectionTitle}>{copy.locations}</Text>
            <Text style={styles.hint}>{copy.chooseLocation}</Text>
            <ChoiceList
              label={copy.chooseCountry}
              placeholder={copy.chooseCountry}
              options={countries}
              selected={selectedCountry}
              expanded={expanded === 'country'}
              emptyMessage={copy.noCountries}
              onToggle={() => setExpanded(expanded === 'country' ? null : 'country')}
              onSelect={(option) => void selectCountry(option)}
            />
            <ChoiceList
              label={copy.chooseRegion}
              placeholder={copy.chooseRegion}
              options={regions}
              selected={selectedRegion}
              expanded={expanded === 'region'}
              emptyMessage={copy.noRegions}
              disabled={!selectedCountry || loadingLocation !== null}
              onToggle={() => setExpanded(expanded === 'region' ? null : 'region')}
              onSelect={(option) => void selectRegion(option)}
            />
            <ChoiceList
              label={copy.chooseCity}
              placeholder={copy.chooseCity}
              options={cities}
              selected={selectedCity}
              expanded={expanded === 'city'}
              emptyMessage={copy.noCities}
              disabled={!selectedRegion || loadingLocation !== null}
              onToggle={() => setExpanded(expanded === 'city' ? null : 'city')}
              onSelect={(option) => {
                setSelectedCity(option);
                setExpanded(null);
              }}
            />
            {loadingLocation ? (
              <View style={styles.inlineLoading}>
                <ActivityIndicator size="small" color="#16804A" />
                <Text style={styles.muted}>
                  {loadingLocation === 'regions' ? copy.loadingRegions : copy.loadingCities}
                </Text>
              </View>
            ) : null}
            {selectedCountry && !loadingLocation && !regions.length ? (
              <Text style={styles.locationFallback}>{copy.noLocationData}</Text>
            ) : null}
            <Pressable
              style={[styles.secondaryButton, !selectedCity && styles.disabled]}
              onPress={addArea}
              disabled={!selectedCity}
            >
              <Text style={styles.secondaryButtonText}>{copy.addLocation}</Text>
            </Pressable>
            {selectedAreas.length ? (
              <>
                <Text style={styles.label}>{copy.selectedLocations}</Text>
                {selectedAreas.map((area) => (
                  <View key={area.city_id} style={styles.areaRow}>
                    <Text style={styles.optionText}>{area.name}</Text>
                    <Pressable
                      onPress={() =>
                        setSelectedAreas((current) =>
                          current.filter((item) => item.city_id !== area.city_id),
                        )
                      }
                    >
                      <Text style={styles.removeText}>{copy.removeLocation}</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            ) : null}

            {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
            <Pressable
              style={[styles.button, saving && styles.disabled]}
              onPress={() => void submitSetup()}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>{copy.save}</Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F8F5' },
  content: { padding: 22, paddingTop: 28, paddingBottom: 45 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  back: { color: '#16804A', fontSize: 15, fontWeight: '700' },
  languageOptions: { flexDirection: 'row', gap: 6 },
  languageOption: {
    borderWidth: 1,
    borderColor: '#DDE6DE',
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 9,
    backgroundColor: '#FFFFFF',
  },
  languageActive: { backgroundColor: '#EAF6EE', borderColor: '#16804A' },
  languageText: { color: '#16804A', fontSize: 11, fontWeight: '800' },
  brand: { color: '#16804A', fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: '#15251A', fontSize: 27, fontWeight: '900', marginTop: 14 },
  subtitle: { color: '#66736A', fontSize: 15, lineHeight: 22, marginTop: 8 },
  sectionTitle: {
    color: '#15251A',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 25,
    marginBottom: 10,
  },
  choiceList: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2EAE3',
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2EE',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: '#B8C7BA',
    borderRadius: 6,
    marginRight: 11,
    textAlign: 'center',
    overflow: 'hidden',
    color: '#FFFFFF',
    lineHeight: 20,
  },
  checkboxSelected: { backgroundColor: '#16804A', borderColor: '#16804A' },
  optionText: { color: '#26382B', fontSize: 14, flex: 1 },
  field: { marginTop: 12 },
  label: { color: '#26382B', fontSize: 14, fontWeight: '700', marginBottom: 7 },
  selector: {
    minHeight: 49,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 11,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectorText: { flex: 1, color: '#15251A', fontSize: 14 },
  placeholder: { flex: 1, color: '#89958B', fontSize: 14 },
  chevron: { color: '#16804A', fontSize: 18, fontWeight: '800', marginLeft: 8 },
  options: {
    marginTop: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 11,
    overflow: 'hidden',
  },
  option: { padding: 13, borderBottomWidth: 1, borderBottomColor: '#EDF2EE' },
  emptyOption: { color: '#66736A', padding: 13, fontSize: 13 },
  disabled: { opacity: 0.55 },
  hint: { color: '#66736A', fontSize: 13, lineHeight: 19, marginBottom: 6 },
  muted: { color: '#66736A', fontSize: 14, marginTop: 8 },
  center: { paddingVertical: 50, alignItems: 'center' },
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
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    marginTop: 7,
  },
  removeText: { color: '#A12A2A', fontWeight: '700', fontSize: 12 },
  notice: { backgroundColor: '#FFFFFF', padding: 18, borderRadius: 14, marginTop: 18 },
  errorText: { color: '#A12A2A', lineHeight: 21 },
  errorBanner: {
    color: '#8E2525',
    backgroundColor: '#FCECEC',
    padding: 12,
    marginTop: 18,
    borderRadius: 10,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#16804A',
    minHeight: 51,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 25,
    paddingHorizontal: 16,
  },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondaryButton: {
    minHeight: 45,
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingHorizontal: 14,
  },
  secondaryButtonText: { color: '#16804A', fontSize: 13, fontWeight: '800' },
});
