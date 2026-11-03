import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { getTranslations } from '../lib/translations';
import { usePersistentLanguage } from '../lib/usePersistentLanguage';

type ServiceCategory = { id: string; name: string };

function categoryIcon(name: string) {
  const value = name.toLowerCase();
  if (value.includes('beauty') || value.includes('barber') || value.includes('hair')) return '✂️';
  if (value.includes('transport') || value.includes('taxi')) return '🚕';
  if (value.includes('clean')) return '🧹';
  if (value.includes('construction') || value.includes('carpenter')) return '🪚';
  if (value.includes('electr')) return '💡';
  if (value.includes('plumb')) return '🔧';
  return '✦';
}

export default function HomeScreen() {
  const params = useLocalSearchParams<{ language?: string | string[] }>();
  const [language] = usePersistentLanguage(params.language);
  const copy = getTranslations(language).providerDiscovery;
  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState('');

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    setCategoriesError('');
    try {
      const { data, error } = await supabase
        .from('service_categories')
        .select('id, name')
        .eq('is_active', true)
        .order('name')
        .limit(500);
      if (error) throw error;
      setCategories((data ?? []) as ServiceCategory[]);
    } catch (error) {
      console.error('Unable to load marketplace categories', error);
      setCategoriesError(copy.loadError);
    } finally {
      setCategoriesLoading(false);
    }
  }, [copy.loadError]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadCategories();
    });
    return () => {
      active = false;
    };
  }, [loadCategories]);

  const filteredCategories = useMemo(
    () =>
      categories.filter((category) => category.name.toLowerCase().includes(search.toLowerCase())),
    [categories, search],
  );

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>
              NSOMEX <Text style={styles.brandAccent}>CONNECT</Text>
            </Text>
            <Text style={styles.tagline}>Your world of trusted services</Text>
          </View>
          <TouchableOpacity style={styles.profileButton} onPress={() => router.push('/join')}>
            <Text style={styles.profileLetter}>N</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroPill}>
            <View style={styles.heroDot} />
            <Text style={styles.heroEyebrow}>CONNECTING YOU TO PROFESSIONALS</Text>
          </View>

          <Text style={styles.heroTitle}>
            Find the right help. <Text style={styles.heroHighlight}>Get it done.</Text>
          </Text>

          <Text style={styles.heroSubtitle}>
            Discover skilled professionals and businesses for everyday services, all in one place.
          </Text>

          <View style={styles.searchBox}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="What service do you need?"
              placeholderTextColor="#8995A5"
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
            />
            <TouchableOpacity
              style={styles.searchButton}
              onPress={() =>
                router.push({
                  pathname: '/providers',
                  params: { search: search.trim(), language },
                })
              }
            >
              <Text style={styles.searchButtonText}>Go</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.heroFootnote}>Simple • Convenient • Connected</Text>
        </View>

        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.primaryAction}
            activeOpacity={0.85}
            onPress={() => router.push('/bookings/new')}
          >
            <Text style={styles.actionIcon}>＋</Text>
            <View style={styles.actionCopy}>
              <Text style={styles.primaryActionTitle}>Book a service</Text>
              <Text style={styles.primaryActionText}>Find help for your needs</Text>
            </View>
            <Text style={styles.actionArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryAction}
            activeOpacity={0.85}
            onPress={() => router.push('/bookings')}
          >
            <Text style={styles.secondaryIcon}>▤</Text>
            <Text style={styles.secondaryTitle}>My bookings</Text>
            <Text style={styles.secondaryText}>Track your requests</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Explore services</Text>
            <Text style={styles.sectionSubtitle}>What can we help you with today?</Text>
          </View>
          <Text style={styles.sectionCount}>
            {categories.length} {copy.categoryCount}
          </Text>
        </View>

        {categoriesLoading ? (
          <View style={styles.categoriesState}>
            <ActivityIndicator color="#16804A" />
            <Text style={styles.categoryStateText}>{copy.loadingFilters}</Text>
          </View>
        ) : categoriesError ? (
          <View style={styles.categoriesState}>
            <Text style={styles.categoryStateText}>{categoriesError}</Text>
            <TouchableOpacity onPress={() => void loadCategories()}>
              <Text style={styles.categoryRetry}>{copy.retry}</Text>
            </TouchableOpacity>
          </View>
        ) : filteredCategories.length ? (
          <View style={styles.categoryGrid}>
            {filteredCategories.map((category) => (
              <TouchableOpacity
                key={category.id}
                style={styles.categoryCard}
                activeOpacity={0.8}
                onPress={() =>
                  router.push({
                    pathname: '/providers',
                    params: { categoryId: category.id, language },
                  })
                }
              >
                <View style={styles.categoryIcon}>
                  <Text style={styles.categoryEmoji}>{categoryIcon(category.name)}</Text>
                </View>
                <Text style={styles.categoryName}>{category.name}</Text>
                <Text style={styles.categoryArrow}>↗</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.categoriesState}>
            <Text style={styles.categoryStateText}>{copy.noCategories}</Text>
          </View>
        )}

        <View style={styles.featuredHeader}>
          <View>
            <Text style={styles.sectionTitle}>{copy.results}</Text>
            <Text style={styles.sectionSubtitle}>{copy.subtitle}</Text>
          </View>
          <View style={styles.verifiedPill}>
            <Text style={styles.verifiedPillText}>✓ {copy.verified}</Text>
          </View>
        </View>

        <View style={styles.emptyProviders}>
          <View style={styles.emptyIllustration}>
            <Text style={styles.emptyIcon}>♙</Text>
          </View>
          <Text style={styles.emptyTitle}>{copy.verifiedOnly}</Text>
          <TouchableOpacity
            style={styles.outlineButton}
            onPress={() => router.push({ pathname: '/providers', params: { language } })}
          >
            <Text style={styles.outlineButtonText}>{copy.browseProviders} →</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.joinCard}>
          <View style={styles.joinTextArea}>
            <Text style={styles.joinEyebrow}>GROW WITH NSOMEX</Text>
            <Text style={styles.joinTitle}>Are you a professional?</Text>
            <Text style={styles.joinDescription}>
              Join our growing service marketplace. Register as an individual or a business and
              connect with customers.
            </Text>
            <TouchableOpacity
              style={styles.joinButton}
              onPress={() => router.push('/join')}
              activeOpacity={0.85}
            >
              <Text style={styles.joinButtonText}>Register as a provider →</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.joinIllustration}>✦</Text>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerBrand}>NSOMEX CONNECT</Text>
          <Text style={styles.footerText}>Connect. Book. Get It Done.</Text>
          <Text style={styles.footerCopyright}>A service marketplace by NSOMEX Technologies</Text>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.tab} onPress={() => router.replace('/')}>
          <Text style={styles.activeTabIcon}>⌂</Text>
          <Text style={styles.activeTabLabel}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tab}
          onPress={() => router.push({ pathname: '/providers', params: { language } })}
        >
          <Text style={styles.tabIcon}>▦</Text>
          <Text style={styles.tabLabel}>Services</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tab} onPress={() => router.push('/bookings')}>
          <Text style={styles.tabIcon}>▤</Text>
          <Text style={styles.tabLabel}>Bookings</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tab} onPress={() => router.push('/join')}>
          <Text style={styles.tabIcon}>♙</Text>
          <Text style={styles.tabLabel}>Join us</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F6FA' },
  scrollContent: { paddingBottom: 24 },
  header: {
    backgroundColor: '#092C59',
    paddingTop: 55,
    paddingHorizontal: 21,
    paddingBottom: 19,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  brandAccent: { color: '#FFC928' },
  tagline: { color: '#C6D6E9', fontSize: 11, marginTop: 5 },
  profileButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFC928',
  },
  profileLetter: { color: '#092C59', fontWeight: '900', fontSize: 18 },
  hero: {
    backgroundColor: '#0B376D',
    paddingHorizontal: 21,
    paddingTop: 27,
    paddingBottom: 25,
    borderBottomLeftRadius: 25,
    borderBottomRightRadius: 25,
  },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#174A80',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  heroDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFC928', marginRight: 7 },
  heroEyebrow: { color: '#E5EFFA', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  heroTitle: { color: '#FFFFFF', fontSize: 31, lineHeight: 38, fontWeight: '900', marginTop: 17 },
  heroHighlight: { color: '#FFC928' },
  heroSubtitle: { color: '#D4E1F0', fontSize: 13, lineHeight: 21, marginTop: 10, maxWidth: 310 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 13,
    paddingLeft: 13,
    paddingRight: 5,
    marginTop: 22,
    minHeight: 53,
  },
  searchIcon: { fontSize: 25, color: '#64758A', marginRight: 8 },
  searchInput: { flex: 1, height: 49, color: '#142A43', fontSize: 13 },
  searchButton: {
    backgroundColor: '#FFC928',
    borderRadius: 10,
    paddingHorizontal: 17,
    paddingVertical: 11,
  },
  searchButtonText: { color: '#092C59', fontWeight: '900', fontSize: 13 },
  heroFootnote: { color: '#C4D6E9', fontSize: 10, marginTop: 13, letterSpacing: 0.5 },
  quickActions: { flexDirection: 'row', gap: 11, paddingHorizontal: 19, marginTop: 18 },
  primaryAction: {
    flex: 1.15,
    backgroundColor: '#FFC928',
    borderRadius: 15,
    padding: 14,
    minHeight: 104,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionIcon: { fontSize: 27, color: '#092C59', fontWeight: '500', marginRight: 9 },
  actionCopy: { flex: 1 },
  primaryActionTitle: { color: '#092C59', fontWeight: '900', fontSize: 13 },
  primaryActionText: { color: '#38516D', fontSize: 10, marginTop: 5 },
  actionArrow: { color: '#092C59', fontSize: 23, marginLeft: 3 },
  secondaryAction: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 15,
    padding: 13,
    minHeight: 104,
    borderWidth: 1,
    borderColor: '#E1E8F0',
  },
  secondaryIcon: { color: '#0B4A87', fontSize: 23, marginBottom: 5 },
  secondaryTitle: { color: '#142A43', fontWeight: '900', fontSize: 13 },
  secondaryText: { color: '#718096', fontSize: 10, marginTop: 5 },
  sectionHeader: {
    marginHorizontal: 20,
    marginTop: 27,
    marginBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: { color: '#142A43', fontSize: 18, fontWeight: '900' },
  sectionSubtitle: { color: '#718096', fontSize: 11, marginTop: 5 },
  sectionCount: { color: '#718096', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 14 },
  categoriesState: {
    minHeight: 88,
    marginHorizontal: 20,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryStateText: { color: '#66736A', fontSize: 12, textAlign: 'center', marginTop: 6 },
  categoryRetry: { color: '#16804A', fontWeight: '800', fontSize: 12, marginTop: 8 },
  categoryCard: {
    width: '46%',
    marginHorizontal: '2%',
    marginBottom: 11,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 13,
    minHeight: 101,
    borderWidth: 1,
    borderColor: '#E5EAF1',
  },
  categoryIcon: {
    width: 39,
    height: 39,
    borderRadius: 12,
    backgroundColor: '#EAF1FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryEmoji: { fontSize: 21 },
  categoryName: { color: '#142A43', fontSize: 13, fontWeight: '800', marginTop: 9 },
  categoryArrow: { position: 'absolute', right: 13, bottom: 12, color: '#0B4A87', fontSize: 17 },
  featuredHeader: {
    marginHorizontal: 20,
    marginTop: 18,
    marginBottom: 13,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  verifiedPill: {
    backgroundColor: '#E6F4EC',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 20,
  },
  verifiedPillText: { color: '#247448', fontSize: 9, fontWeight: '900' },
  emptyProviders: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 20,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E3EAF2',
    alignItems: 'center',
  },
  emptyIllustration: {
    width: 55,
    height: 55,
    borderRadius: 28,
    backgroundColor: '#EAF1FA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 11,
  },
  emptyIcon: { color: '#0B4A87', fontSize: 30 },
  emptyTitle: { color: '#142A43', fontSize: 15, fontWeight: '900' },
  emptyText: { color: '#718096', fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  outlineButton: {
    borderWidth: 1,
    borderColor: '#0B4A87',
    borderRadius: 9,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginTop: 14,
  },
  outlineButtonText: { color: '#0B4A87', fontSize: 11, fontWeight: '900' },
  joinCard: {
    marginHorizontal: 20,
    marginTop: 19,
    borderRadius: 17,
    backgroundColor: '#092C59',
    padding: 19,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  joinTextArea: { flex: 1 },
  joinEyebrow: { color: '#FFC928', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  joinTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '900', marginTop: 8 },
  joinDescription: { color: '#D0DCEC', fontSize: 11, lineHeight: 18, marginTop: 7 },
  joinButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFC928',
    borderRadius: 9,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginTop: 14,
  },
  joinButtonText: { color: '#092C59', fontSize: 11, fontWeight: '900' },
  joinIllustration: { color: '#FFC928', fontSize: 48, marginLeft: 5, marginTop: 3 },
  footer: { alignItems: 'center', paddingHorizontal: 20, marginTop: 26, marginBottom: 10 },
  footerBrand: { color: '#0B376D', fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  footerText: { color: '#718096', fontSize: 11, marginTop: 5 },
  footerCopyright: { color: '#9AA6B5', fontSize: 9, marginTop: 7 },
  bottomBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5EAF1',
    paddingTop: 9,
    paddingBottom: 17,
    justifyContent: 'space-around',
  },
  tab: { alignItems: 'center', justifyContent: 'center', minWidth: 62 },
  activeTabIcon: { color: '#0B4A87', fontSize: 22, fontWeight: '900' },
  activeTabLabel: { color: '#0B4A87', fontSize: 10, fontWeight: '900', marginTop: 3 },
  tabIcon: { color: '#8794A5', fontSize: 21 },
  tabLabel: { color: '#8794A5', fontSize: 10, marginTop: 3 },
});
