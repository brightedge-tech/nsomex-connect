import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { startConversationAndNavigate } from '../../lib/messaging';
import { getTranslations } from '../../lib/translations';
import { usePersistentLanguage } from '../../lib/usePersistentLanguage';

type BookingStatus =
  | 'pending'
  | 'accepted'
  | 'provider_on_way'
  | 'arrived'
  | 'in_progress'
  | 'provider_completed'
  | 'completed'
  | 'cancelled'
  | 'disputed';
type ProviderJob = {
  id: string;
  request_id: string | null;
  status: BookingStatus;
  created_at: string;
  service_name: string;
  agreed_price: number;
  currency_code: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  location: string | null;
  city_name: string;
  customer_name: string | null;
  customer_phone: string | null;
};
type Cursor = { createdAt: string; id: string };
const pageSize = 20;

function nextActions(status: BookingStatus): BookingStatus[] {
  switch (status) {
    case 'pending':
      return ['accepted'];
    case 'accepted':
      return ['provider_on_way', 'cancelled'];
    case 'provider_on_way':
      return ['arrived', 'cancelled'];
    case 'arrived':
      return ['in_progress', 'cancelled'];
    case 'in_progress':
      return ['provider_completed'];
    default:
      return [];
  }
}

export default function ProviderJobsScreen() {
  const params = useLocalSearchParams<{ language?: string; bookingId?: string }>();
  const [language, setLanguage] = usePersistentLanguage(params.language);
  const copy = getTranslations(language).providerOperations;
  const [jobs, setJobs] = useState<ProviderJob[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [messagingJobId, setMessagingJobId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadJobs = useCallback(
    async (before: Cursor | null, append: boolean) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError('');
      }
      try {
        const { data, error: rpcError } = await supabase.rpc('provider_list_jobs', {
          p_before_created_at: before?.createdAt ?? null,
          p_before_id: before?.id ?? null,
          p_page_size: pageSize + 1,
        });
        if (rpcError) throw rpcError;

        const page = (data ?? []) as ProviderJob[];
        const more = page.length > pageSize;
        const visible = page.slice(0, pageSize);
        setJobs((current) => (append ? [...current, ...visible] : visible));
        setHasMore(more);
        const last = visible[visible.length - 1];
        setCursor(more && last ? { createdAt: last.created_at, id: last.id } : null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : copy.statusError);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [copy.statusError],
  );

  useFocusEffect(
    useCallback(() => {
      void loadJobs(null, false);
    }, [loadJobs]),
  );

  async function updateStatus(jobId: string, status: BookingStatus) {
    setActiveJobId(jobId);
    setError('');
    try {
      const { error: rpcError } = await supabase.rpc('provider_update_booking_status', {
        p_booking_id: jobId,
        p_status: status,
      });
      if (rpcError) throw rpcError;
      await loadJobs(null, false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.statusError);
    } finally {
      setActiveJobId(null);
    }
  }

  async function messageCustomer(jobId: string) {
    setMessagingJobId(jobId);
    setError('');
    try {
      await startConversationAndNavigate({ bookingId: jobId, language });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.statusError);
    } finally {
      setMessagingJobId(null);
    }
  }

  function formatDate(value: string | null) {
    if (!value) return null;
    return new Date(`${value}T00:00:00`).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: copy.jobs }} />
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
        <Text style={styles.title}>{copy.jobs}</Text>
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void loadJobs(null, false)}>
              <Text style={styles.retry}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : null}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
            <Text style={styles.muted}>{copy.loading}</Text>
          </View>
        ) : jobs.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{copy.noJobs}</Text>
          </View>
        ) : (
          <>
            {jobs.map((job) => {
              const date = formatDate(job.scheduled_date);
              const busy = activeJobId === job.id;
              return (
                <View
                  key={job.id}
                  style={[styles.card, job.id === params.bookingId && styles.focusedCard]}
                >
                  <View style={styles.cardTop}>
                    <Text style={styles.serviceName}>{job.service_name}</Text>
                    <Text style={styles.statusBadge}>{copy.bookingStatuses[job.status]}</Text>
                  </View>
                  <Text style={styles.detail}>
                    {copy.customer}: {job.customer_name || '—'}
                  </Text>
                  {job.customer_phone ? (
                    <Text style={styles.phone}>{job.customer_phone}</Text>
                  ) : null}
                  <Text style={styles.detail}>
                    {copy.location}: {[job.city_name, job.location].filter(Boolean).join(', ')}
                  </Text>
                  {date ? (
                    <Text style={styles.detail}>
                      {copy.preferredDate}: {date}
                      {job.scheduled_time ? ` · ${job.scheduled_time.slice(0, 5)}` : ''}
                    </Text>
                  ) : null}
                  <Text style={styles.price}>
                    {copy.agreedPrice}: {job.agreed_price} {job.currency_code}
                  </Text>
                  <Pressable
                    style={[styles.chatButton, messagingJobId === job.id && styles.disabled]}
                    onPress={() => void messageCustomer(job.id)}
                    disabled={messagingJobId === job.id}
                  >
                    {messagingJobId === job.id ? (
                      <ActivityIndicator color="#16804A" />
                    ) : (
                      <Text style={styles.chatButtonText}>
                        {getTranslations(language).messaging.messageCustomer}
                      </Text>
                    )}
                  </Pressable>
                  {nextActions(job.status).length ? (
                    <View style={styles.actions}>
                      {nextActions(job.status).map((status) => (
                        <Pressable
                          key={status}
                          style={[
                            status === 'cancelled' ? styles.dangerButton : styles.primaryButton,
                            busy && styles.disabled,
                          ]}
                          onPress={() => void updateStatus(job.id, status)}
                          disabled={busy}
                        >
                          {busy ? (
                            <ActivityIndicator color="#FFFFFF" />
                          ) : (
                            <Text style={styles.buttonText}>
                              {status === 'accepted'
                                ? copy.confirmJob
                                : status === 'provider_on_way'
                                  ? copy.startTravel
                                  : status === 'arrived'
                                    ? copy.markArrived
                                    : status === 'in_progress'
                                      ? copy.startJob
                                      : status === 'provider_completed'
                                        ? copy.completeJob
                                        : copy.cancelJob}
                            </Text>
                          )}
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
            {hasMore ? (
              <Pressable
                style={[styles.moreButton, loadingMore && styles.disabled]}
                onPress={() => void loadJobs(cursor, true)}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <ActivityIndicator color="#16804A" />
                ) : (
                  <Text style={styles.moreText}>{copy.loadMore}</Text>
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
  content: { padding: 20, paddingBottom: 45 },
  title: { color: '#15251A', fontSize: 28, fontWeight: '900', marginBottom: 17 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 16,
    padding: 17,
    marginBottom: 14,
  },
  focusedCard: { borderColor: '#16804A', borderWidth: 2 },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 9,
  },
  serviceName: { flex: 1, color: '#15251A', fontSize: 17, fontWeight: '900' },
  statusBadge: {
    color: '#16804A',
    backgroundColor: '#EAF6EE',
    padding: 7,
    borderRadius: 9,
    fontSize: 11,
    fontWeight: '800',
  },
  detail: { color: '#536358', fontSize: 13, lineHeight: 19, marginTop: 9 },
  phone: { color: '#15251A', fontWeight: '700', marginTop: 4 },
  price: { color: '#16804A', fontWeight: '800', marginTop: 11 },
  chatButton: {
    minHeight: 42,
    marginTop: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#16804A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatButtonText: { color: '#16804A', fontWeight: '800' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 16 },
  primaryButton: {
    flexGrow: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#16804A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dangerButton: {
    flexGrow: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#A12A2A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  moreButton: {
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 10,
    minHeight: 46,
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreText: { color: '#16804A', fontWeight: '800' },
  disabled: { opacity: 0.6 },
  center: { paddingVertical: 55, alignItems: 'center' },
  muted: { color: '#66736A', marginTop: 9 },
  empty: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 22, alignItems: 'center' },
  emptyText: { color: '#66736A', textAlign: 'center', lineHeight: 22 },
  errorBanner: { backgroundColor: '#FCECEC', padding: 13, borderRadius: 10, marginBottom: 13 },
  errorText: { color: '#8E2525', lineHeight: 20 },
  retry: { color: '#16804A', fontWeight: '800', marginTop: 8 },
});
