import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, router, type Href } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { getTranslations, type Language } from '../../lib/translations';

type Profession = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
};

type Service = {
  id: string;
  name: string;
  description?: string | null;
};

export default function ServiceScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [language, setLanguage] = useState<Language>('en');
  const copy = getTranslations(language).customerRequests;
  const [profession, setProfession] = useState<Profession | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadService() {
      if (!slug) return;

      setLoading(true);
      setError('');

      try {
        const { data: professionData, error: professionError } = await supabase
          .from('professions')
          .select('*')
          .eq('slug', slug)
          .maybeSingle();

        if (professionError) throw professionError;

        if (!professionData) {
          if (active) setError('This profession was not found.');
          return;
        }

        if (active) setProfession(professionData as Profession);

        const { data: serviceData, error: serviceError } = await supabase
          .from('services')
          .select('*')
          .eq('profession_id', professionData.id)
          .eq('is_active', true);

        if (serviceError) throw serviceError;

        if (active) setServices((serviceData ?? []) as Service[]);
      } catch (e) {
        if (active) {
          setError(
            e instanceof Error ? e.message : 'Unable to load this service. Please try again.',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadService();

    return () => {
      active = false;
    };
  }, [slug]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <View style={styles.headerRow}>
          <Text style={styles.brand}>NSOMEX CONNECT</Text>
          <View style={styles.languageOptions}>
            {(['en', 'fr'] as const).map((option) => (
              <Pressable
                key={option}
                onPress={() => setLanguage(option)}
                style={[styles.languageOption, language === option && styles.languageOptionActive]}
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
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
            <Text style={styles.muted}>Loading service...</Text>
          </View>
        ) : error ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Unable to load service</Text>
            <Text style={styles.muted}>{error}</Text>
            <Text style={styles.hint}>
              Check that your Supabase configuration is set and the database migrations have been
              applied.
            </Text>
          </View>
        ) : profession ? (
          <>
            <Text style={styles.eyebrow}>FIND A PROFESSIONAL</Text>
            <Text style={styles.title}>{profession.name}</Text>
            <Text style={styles.subtitle}>
              Explore services offered by {profession.name.toLowerCase()}s.
            </Text>

            <Text style={styles.sectionTitle}>Available services</Text>

            {services.length > 0 ? (
              services.map((service) => (
                <View key={service.id} style={styles.serviceCard}>
                  <View style={styles.serviceIcon}>
                    <Text style={styles.iconText}>✓</Text>
                  </View>
                  <View style={styles.serviceInfo}>
                    <Text style={styles.serviceName}>{service.name}</Text>
                    {service.description ? (
                      <Text style={styles.muted}>{service.description}</Text>
                    ) : null}
                    <Pressable
                      style={styles.requestButton}
                      onPress={() =>
                        router.push({
                          pathname: '/bookings/new',
                          params: { serviceId: service.id, language },
                        } as Href)
                      }
                    >
                      <Text style={styles.requestButtonText}>{copy.startRequest}</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.notice}>
                <Text style={styles.noticeTitle}>No services listed yet</Text>
                <Text style={styles.muted}>
                  Services will appear here when they are available in the database.
                </Text>
              </View>
            )}

            <Pressable
              style={styles.providerButton}
              onPress={() =>
                router.push({
                  pathname: '/providers',
                  params: { professionId: profession.id, language },
                } as Href)
              }
            >
              <Text style={styles.providerButtonText}>
                {getTranslations(language).providerDiscovery.browseProviders}
              </Text>
            </Pressable>
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
    paddingBottom: 18,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5ECE6',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  backButton: { marginBottom: 14, alignSelf: 'flex-start' },
  backText: { color: '#16804A', fontSize: 16, fontWeight: '600' },
  brand: { color: '#16804A', fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  content: { padding: 20, paddingBottom: 40 },
  eyebrow: { color: '#16804A', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  title: { marginTop: 8, fontSize: 32, fontWeight: '800', color: '#15251A' },
  subtitle: { marginTop: 8, fontSize: 15, lineHeight: 22, color: '#66736A' },
  sectionTitle: {
    marginTop: 30,
    marginBottom: 12,
    fontSize: 19,
    fontWeight: '800',
    color: '#15251A',
  },
  serviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    marginBottom: 10,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5ECE6',
  },
  serviceIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#E7F5EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  iconText: { color: '#16804A', fontSize: 20, fontWeight: '800' },
  serviceInfo: { flex: 1 },
  requestButton: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: '#16804A',
  },
  requestButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  providerButton: {
    alignSelf: 'flex-start',
    marginTop: 16,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#16804A',
    backgroundColor: '#FFFFFF',
  },
  providerButtonText: { color: '#16804A', fontSize: 13, fontWeight: '800' },
  serviceName: { fontSize: 16, fontWeight: '700', color: '#15251A' },
  notice: {
    marginTop: 16,
    padding: 17,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5ECE6',
  },
  noticeTitle: { fontSize: 16, fontWeight: '800', color: '#15251A', marginBottom: 6 },
  muted: { marginTop: 5, color: '#66736A', fontSize: 14, lineHeight: 21 },
  hint: { marginTop: 10, color: '#8A5A14', fontSize: 13, lineHeight: 19 },
  center: { paddingVertical: 60, alignItems: 'center' },
});
