import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
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
import { usePersistentLanguage } from '../../lib/usePersistentLanguage';

type CatalogService = {
  id: string;
  name: string;
  profession_id: string;
  profession_name: string;
  description: string | null;
};
type Currency = { id: string; code: string };
type ProviderService = {
  id: string;
  service_id: string;
  title: string;
  description: string;
  price: string;
  currency_id: string | null;
  price_type: 'negotiable' | 'starting_from';
  estimated_duration_minutes: string;
  is_active: boolean;
  image_path: string | null;
};
type ProviderIdentity = { id: string; verification_status: string };
type ServiceRow = {
  id: string;
  service_id: string;
  title: string | null;
  description: string | null;
  price: number | null;
  currency_id: string | null;
  price_type: string;
  estimated_duration_minutes: number | null;
  is_active: boolean;
  image_path: string | null;
};
const allowedImages = ['image/jpeg', 'image/png', 'image/webp'] as const;
const maxImageSize = 20 * 1024 * 1024;

export default function ProviderServicesScreen() {
  const params = useLocalSearchParams<{ language?: string | string[] }>();
  const [language, setLanguage] = usePersistentLanguage(params.language);
  const copy = getTranslations(language).providerServices;
  const [provider, setProvider] = useState<ProviderIdentity | null>(null);
  const [items, setItems] = useState<ProviderService[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogService[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadServices = useCallback(async () => {
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

      const { data: professions, error: professionError } = await supabase
        .from('provider_professions')
        .select('profession_id')
        .eq('provider_id', providerData.id)
        .eq('verification_status', 'verified');
      if (professionError) throw professionError;

      const professionIds = (professions ?? []).map((item) => item.profession_id);
      const [serviceResult, listingResult, currencyResult, professionResult] = await Promise.all([
        professionIds.length
          ? supabase
              .from('services')
              .select('id, name, profession_id, description')
              .in('profession_id', professionIds)
              .eq('is_active', true)
              .order('name')
              .limit(500)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('provider_services')
          .select(
            'id, service_id, title, description, price, currency_id, price_type, estimated_duration_minutes, is_active, image_path',
          )
          .eq('provider_id', providerData.id)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('currencies')
          .select('id, code')
          .eq('is_active', true)
          .order('code')
          .limit(100),
        professionIds.length
          ? supabase.from('professions').select('id, name').in('id', professionIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (serviceResult.error) throw serviceResult.error;
      if (listingResult.error) throw listingResult.error;
      if (currencyResult.error) throw currencyResult.error;
      if (professionResult.error) throw professionResult.error;

      const professionNames = new Map(
        (professionResult.data ?? []).map((profession) => [profession.id, profession.name]),
      );
      const catalogServices = (
        (serviceResult.data ?? []) as Omit<CatalogService, 'profession_name'>[]
      ).map((service) => ({
        ...service,
        profession_name: professionNames.get(service.profession_id) ?? '',
      }));
      const serviceById = new Map(catalogServices.map((service) => [service.id, service]));
      setProvider(providerData as ProviderIdentity);
      setCatalog(catalogServices);
      setCurrencies((currencyResult.data ?? []) as Currency[]);
      setItems(
        ((listingResult.data ?? []) as ServiceRow[]).map((row) => ({
          id: row.id,
          service_id: row.service_id,
          title: row.title ?? serviceById.get(row.service_id)?.name ?? '',
          description: row.description ?? '',
          price: row.price === null ? '' : String(row.price),
          currency_id: row.currency_id,
          price_type: row.price_type === 'starting_from' ? 'starting_from' : 'negotiable',
          estimated_duration_minutes:
            row.estimated_duration_minutes === null ? '' : String(row.estimated_duration_minutes),
          is_active: row.is_active,
          image_path: row.image_path,
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
      void loadServices();
    }, [loadServices]),
  );

  function updateDraft(id: string, patch: Partial<ProviderService>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function addService(service: CatalogService) {
    if (!provider) return;
    setSavingId(service.id);
    setError('');
    setNotice('');
    try {
      const { data, error: insertError } = await supabase
        .from('provider_services')
        .insert({ provider_id: provider.id, service_id: service.id })
        .select(
          'id, service_id, title, description, price, currency_id, price_type, estimated_duration_minutes, is_active, image_path',
        )
        .single();
      if (insertError) throw insertError;
      const row = data as ServiceRow;
      setItems((current) => [
        {
          id: row.id,
          service_id: row.service_id,
          title: row.title ?? service.name,
          description: row.description ?? '',
          price: '',
          currency_id: null,
          price_type: 'negotiable',
          estimated_duration_minutes: '',
          is_active: row.is_active,
          image_path: null,
        },
        ...current,
      ]);
      setNotice(copy.success);
    } catch {
      setError(copy.error);
    } finally {
      setSavingId(null);
    }
  }

  async function saveService(item: ProviderService) {
    const title = item.title.trim();
    const numericPrice = item.price.trim() ? Number(item.price) : null;
    const duration = item.estimated_duration_minutes.trim()
      ? Number(item.estimated_duration_minutes)
      : null;
    if (!title) {
      setError(copy.titleRequired);
      return;
    }
    if (
      numericPrice !== null &&
      (!Number.isFinite(numericPrice) || numericPrice < 0 || !item.currency_id)
    ) {
      setError(copy.invalidPrice);
      return;
    }
    if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 10080)) {
      setError(copy.error);
      return;
    }

    setSavingId(item.id);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from('provider_services')
        .update({
          title,
          description: item.description.trim() || null,
          price: numericPrice,
          currency_id: numericPrice === null ? null : item.currency_id,
          price_type: numericPrice === null ? 'negotiable' : 'starting_from',
          estimated_duration_minutes: duration,
        })
        .eq('id', item.id)
        .eq('provider_id', provider?.id);
      if (updateError) throw updateError;
      updateDraft(item.id, {
        title,
        price_type: numericPrice === null ? 'negotiable' : 'starting_from',
      });
      setNotice(copy.success);
    } catch {
      setError(copy.error);
    } finally {
      setSavingId(null);
    }
  }

  async function toggleActive(item: ProviderService) {
    setSavingId(item.id);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from('provider_services')
        .update({ is_active: !item.is_active })
        .eq('id', item.id)
        .eq('provider_id', provider?.id);
      if (updateError) throw updateError;
      updateDraft(item.id, { is_active: !item.is_active });
    } catch {
      setError(copy.error);
    } finally {
      setSavingId(null);
    }
  }

  async function chooseImage(item: ProviderService) {
    setError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...allowedImages],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const photo = result.assets[0];
      if (
        !photo ||
        !allowedImages.includes(photo.mimeType as (typeof allowedImages)[number]) ||
        (photo.size !== undefined && photo.size > maxImageSize)
      ) {
        throw new Error(copy.imageError);
      }

      setImageId(item.id);
      const response = await fetch(photo.uri);
      if (!response.ok) throw new Error(copy.imageError);
      const fileData = await response.arrayBuffer();
      if (!fileData.byteLength || fileData.byteLength > maxImageSize || !provider) {
        throw new Error(copy.imageError);
      }

      const extension =
        photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const path = `${provider.id}/${item.service_id}/${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2)}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from('service-images')
        .upload(path, fileData, { contentType: photo.mimeType ?? undefined, upsert: false });
      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('provider_services')
        .update({ image_path: path })
        .eq('id', item.id)
        .eq('provider_id', provider.id);
      if (updateError) {
        const { error: cleanupError } = await supabase.storage
          .from('service-images')
          .remove([path]);
        if (cleanupError) console.error('Unable to remove an unlinked service image', cleanupError);
        throw updateError;
      }
      let cleanupFailed = false;
      if (item.image_path) {
        const { error: removeError } = await supabase.storage
          .from('service-images')
          .remove([item.image_path]);
        if (removeError) {
          console.error('Unable to remove the replaced service image', removeError);
          cleanupFailed = true;
        }
      }
      updateDraft(item.id, { image_path: path });
      setNotice(cleanupFailed ? copy.imageCleanupError : copy.success);
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message === copy.imageError
          ? copy.imageError
          : copy.imageUploadError,
      );
    } finally {
      setImageId(null);
    }
  }

  async function removeImage(item: ProviderService) {
    if (!item.image_path || !provider) return;
    setImageId(item.id);
    setError('');
    try {
      const { error: updateError } = await supabase
        .from('provider_services')
        .update({ image_path: null })
        .eq('id', item.id)
        .eq('provider_id', provider.id);
      if (updateError) throw updateError;
      const { error: removeError } = await supabase.storage
        .from('service-images')
        .remove([item.image_path]);
      if (removeError) {
        const { error: restoreError } = await supabase
          .from('provider_services')
          .update({ image_path: item.image_path })
          .eq('id', item.id)
          .eq('provider_id', provider.id);
        if (restoreError) {
          console.error(
            'Unable to restore service image metadata after removal failed',
            restoreError,
          );
        }
        throw removeError;
      }
      updateDraft(item.id, { image_path: null });
    } catch {
      setError(copy.imageUploadError);
    } finally {
      setImageId(null);
    }
  }

  function deleteService(item: ProviderService) {
    if (!provider || item.image_path) return;
    Alert.alert(copy.delete, copy.confirmDelete, [
      { text: getTranslations(language).back, style: 'cancel' },
      {
        text: copy.delete,
        style: 'destructive',
        onPress: () => void performDelete(item),
      },
    ]);
  }

  async function performDelete(item: ProviderService) {
    setSavingId(item.id);
    setError('');
    try {
      const { error: deleteError } = await supabase
        .from('provider_services')
        .delete()
        .eq('id', item.id)
        .eq('provider_id', provider?.id);
      if (deleteError) throw deleteError;
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch {
      setError(copy.error);
    } finally {
      setSavingId(null);
    }
  }

  const activeCatalog = catalog.filter(
    (service) => !items.some((item) => item.service_id === service.id),
  );
  const previewItem = items.find((item) => item.id === previewId) ?? null;
  const previewService = previewItem
    ? catalog.find((service) => service.id === previewItem.service_id)
    : null;
  const previewImageUrl =
    previewItem?.image_path &&
    supabase.storage.from('service-images').getPublicUrl(previewItem.image_path).data.publicUrl;
  const previewCurrency = previewItem
    ? currencies.find((currency) => currency.id === previewItem.currency_id)
    : null;

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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>{getTranslations(language).brand}</Text>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void loadServices()}>
              <Text style={styles.link}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
            <Text style={styles.muted}>{copy.loading}</Text>
          </View>
        ) : !items.length ? (
          <View style={styles.card}>
            <Text style={styles.muted}>{copy.noServices}</Text>
          </View>
        ) : (
          items.map((item) => {
            const busy = savingId === item.id || imageId === item.id;
            const catalogService = catalog.find((service) => service.id === item.service_id);
            const photoUrl = item.image_path
              ? supabase.storage.from('service-images').getPublicUrl(item.image_path).data.publicUrl
              : null;
            return (
              <View key={item.id} style={styles.card}>
                <Text style={styles.serviceName}>{catalogService?.name ?? item.title}</Text>
                {catalogService?.profession_name ? (
                  <Text style={styles.hint}>{catalogService.profession_name}</Text>
                ) : null}
                <Text style={styles.label}>{copy.editTitle}</Text>
                <TextInput
                  style={styles.input}
                  value={item.title}
                  onChangeText={(value) => updateDraft(item.id, { title: value })}
                  maxLength={200}
                />
                <Text style={styles.label}>{copy.description}</Text>
                <TextInput
                  style={[styles.input, styles.multiline]}
                  value={item.description}
                  onChangeText={(value) => updateDraft(item.id, { description: value })}
                  placeholder={copy.descriptionPlaceholder}
                  multiline
                  maxLength={5000}
                  textAlignVertical="top"
                />
                <Text style={styles.label}>{copy.optionalPrice}</Text>
                <TextInput
                  style={styles.input}
                  value={item.price}
                  onChangeText={(value) => updateDraft(item.id, { price: value })}
                  placeholder={copy.pricePlaceholder}
                  keyboardType="decimal-pad"
                />
                {item.price.trim() ? (
                  <>
                    <Text style={styles.label}>{copy.currency}</Text>
                    <View style={styles.currencyList}>
                      {currencies.map((currency) => (
                        <Pressable
                          key={currency.id}
                          style={[
                            styles.currencyOption,
                            item.currency_id === currency.id && styles.currencySelected,
                          ]}
                          onPress={() => updateDraft(item.id, { currency_id: currency.id })}
                        >
                          <Text
                            style={[
                              styles.currencyText,
                              item.currency_id === currency.id && styles.currencyTextSelected,
                            ]}
                          >
                            {currency.code}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : (
                  <Text style={styles.hint}>{copy.negotiable}</Text>
                )}
                <Text style={styles.label}>{copy.estimatedDuration}</Text>
                <TextInput
                  style={styles.input}
                  value={item.estimated_duration_minutes}
                  onChangeText={(value) =>
                    updateDraft(item.id, {
                      estimated_duration_minutes: value.replace(/\D/g, '').slice(0, 5),
                    })
                  }
                  placeholder={copy.durationPlaceholder}
                  keyboardType="number-pad"
                  accessibilityLabel={copy.estimatedDuration}
                />
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.serviceImage} />
                ) : (
                  <Text style={styles.muted}>{copy.noImage}</Text>
                )}
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void chooseImage(item)}
                  disabled={busy || !item.is_active}
                >
                  {imageId === item.id ? (
                    <ActivityIndicator color="#16804A" />
                  ) : (
                    <Text style={styles.secondaryButtonText}>{copy.chooseImage}</Text>
                  )}
                </Pressable>
                {!item.is_active ? (
                  <Text style={styles.hint}>{copy.activateBeforeImage}</Text>
                ) : null}
                {item.image_path ? (
                  <>
                    <Pressable
                      style={styles.textButton}
                      onPress={() => void removeImage(item)}
                      disabled={busy}
                    >
                      <Text style={styles.dangerText}>{copy.removeImage}</Text>
                    </Pressable>
                    <Text style={styles.hint}>{copy.removeImageBeforeDelete}</Text>
                  </>
                ) : null}
                <Pressable
                  style={[styles.primaryButton, busy && styles.disabled]}
                  onPress={() => void saveService(item)}
                  disabled={busy}
                >
                  {savingId === item.id ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>{copy.save}</Text>
                  )}
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => setPreviewId(item.id)}
                  disabled={busy}
                >
                  <Text style={styles.secondaryButtonText}>{copy.preview}</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void toggleActive(item)}
                  disabled={busy}
                >
                  <Text style={styles.secondaryButtonText}>
                    {item.is_active ? copy.deactivate : copy.activate}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.textButton}
                  onPress={() => deleteService(item)}
                  disabled={busy || Boolean(item.image_path)}
                >
                  <Text style={[styles.dangerText, item.image_path && styles.disabledText]}>
                    {copy.delete}
                  </Text>
                </Pressable>
              </View>
            );
          })
        )}

        <Text style={styles.sectionTitle}>{copy.addService}</Text>
        {activeCatalog.length ? (
          activeCatalog.map((service) => (
            <View key={service.id} style={styles.catalogRow}>
              <View style={styles.catalogText}>
                <Text style={styles.serviceName}>{service.name}</Text>
                <Text style={styles.hint}>{service.profession_name}</Text>
                {service.description ? (
                  <Text style={styles.muted}>{service.description}</Text>
                ) : null}
              </View>
              <Pressable
                style={[styles.addButton, savingId === service.id && styles.disabled]}
                onPress={() => void addService(service)}
                disabled={savingId === service.id}
              >
                {savingId === service.id ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>+</Text>
                )}
              </Pressable>
            </View>
          ))
        ) : (
          <Text style={styles.muted}>{copy.noCatalogServices}</Text>
        )}
      </ScrollView>
      <Modal
        visible={previewItem !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewId(null)}
      >
        <View style={styles.previewOverlay}>
          <View style={styles.previewCard}>
            {previewItem ? (
              <>
                <Text style={styles.previewTitle}>{previewItem.title.trim()}</Text>
                {previewService?.profession_name ? (
                  <Text style={styles.hint}>{previewService.profession_name}</Text>
                ) : null}
                {previewImageUrl ? (
                  <Image source={{ uri: previewImageUrl }} style={styles.serviceImage} />
                ) : null}
                <Text style={styles.previewDescription}>
                  {previewItem.description.trim() || copy.descriptionPlaceholder}
                </Text>
                <Text style={styles.hint}>
                  {previewItem.price.trim()
                    ? `${copy.startingFrom} ${previewItem.price} ${previewCurrency?.code ?? ''}`.trim()
                    : copy.negotiable}
                </Text>
              </>
            ) : null}
            <Pressable style={styles.primaryButton} onPress={() => setPreviewId(null)}>
              <Text style={styles.primaryButtonText}>{copy.closePreview}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  sectionTitle: {
    color: '#15251A',
    fontSize: 19,
    fontWeight: '900',
    marginTop: 22,
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 15,
    padding: 16,
    marginBottom: 13,
  },
  serviceName: { color: '#15251A', fontSize: 16, fontWeight: '900' },
  label: { color: '#16804A', fontSize: 12, fontWeight: '800', marginTop: 13, marginBottom: 6 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 9,
    paddingHorizontal: 11,
    color: '#15251A',
    backgroundColor: '#FFFFFF',
  },
  multiline: { minHeight: 82, paddingTop: 11 },
  hint: { color: '#66736A', fontSize: 12, lineHeight: 18, marginTop: 6 },
  currencyList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 },
  currencyOption: { borderWidth: 1, borderColor: '#DDE7DF', borderRadius: 15, padding: 8 },
  currencySelected: { backgroundColor: '#EAF6EE', borderColor: '#16804A' },
  currencyText: { color: '#536358', fontSize: 12, fontWeight: '700' },
  currencyTextSelected: { color: '#16804A' },
  serviceImage: { width: '100%', height: 190, borderRadius: 11, marginTop: 12 },
  previewOverlay: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    padding: 20,
  },
  previewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 15,
    padding: 18,
  },
  previewTitle: { color: '#15251A', fontSize: 20, fontWeight: '900' },
  previewDescription: { color: '#536358', fontSize: 14, lineHeight: 21, marginTop: 12 },
  primaryButton: {
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: '#16804A',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  secondaryButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 9,
  },
  secondaryButtonText: { color: '#16804A', fontSize: 12, fontWeight: '800' },
  textButton: { alignSelf: 'flex-start', paddingVertical: 12, paddingHorizontal: 8 },
  dangerText: { color: '#A12A2A', fontSize: 12, fontWeight: '800' },
  disabledText: { opacity: 0.45 },
  disabled: { opacity: 0.6 },
  catalogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 12,
    padding: 13,
    marginBottom: 8,
  },
  catalogText: { flex: 1 },
  addButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#16804A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  muted: { color: '#66736A', fontSize: 13, lineHeight: 19, marginTop: 5 },
  notice: { color: '#16804A', marginBottom: 10, fontWeight: '700' },
  errorCard: { backgroundColor: '#FCECEC', borderRadius: 11, padding: 13, marginBottom: 12 },
  errorText: { color: '#8E2525', lineHeight: 20 },
  link: { color: '#16804A', fontWeight: '800', marginTop: 8 },
  center: { paddingVertical: 45, alignItems: 'center' },
});
