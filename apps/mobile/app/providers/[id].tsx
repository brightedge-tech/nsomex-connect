import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { getTranslations } from '../../lib/translations';
import { getLocalDateString } from '../../lib/dateTime';
import { usePersistentLanguage } from '../../lib/usePersistentLanguage';

type ProviderProfile = {
  provider_id: string;
  professional_name: string;
  description: string | null;
  years_experience: number;
  availability_status: 'available' | 'unavailable' | 'busy';
  service_mode: string;
  avatar_url: string | null;
  verification_status: 'verified';
};
type ProviderService = {
  id: string;
  service_id: string;
  image_path: string | null;
  name: string;
  description: string | null;
  profession_id: string;
  profession_name: string;
  price: number | null;
  currency_code: string | null;
  price_type: string;
  estimated_duration_minutes: number | null;
};
type Area = {
  city_id: string;
  city_name: string;
  region_name: string;
  country_name: string;
};
type WorkingHour = {
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
type PortfolioItem = {
  id: string;
  storage_path: string;
  caption: string | null;
  image_url: string;
};
type Review = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
};
type ReviewSummary = { review_count: number; average_rating: number | null };
type Cursor = { createdAt: string; id: string };
const reviewPageSize = 10;

export default function ProviderDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[]; language?: string | string[] }>();
  const providerId = Array.isArray(params.id) ? params.id[0] : params.id;
  const languageParam = Array.isArray(params.language) ? params.language[0] : params.language;
  const [language, setLanguage] = usePersistentLanguage(languageParam);
  const copy = getTranslations(language).providerDetail;
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [services, setServices] = useState<ProviderService[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [hours, setHours] = useState<WorkingHour[]>([]);
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary | null>(null);
  const [reviewCursor, setReviewCursor] = useState<Cursor | null>(null);
  const [hasMoreReviews, setHasMoreReviews] = useState(false);
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [portfolioError, setPortfolioError] = useState(false);

  const loadProvider = useCallback(async () => {
    setLoading(true);
    setError('');
    setPortfolioError(false);
    try {
      if (!providerId) throw new Error(copy.loadError);
      const [
        profileResult,
        serviceResult,
        areaResult,
        hoursResult,
        exceptionsResult,
        portfolioResult,
        reviewResult,
        summaryResult,
      ] = await Promise.all([
        supabase
          .from('provider_directory')
          .select(
            'provider_id, professional_name, description, years_experience, availability_status, service_mode, avatar_url, verification_status',
          )
          .eq('provider_id', providerId)
          .maybeSingle(),
        supabase
          .from('provider_services')
          .select(
            'id, service_id, title, image_path, price, price_type, description, estimated_duration_minutes, services(name, description, profession_id, professions(name)), currencies(code)',
          )
          .eq('provider_id', providerId)
          .eq('is_active', true)
          .limit(100),
        supabase
          .from('provider_public_service_areas')
          .select('city_id, city_name, region_name, country_name')
          .eq('provider_id', providerId)
          .order('country_name')
          .order('region_name')
          .order('city_name')
          .limit(100),
        supabase
          .from('provider_availability')
          .select('day_of_week, start_time, end_time')
          .eq('provider_id', providerId)
          .eq('is_available', true)
          .order('day_of_week')
          .order('start_time')
          .limit(100),
        supabase
          .from('provider_availability_exceptions')
          .select('id, exception_date, is_available, start_time, end_time, reason')
          .eq('provider_id', providerId)
          .gte('exception_date', getLocalDateString())
          .order('exception_date')
          .limit(100),
        supabase
          .from('provider_portfolio_items')
          .select('id, storage_path, caption')
          .eq('provider_id', providerId)
          .eq('is_published', true)
          .order('created_at', { ascending: false })
          .limit(12),
        supabase
          .from('provider_public_reviews')
          .select('id, rating, comment, created_at')
          .eq('provider_id', providerId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(reviewPageSize + 1),
        supabase.rpc('provider_public_review_summary', { p_provider_id: providerId }),
      ]);

      if (profileResult.error) throw profileResult.error;
      if (serviceResult.error) throw serviceResult.error;
      if (areaResult.error) throw areaResult.error;
      if (hoursResult.error) throw hoursResult.error;
      if (exceptionsResult.error) throw exceptionsResult.error;
      if (portfolioResult.error) throw portfolioResult.error;
      if (reviewResult.error) throw reviewResult.error;
      if (summaryResult.error) throw summaryResult.error;
      if (!profileResult.data) throw new Error(copy.loadError);

      const profileData = profileResult.data as ProviderProfile;
      const rawServices = (serviceResult.data ?? []) as Record<string, unknown>[];
      const serviceData: ProviderService[] = rawServices.map((row) => {
        const service = row.services as {
          name: string;
          description: string | null;
          profession_id: string;
          professions: { name: string } | null;
        };
        const currency = row.currencies as { code: string } | null;
        return {
          id: row.id as string,
          service_id: row.service_id as string,
          image_path: row.image_path as string | null,
          name: (row.title as string | null) ?? service.name,
          description: (row.description as string | null) ?? service.description,
          profession_id: service.profession_id,
          profession_name: service.professions?.name ?? '',
          price: row.price as number | null,
          currency_code: currency?.code ?? null,
          price_type: row.price_type as string,
          estimated_duration_minutes: row.estimated_duration_minutes as number | null,
        };
      });

      const rawReviews = (reviewResult.data ?? []) as Review[];
      const hasMore = rawReviews.length > reviewPageSize;
      const firstReviews = rawReviews.slice(0, reviewPageSize);
      const lastReview = firstReviews[firstReviews.length - 1];
      const summaryRow = (summaryResult.data ?? [])[0] as ReviewSummary | undefined;

      const signedPortfolioResults = await Promise.all(
        (portfolioResult.data ?? []).map(async (item) => {
          const { data, error: signedUrlError } = await supabase.storage
            .from('provider-portfolio')
            .createSignedUrl(item.storage_path, 15 * 60);
          if (signedUrlError) return { error: signedUrlError.message };
          return {
            id: item.id,
            storage_path: item.storage_path,
            caption: item.caption,
            image_url: data.signedUrl,
          } satisfies PortfolioItem;
        }),
      );

      setProfile(profileData);
      setServices(serviceData);
      setAreas((areaResult.data ?? []) as Area[]);
      setHours((hoursResult.data ?? []) as WorkingHour[]);
      setExceptions((exceptionsResult.data ?? []) as AvailabilityException[]);
      setPortfolio(
        signedPortfolioResults.filter((item): item is PortfolioItem => 'image_url' in item),
      );
      setPortfolioError(signedPortfolioResults.some((item) => 'error' in item));
      setReviews(firstReviews);
      setReviewSummary(summaryRow ?? { review_count: 0, average_rating: null });
      setHasMoreReviews(hasMore);
      setReviewCursor(
        hasMore && lastReview ? { createdAt: lastReview.created_at, id: lastReview.id } : null,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.loadError);
      setPortfolioError(true);
    } finally {
      setLoading(false);
    }
  }, [copy.loadError, providerId]);

  useFocusEffect(
    useCallback(() => {
      void loadProvider();
    }, [loadProvider]),
  );

  async function loadMoreReviews() {
    if (!providerId || !reviewCursor || loadingMoreReviews) return;
    setLoadingMoreReviews(true);
    try {
      const { data, error: queryError } = await supabase
        .from('provider_public_reviews')
        .select('id, rating, comment, created_at')
        .eq('provider_id', providerId)
        .or(
          `created_at.lt.${reviewCursor.createdAt},and(created_at.eq.${reviewCursor.createdAt},id.lt.${reviewCursor.id})`,
        )
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(reviewPageSize + 1);
      if (queryError) throw queryError;
      const page = (data ?? []) as Review[];
      const more = page.length > reviewPageSize;
      const visible = page.slice(0, reviewPageSize);
      setReviews((current) => [...current, ...visible]);
      setHasMoreReviews(more);
      const last = visible[visible.length - 1];
      setReviewCursor(more && last ? { createdAt: last.created_at, id: last.id } : null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.loadError);
    } finally {
      setLoadingMoreReviews(false);
    }
  }

  function formatReviewDate(value: string) {
    return new Date(value).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function formatTime(value: string) {
    return value.slice(0, 5);
  }

  function formatExceptionDate(value: string) {
    return new Date(`${value}T00:00:00`).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function openRequest(service: ProviderService) {
    router.push({
      pathname: '/bookings/new',
      params: {
        serviceId: service.service_id,
        providerId: profile?.provider_id,
        providerName: profile?.professional_name,
        language,
      },
    } as Href);
  }

  const dayNames = getTranslations(language).providerProfile.days;

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

      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
            <Text style={styles.muted}>{copy.loading}</Text>
          </View>
        ) : error && !profile ? (
          <View style={styles.notice}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void loadProvider()}>
              <Text style={styles.retry}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : profile ? (
          <>
            <View style={styles.profileCard}>
              {profile.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>
                    {profile.professional_name.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={styles.name}>{profile.professional_name}</Text>
              <View style={styles.verifiedBadge}>
                <Text style={styles.verifiedText}>✓ {copy.verified}</Text>
              </View>
              <Text style={styles.status}>
                {profile.availability_status === 'available'
                  ? copy.available
                  : profile.availability_status === 'busy'
                    ? copy.busy
                    : copy.unavailable}
              </Text>
              <Text style={styles.experience}>
                {copy.experience.replace('{years}', String(profile.years_experience))}
              </Text>
              {profile.description ? (
                <Text style={styles.description}>{profile.description}</Text>
              ) : null}
            </View>

            <Section title={copy.professions}>
              {services.some((service) => service.profession_name) ? (
                <Text style={styles.body}>
                  {[
                    ...new Set(services.map((service) => service.profession_name).filter(Boolean)),
                  ].join(' · ')}
                </Text>
              ) : (
                <Text style={styles.muted}>{copy.noServices}</Text>
              )}
            </Section>

            <Section title={copy.serviceAreas}>
              {areas.length ? (
                <View style={styles.chipList}>
                  {[
                    ...new Set(
                      areas.map(
                        (area) => `${area.city_name}, ${area.region_name}, ${area.country_name}`,
                      ),
                    ),
                  ].map((area) => (
                    <Text key={area} style={styles.areaChip}>
                      {area}
                    </Text>
                  ))}
                </View>
              ) : (
                <Text style={styles.muted}>{copy.noAreas}</Text>
              )}
            </Section>

            <Section title={copy.services}>
              {services.length ? (
                services.map((service) => (
                  <View key={service.id} style={styles.serviceCard}>
                    <Text style={styles.serviceName}>{service.name}</Text>
                    {service.profession_name ? (
                      <Text style={styles.smallText}>{service.profession_name}</Text>
                    ) : null}
                    {service.image_path ? (
                      <Image
                        source={{
                          uri: supabase.storage
                            .from('service-images')
                            .getPublicUrl(service.image_path).data.publicUrl,
                        }}
                        style={styles.serviceImage}
                      />
                    ) : null}
                    {service.description ? (
                      <Text style={styles.body}>{service.description}</Text>
                    ) : null}
                    <Text style={styles.smallText}>
                      {service.price === null
                        ? copy.priceNegotiable
                        : `${copy.priceStartingFrom}: ${service.price} ${service.currency_code ?? ''}`}
                    </Text>
                    {service.estimated_duration_minutes ? (
                      <Text style={styles.smallText}>
                        {copy.duration.replace(
                          '{minutes}',
                          String(service.estimated_duration_minutes),
                        )}
                      </Text>
                    ) : null}
                    <Pressable style={styles.requestButton} onPress={() => openRequest(service)}>
                      <Text style={styles.requestButtonText}>{copy.requestService}</Text>
                    </Pressable>
                  </View>
                ))
              ) : (
                <Text style={styles.muted}>{copy.noServices}</Text>
              )}
            </Section>

            <Section title={copy.workingHours}>
              {hours.length ? (
                hours.map((hour, index) => (
                  <View
                    key={`${hour.day_of_week}-${hour.start_time}-${index}`}
                    style={styles.hourRow}
                  >
                    <Text style={styles.hourDay}>{dayNames[hour.day_of_week]}</Text>
                    <Text style={styles.body}>
                      {formatTime(hour.start_time)} – {formatTime(hour.end_time)}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.muted}>{copy.noHours}</Text>
              )}
            </Section>

            <Section title={copy.dateOverrides}>
              {exceptions.length ? (
                exceptions.map((exception) => (
                  <View key={exception.id} style={styles.hourRow}>
                    <Text style={styles.hourDay}>
                      {formatExceptionDate(exception.exception_date)}
                    </Text>
                    <Text style={styles.body}>
                      {exception.is_available
                        ? `${copy.specialHours}: ${formatTime(exception.start_time ?? '')}–${formatTime(exception.end_time ?? '')}`
                        : copy.unavailableDate}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.muted}>{copy.noExceptions}</Text>
              )}
            </Section>

            <Section title={copy.portfolio}>
              {portfolioError ? (
                <Text style={styles.errorText}>{copy.portfolioImageError}</Text>
              ) : portfolio.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.portfolioRow}>
                    {portfolio.map((item) => (
                      <View key={item.id} style={styles.portfolioTile}>
                        <Image source={{ uri: item.image_url }} style={styles.portfolioImage} />
                        {item.caption ? (
                          <Text numberOfLines={2} style={styles.portfolioCaption}>
                            {item.caption}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              ) : (
                <Text style={styles.muted}>{copy.noPortfolio}</Text>
              )}
            </Section>

            <Section
              title={copy.reviews}
              subtitle={
                reviewSummary
                  ? copy.rating
                      .replace(
                        '{rating}',
                        reviewSummary.average_rating === null
                          ? '—'
                          : Number(reviewSummary.average_rating).toFixed(1),
                      )
                      .replace('{count}', String(reviewSummary.review_count))
                  : undefined
              }
            >
              {reviews.length ? (
                reviews.map((review) => (
                  <View key={review.id} style={styles.reviewCard}>
                    <View style={styles.reviewTop}>
                      <Text style={styles.stars}>{'★'.repeat(review.rating)}</Text>
                      <Text style={styles.reviewDate}>{formatReviewDate(review.created_at)}</Text>
                    </View>
                    {review.comment ? <Text style={styles.body}>{review.comment}</Text> : null}
                  </View>
                ))
              ) : (
                <Text style={styles.muted}>{copy.noReviews}</Text>
              )}
              {hasMoreReviews ? (
                <Pressable
                  style={[styles.moreButton, loadingMoreReviews && styles.disabled]}
                  onPress={() => void loadMoreReviews()}
                  disabled={loadingMoreReviews}
                >
                  {loadingMoreReviews ? (
                    <ActivityIndicator color="#16804A" />
                  ) : (
                    <Text style={styles.moreText}>
                      {getTranslations(language).providerDiscovery.loadMore}
                    </Text>
                  )}
                </Pressable>
              ) : null}
            </Section>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      {children}
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
  profileCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 16,
    padding: 20,
  },
  avatar: { width: 92, height: 92, borderRadius: 46, backgroundColor: '#EAF6EE' },
  avatarFallback: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#EAF6EE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: { color: '#16804A', fontSize: 32, fontWeight: '900' },
  name: { color: '#15251A', fontSize: 23, fontWeight: '900', textAlign: 'center', marginTop: 12 },
  verifiedBadge: {
    backgroundColor: '#EAF6EE',
    borderRadius: 10,
    paddingVertical: 5,
    paddingHorizontal: 9,
    marginTop: 8,
  },
  verifiedText: { color: '#16804A', fontSize: 11, fontWeight: '900' },
  status: { color: '#536358', fontSize: 13, fontWeight: '700', marginTop: 8 },
  experience: { color: '#66736A', fontSize: 13, marginTop: 5 },
  description: {
    color: '#536358',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 12,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 14,
    padding: 15,
    marginTop: 12,
  },
  sectionTitle: { color: '#15251A', fontSize: 17, fontWeight: '900', marginBottom: 10 },
  sectionSubtitle: {
    color: '#16804A',
    fontSize: 12,
    fontWeight: '800',
    marginTop: -4,
    marginBottom: 10,
  },
  body: { color: '#536358', fontSize: 13, lineHeight: 20 },
  muted: { color: '#66736A', fontSize: 13, lineHeight: 20 },
  chipList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  areaChip: {
    color: '#16804A',
    backgroundColor: '#EAF6EE',
    borderRadius: 9,
    paddingVertical: 7,
    paddingHorizontal: 9,
    fontSize: 11,
    fontWeight: '700',
  },
  serviceCard: { borderTopWidth: 1, borderTopColor: '#EDF1ED', paddingVertical: 11 },
  serviceName: { color: '#15251A', fontSize: 15, fontWeight: '800' },
  serviceImage: { width: '100%', height: 170, borderRadius: 10, marginTop: 9 },
  smallText: { color: '#66736A', fontSize: 12, marginTop: 5 },
  requestButton: {
    backgroundColor: '#16804A',
    borderRadius: 9,
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  requestButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  hourRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: '#EDF1ED',
  },
  hourDay: { color: '#15251A', fontSize: 13, fontWeight: '700' },
  portfolioRow: { flexDirection: 'row', gap: 10 },
  portfolioTile: { width: 175 },
  portfolioImage: { width: 175, height: 135, borderRadius: 10, backgroundColor: '#EAF6EE' },
  portfolioCaption: { color: '#536358', fontSize: 11, lineHeight: 16, marginTop: 5 },
  reviewCard: { borderTopWidth: 1, borderTopColor: '#EDF1ED', paddingVertical: 10 },
  reviewTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  stars: { color: '#B27B09', fontSize: 15 },
  reviewDate: { color: '#7B887E', fontSize: 11 },
  moreButton: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  moreText: { color: '#16804A', fontSize: 12, fontWeight: '800' },
  disabled: { opacity: 0.6 },
  center: { paddingVertical: 50, alignItems: 'center' },
  notice: { backgroundColor: '#FFFFFF', borderRadius: 13, padding: 16 },
  errorText: { color: '#A12A2A', lineHeight: 20 },
  retry: { color: '#16804A', fontWeight: '800', marginTop: 10 },
});
