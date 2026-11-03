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
import { usePersistentLanguage } from '../../lib/usePersistentLanguage';

type PortfolioItem = {
  id: string;
  storage_path: string;
  mime_type: string;
  caption: string | null;
  created_at: string;
  image_url: string;
};
type PickedImage = DocumentPicker.DocumentPickerAsset;
type ProviderOwner = { id: string; verification_status: string };
const allowedImages = ['image/jpeg', 'image/png', 'image/webp'] as const;
const maxImageSize = 10 * 1024 * 1024;

export default function ProviderPortfolioScreen() {
  const params = useLocalSearchParams<{ language?: string | string[] }>();
  const languageParam = Array.isArray(params.language) ? params.language[0] : params.language;
  const [language, setLanguage] = usePersistentLanguage(languageParam);
  const copy = getTranslations(language).providerPortfolio;
  const [provider, setProvider] = useState<ProviderOwner | null>(null);
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [pickedImage, setPickedImage] = useState<PickedImage | null>(null);
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadPortfolio = useCallback(async () => {
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
        throw new Error(copy.verifiedRequired);
      }

      const { data, error: queryError } = await supabase
        .from('provider_portfolio_items')
        .select('id, storage_path, mime_type, caption, created_at')
        .eq('provider_id', providerData.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (queryError) throw queryError;

      const signedResults = await Promise.all(
        (data ?? []).map(async (item) => {
          const { data: signedData, error: signedError } = await supabase.storage
            .from('provider-portfolio')
            .createSignedUrl(item.storage_path, 15 * 60);
          if (signedError) return { id: item.id, error: signedError.message };
          return {
            ...item,
            image_url: signedData.signedUrl,
          } satisfies PortfolioItem;
        }),
      );
      const failures = signedResults.filter((item) => 'error' in item);
      if (failures.length) {
        throw new Error(failures.map((item) => item.error).join('. '));
      }

      setProvider(providerData as ProviderOwner);
      setItems(signedResults.filter((item): item is PortfolioItem => 'image_url' in item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.error);
    } finally {
      setLoading(false);
    }
  }, [copy.error, copy.signInRequired, copy.verifiedRequired]);

  useFocusEffect(
    useCallback(() => {
      void loadPortfolio();
    }, [loadPortfolio]),
  );

  async function chooseImage() {
    setError('');
    setNotice('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...allowedImages],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const image = result.assets[0];
      if (
        !image ||
        !allowedImages.includes(image.mimeType as (typeof allowedImages)[number]) ||
        (image.size !== undefined && image.size > maxImageSize)
      ) {
        throw new Error(copy.imageError);
      }
      setPickedImage(image);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.imageError);
    }
  }

  async function uploadImage() {
    if (!provider || !pickedImage || uploading) return;
    setUploading(true);
    setError('');
    setNotice('');
    let uploadedPath: string | null = null;
    try {
      const response = await fetch(pickedImage.uri);
      if (!response.ok) throw new Error(copy.imageError);
      const fileData = await response.arrayBuffer();
      if (fileData.byteLength === 0 || fileData.byteLength > maxImageSize) {
        throw new Error(copy.imageError);
      }
      const extension =
        pickedImage.mimeType === 'image/png'
          ? 'png'
          : pickedImage.mimeType === 'image/webp'
            ? 'webp'
            : 'jpg';
      const uniqueName = `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2)}.${extension}`;
      uploadedPath = `${provider.id}/${uniqueName}`;

      const { error: uploadError } = await supabase.storage
        .from('provider-portfolio')
        .upload(uploadedPath, fileData, {
          contentType: pickedImage.mimeType ?? undefined,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { error: metadataError } = await supabase.from('provider_portfolio_items').insert({
        provider_id: provider.id,
        storage_path: uploadedPath,
        mime_type: pickedImage.mimeType,
        caption: caption.trim() || null,
        is_published: true,
      });
      if (metadataError) throw metadataError;

      setPickedImage(null);
      setCaption('');
      setNotice(copy.success);
      await loadPortfolio();
    } catch (reason) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage
          .from('provider-portfolio')
          .remove([uploadedPath]);
        if (cleanupError) {
          setError(
            `${reason instanceof Error ? reason.message : copy.error} ${cleanupError.message}`,
          );
          return;
        }
      }
      setError(reason instanceof Error ? reason.message : copy.error);
    } finally {
      setUploading(false);
    }
  }

  async function removeItem(item: PortfolioItem) {
    setDeletingId(item.id);
    setError('');
    setNotice('');
    try {
      const { error: storageError } = await supabase.storage
        .from('provider-portfolio')
        .remove([item.storage_path]);
      if (storageError) throw storageError;
      const { error: metadataError } = await supabase
        .from('provider_portfolio_items')
        .delete()
        .eq('id', item.id)
        .eq('provider_id', provider?.id);
      if (metadataError) throw metadataError;
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.error);
    } finally {
      setDeletingId(null);
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
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
            <Text style={styles.muted}>{copy.loading}</Text>
          </View>
        ) : !provider ? (
          <View style={styles.card}>
            <Text style={styles.errorText}>{error || copy.verifiedRequired}</Text>
            <Pressable style={styles.secondaryButton} onPress={() => void loadPortfolio()}>
              <Text style={styles.secondaryButtonText}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Pressable style={styles.secondaryButton} onPress={() => void chooseImage()}>
                <Text style={styles.secondaryButtonText}>{copy.chooseImage}</Text>
              </Pressable>
              {pickedImage ? (
                <View style={styles.selectedImage}>
                  <Image source={{ uri: pickedImage.uri }} style={styles.preview} />
                  <Text style={styles.filename}>{pickedImage.name}</Text>
                </View>
              ) : null}
              <Text style={styles.label}>{copy.caption}</Text>
              <TextInput
                style={styles.input}
                placeholder={copy.captionPlaceholder}
                placeholderTextColor="#89958A"
                value={caption}
                onChangeText={setCaption}
                maxLength={500}
              />
              <Pressable
                style={[styles.primaryButton, (!pickedImage || uploading) && styles.disabled]}
                onPress={() => void uploadImage()}
                disabled={!pickedImage || uploading}
              >
                {uploading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>{copy.upload}</Text>
                )}
              </Pressable>
            </View>
            {notice ? <Text style={styles.successText}>{notice}</Text> : null}
            {error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
                <Pressable onPress={() => void loadPortfolio()}>
                  <Text style={styles.retry}>{copy.retry}</Text>
                </Pressable>
              </View>
            ) : null}
            {items.length ? (
              items.map((item) => (
                <View key={item.id} style={styles.itemCard}>
                  <Image source={{ uri: item.image_url }} style={styles.image} />
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemCaption}>
                      {item.caption || item.storage_path.split('/').pop()}
                    </Text>
                    <Pressable
                      onPress={() => void removeItem(item)}
                      disabled={deletingId === item.id}
                    >
                      {deletingId === item.id ? (
                        <ActivityIndicator color="#A12A2A" />
                      ) : (
                        <Text style={styles.removeText}>{copy.remove}</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.empty}>
                <Text style={styles.muted}>{copy.noItems}</Text>
              </View>
            )}
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
  title: { color: '#15251A', fontSize: 26, fontWeight: '900' },
  subtitle: { color: '#66736A', fontSize: 13, lineHeight: 20, marginTop: 6, marginBottom: 14 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 14,
    padding: 14,
    marginBottom: 13,
  },
  secondaryButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginTop: 8,
  },
  secondaryButtonText: { color: '#16804A', fontSize: 12, fontWeight: '800' },
  selectedImage: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  preview: { width: 58, height: 58, borderRadius: 8, backgroundColor: '#EAF6EE' },
  filename: { flex: 1, color: '#536358', fontSize: 12 },
  label: { color: '#16804A', fontSize: 12, fontWeight: '800', marginTop: 14, marginBottom: 6 },
  input: {
    minHeight: 45,
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 9,
    paddingHorizontal: 11,
    color: '#15251A',
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: '#16804A',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 13,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.6 },
  itemCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 13,
    padding: 10,
    marginBottom: 10,
  },
  image: { width: 88, height: 88, borderRadius: 9, backgroundColor: '#EAF6EE' },
  itemInfo: { flex: 1, justifyContent: 'space-between', paddingLeft: 11, paddingVertical: 3 },
  itemCaption: { color: '#26362B', fontSize: 12, lineHeight: 17 },
  removeText: { color: '#A12A2A', fontSize: 12, fontWeight: '800' },
  successText: { color: '#16804A', fontWeight: '700', marginBottom: 10 },
  errorBanner: { backgroundColor: '#FCECEC', borderRadius: 10, padding: 12, marginBottom: 12 },
  errorText: { color: '#8E2525', lineHeight: 20 },
  retry: { color: '#16804A', fontWeight: '800', marginTop: 8 },
  empty: { alignItems: 'center', backgroundColor: '#FFFFFF', padding: 20, borderRadius: 12 },
  muted: { color: '#66736A', fontSize: 13, lineHeight: 20 },
  center: { paddingVertical: 48, alignItems: 'center' },
});
