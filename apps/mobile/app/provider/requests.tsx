import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { startConversationAndNavigate } from '../../lib/messaging';
import { getTranslations } from '../../lib/translations';
import { usePersistentLanguage } from '../../lib/usePersistentLanguage';

type ProviderResponseStatus = 'accepted' | 'declined';
type ProviderRequest = {
  id: string;
  created_at: string;
  service_name: string;
  description: string;
  requested_date: string | null;
  requested_time: string | null;
  location: string | null;
  country_name: string;
  region_name: string;
  city_name: string;
  neighborhood_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  response_status: ProviderResponseStatus | null;
  response_message: string | null;
};
type Cursor = { createdAt: string; id: string };
const pageSize = 25;

export default function ProviderRequestsScreen() {
  const params = useLocalSearchParams<{ language?: string; requestId?: string }>();
  const [language, setLanguage] = usePersistentLanguage(params.language);
  const copy = getTranslations(language).providerOperations;
  const [requests, setRequests] = useState<ProviderRequest[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [decliningRequestId, setDecliningRequestId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [messagingRequestId, setMessagingRequestId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadPage = useCallback(
    async (before: Cursor | null, append: boolean) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError('');
      }

      try {
        const { data, error: rpcError } = await supabase.rpc('provider_list_requests', {
          p_before_created_at: before?.createdAt ?? null,
          p_before_id: before?.id ?? null,
          p_page_size: pageSize + 1,
        });
        if (rpcError) throw rpcError;

        const page = (data ?? []) as ProviderRequest[];
        const more = page.length > pageSize;
        const visible = page.slice(0, pageSize);
        setRequests((current) => (append ? [...current, ...visible] : visible));
        setHasMore(more);
        const last = visible.at(-1);
        setCursor(more && last ? { createdAt: last.created_at, id: last.id } : null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : copy.responseError);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [copy.responseError],
  );

  useFocusEffect(
    useCallback(() => {
      void loadPage(null, false);
    }, [loadPage]),
  );

  async function respond(requestId: string, status: ProviderResponseStatus) {
    setActiveAction(requestId);
    setError('');
    try {
      const { error: rpcError } = await supabase.rpc('provider_respond_to_request', {
        p_request_id: requestId,
        p_status: status,
        p_reason: status === 'declined' ? declineReason.trim() || null : null,
      });
      if (rpcError) throw rpcError;
      setDecliningRequestId(null);
      setDeclineReason('');
      await loadPage(null, false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.responseError);
    } finally {
      setActiveAction(null);
    }
  }

  async function messageCustomer(requestId: string) {
    setMessagingRequestId(requestId);
    setError('');
    try {
      await startConversationAndNavigate({ requestId, language });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.responseError);
    } finally {
      setMessagingRequestId(null);
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
      <Stack.Screen options={{ title: copy.requestTitle }} />
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
        <Text style={styles.title}>{copy.requestTitle}</Text>
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void loadPage(null, false)}>
              <Text style={styles.retry}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
            <Text style={styles.muted}>{copy.loading}</Text>
          </View>
        ) : requests.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{copy.noRequests}</Text>
          </View>
        ) : (
          <>
            {requests.map((request) => {
              const date = formatDate(request.requested_date);
              return (
                <View
                  key={request.id}
                  style={[styles.card, request.id === params.requestId && styles.focusedCard]}
                >
                  <View style={styles.cardHeader}>
                    <Text style={styles.serviceName}>{request.service_name}</Text>
                    {request.response_status === 'accepted' ? (
                      <Text style={styles.acceptedBadge}>{copy.acceptedOfferShort}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.sectionLabel}>{copy.description}</Text>
                  <Text style={styles.body}>{request.description}</Text>
                  <Text style={styles.sectionLabel}>{copy.customer}</Text>
                  <Text style={styles.body}>{request.contact_name || '—'}</Text>
                  {request.contact_phone ? (
                    <Text style={styles.phone}>{request.contact_phone}</Text>
                  ) : null}
                  <Text style={styles.sectionLabel}>{copy.location}</Text>
                  <Text style={styles.body}>
                    {[request.neighborhood_name, request.city_name, request.region_name]
                      .filter(Boolean)
                      .join(', ')}
                  </Text>
                  {request.location ? <Text style={styles.body}>{request.location}</Text> : null}
                  {date ? (
                    <Text style={styles.detail}>
                      {copy.preferredDate}: {date}
                    </Text>
                  ) : null}
                  {request.requested_time ? (
                    <Text style={styles.detail}>
                      {copy.preferredTime}: {request.requested_time.slice(0, 5)}
                    </Text>
                  ) : null}
                  {request.response_status !== 'declined' ? (
                    <Pressable
                      style={[
                        styles.secondaryButton,
                        messagingRequestId === request.id && styles.disabled,
                      ]}
                      onPress={() => void messageCustomer(request.id)}
                      disabled={messagingRequestId === request.id}
                    >
                      {messagingRequestId === request.id ? (
                        <ActivityIndicator color="#16804A" />
                      ) : (
                        <Text style={styles.secondaryButtonText}>
                          {getTranslations(language).messaging.messageCustomer}
                        </Text>
                      )}
                    </Pressable>
                  ) : null}

                  {request.response_status === 'accepted' ? (
                    <Text style={styles.acceptedMessage}>{copy.acceptedOffer}</Text>
                  ) : (
                    <>
                      {decliningRequestId === request.id ? (
                        <>
                          <Text style={styles.sectionLabel}>{copy.declineReason}</Text>
                          <TextInput
                            style={styles.reasonInput}
                            placeholder={copy.reasonPlaceholder}
                            placeholderTextColor="#89958B"
                            value={declineReason}
                            onChangeText={setDeclineReason}
                            multiline
                            maxLength={2000}
                            textAlignVertical="top"
                          />
                          <View style={styles.actions}>
                            <Pressable
                              style={[
                                styles.dangerButton,
                                activeAction === request.id && styles.disabled,
                              ]}
                              onPress={() => void respond(request.id, 'declined')}
                              disabled={activeAction === request.id}
                            >
                              {activeAction === request.id ? (
                                <ActivityIndicator color="#FFFFFF" />
                              ) : (
                                <Text style={styles.primaryButtonText}>{copy.confirmDecline}</Text>
                              )}
                            </Pressable>
                            <Pressable
                              style={styles.secondaryButton}
                              onPress={() => {
                                setDecliningRequestId(null);
                                setDeclineReason('');
                              }}
                            >
                              <Text style={styles.secondaryButtonText}>{copy.cancel}</Text>
                            </Pressable>
                          </View>
                        </>
                      ) : (
                        <View style={styles.actions}>
                          <Pressable
                            style={[
                              styles.primaryButton,
                              activeAction === request.id && styles.disabled,
                            ]}
                            onPress={() => void respond(request.id, 'accepted')}
                            disabled={activeAction === request.id}
                          >
                            {activeAction === request.id ? (
                              <ActivityIndicator color="#FFFFFF" />
                            ) : (
                              <Text style={styles.primaryButtonText}>{copy.accept}</Text>
                            )}
                          </Pressable>
                          <Pressable
                            style={styles.secondaryButton}
                            onPress={() => {
                              setDecliningRequestId(request.id);
                              setDeclineReason('');
                            }}
                          >
                            <Text style={styles.secondaryButtonText}>{copy.decline}</Text>
                          </Pressable>
                        </View>
                      )}
                    </>
                  )}
                </View>
              );
            })}
            {hasMore ? (
              <Pressable
                style={[styles.secondaryButton, styles.loadMore, loadingMore && styles.disabled]}
                onPress={() => void loadPage(cursor, true)}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <ActivityIndicator color="#16804A" />
                ) : (
                  <Text style={styles.secondaryButtonText}>{copy.loadMore}</Text>
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
    backgroundColor: '#FFFFFF',
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
  },
  serviceName: { color: '#15251A', fontSize: 18, fontWeight: '900', flex: 1 },
  acceptedBadge: {
    color: '#16804A',
    backgroundColor: '#EAF6EE',
    padding: 7,
    borderRadius: 9,
    fontSize: 11,
    fontWeight: '800',
  },
  sectionLabel: {
    color: '#16804A',
    fontSize: 12,
    fontWeight: '900',
    marginTop: 15,
    marginBottom: 5,
  },
  body: { color: '#536358', fontSize: 14, lineHeight: 21 },
  phone: { color: '#15251A', fontWeight: '700', marginTop: 5 },
  detail: { color: '#66736A', fontSize: 13, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 17 },
  primaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: '#16804A',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  secondaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#16804A',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  secondaryButtonText: { color: '#16804A', fontSize: 13, fontWeight: '800' },
  dangerButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: '#A12A2A',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  reasonInput: {
    minHeight: 90,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 10,
    padding: 12,
    color: '#15251A',
  },
  acceptedMessage: { color: '#16804A', lineHeight: 21, marginTop: 15, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  loadMore: { marginTop: 3, marginBottom: 16, flex: 0 },
  center: { paddingVertical: 55, alignItems: 'center' },
  muted: { color: '#66736A', marginTop: 9 },
  empty: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 22, alignItems: 'center' },
  emptyText: { color: '#66736A', textAlign: 'center', lineHeight: 22 },
  errorBanner: { backgroundColor: '#FCECEC', padding: 13, borderRadius: 10, marginBottom: 13 },
  errorText: { color: '#8E2525', lineHeight: 20 },
  retry: { color: '#16804A', fontWeight: '800', marginTop: 8 },
});
