import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { startConversationAndNavigate } from '../../lib/messaging';
import { getTranslations, resolveLanguage, type Language } from '../../lib/translations';

type RequestStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'in_progress'
  | 'provider_completed'
  | 'completed'
  | 'disputed';
type StatusFilter = RequestStatus | 'all';
type RequestCursor = { createdAt: string; id: string };
type ServiceRequest = {
  id: string;
  service_id: string;
  city_id: string;
  description: string;
  requested_date: string | null;
  requested_time: string | null;
  location: string | null;
  status: RequestStatus;
  created_at: string;
};
type ProviderResponse = {
  id: string;
  request_id: string;
  provider_id: string;
  status: 'accepted' | 'declined' | 'withdrawn';
  response_message: string | null;
  proposed_price: number | null;
  currency_id: string | null;
};
type Booking = {
  id: string;
  request_id: string;
  provider_id: string;
  status:
    | 'pending'
    | 'accepted'
    | 'provider_on_way'
    | 'arrived'
    | 'in_progress'
    | 'provider_completed'
    | 'completed'
    | 'cancelled'
    | 'disputed';
  agreed_price: number;
  currency_id: string;
};
type ProviderName = { provider_id: string; professional_name: string; display_name: string | null };
type CustomerNotification = { id: string; title: string; message: string; created_at: string };

const pageSize = 20;
const requestStatuses: RequestStatus[] = [
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'in_progress',
  'provider_completed',
  'completed',
  'disputed',
];
const cancellableBookingStatuses: Booking['status'][] = [
  'pending',
  'accepted',
  'provider_on_way',
  'arrived',
];

export default function MyRequestsScreen() {
  const params = useLocalSearchParams<{ language?: string; bookingId?: string }>();
  const [language, setLanguage] = useState<Language>(resolveLanguage(params.language));
  const copy = getTranslations(language).customerRequests;
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('all');
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [serviceNames, setServiceNames] = useState<Record<string, string>>({});
  const [cityNames, setCityNames] = useState<Record<string, string>>({});
  const [responsesByRequest, setResponsesByRequest] = useState<Record<string, ProviderResponse[]>>(
    {},
  );
  const [bookingsByRequest, setBookingsByRequest] = useState<Record<string, Booking>>({});
  const [reviewedBookings, setReviewedBookings] = useState<Record<string, boolean>>({});
  const [providerNames, setProviderNames] = useState<Record<string, string>>({});
  const [currencyCodes, setCurrencyCodes] = useState<Record<string, string>>({});
  const [notifications, setNotifications] = useState<CustomerNotification[]>([]);
  const [cursor, setCursor] = useState<RequestCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [profileMissing, setProfileMissing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [messagingResponseId, setMessagingResponseId] = useState<string | null>(null);
  const [confirmingBookingId, setConfirmingBookingId] = useState<string | null>(null);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (nextCursor: RequestCursor | null, append: boolean) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setLoadError('');
        setAuthRequired(false);
        setProfileMissing(false);
      }

      try {
        const { data: userResult, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!userResult.user) {
          setAuthRequired(true);
          setRequests([]);
          setHasMore(false);
          setCursor(null);
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id')
          .eq('user_id', userResult.user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!profile) {
          setProfileMissing(true);
          setRequests([]);
          setHasMore(false);
          setCursor(null);
          return;
        }

        let query = supabase
          .from('service_requests')
          .select(
            'id, service_id, city_id, description, requested_date, requested_time, location, status, created_at',
          )
          .eq('customer_id', profile.id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(pageSize + 1);

        if (selectedStatus !== 'all') query = query.eq('status', selectedStatus);
        if (nextCursor) {
          query = query.or(
            `created_at.lt.${nextCursor.createdAt},and(created_at.eq.${nextCursor.createdAt},id.lt.${nextCursor.id})`,
          );
        }

        const { data, error } = await query;
        if (error) throw error;

        const page = (data ?? []) as ServiceRequest[];
        const moreAvailable = page.length > pageSize;
        const visiblePage = page.slice(0, pageSize);
        const serviceIds = [...new Set(visiblePage.map((request) => request.service_id))];
        const cityIds = [...new Set(visiblePage.map((request) => request.city_id))];
        const requestIds = visiblePage.map((request) => request.id);

        const [serviceResult, cityResult, responseResult, bookingResult] = await Promise.all([
          serviceIds.length
            ? supabase.from('services').select('id, name').in('id', serviceIds)
            : Promise.resolve({ data: [], error: null }),
          cityIds.length
            ? supabase.from('cities').select('id, name').in('id', cityIds)
            : Promise.resolve({ data: [], error: null }),
          requestIds.length
            ? supabase
                .from('service_request_responses')
                .select(
                  'id, request_id, provider_id, status, response_message, proposed_price, currency_id',
                )
                .in('request_id', requestIds)
            : Promise.resolve({ data: [], error: null }),
          requestIds.length
            ? supabase
                .from('bookings')
                .select('id, request_id, provider_id, status, agreed_price, currency_id')
                .in('request_id', requestIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (serviceResult.error) throw serviceResult.error;
        if (cityResult.error) throw cityResult.error;
        if (responseResult.error) throw responseResult.error;
        if (bookingResult.error) throw bookingResult.error;

        const responses = (responseResult.data ?? []) as ProviderResponse[];
        const bookings = (bookingResult.data ?? []) as Booking[];
        const bookingIds = bookings.map((booking) => booking.id);
        const reviewResult = bookingIds.length
          ? await supabase.from('reviews').select('booking_id').in('booking_id', bookingIds)
          : { data: [], error: null };
        if (reviewResult.error) throw reviewResult.error;
        const reviewedMap = Object.fromEntries(
          (reviewResult.data ?? []).map((review) => [review.booking_id, true]),
        );
        const providerIds = [...new Set(responses.map((response) => response.provider_id))];
        const currencyIds = [
          ...new Set(
            [
              ...responses.map((response) => response.currency_id),
              ...bookings.map((booking) => booking.currency_id),
            ].filter((id): id is string => id !== null),
          ),
        ];
        const [providerResult, currencyResult] = await Promise.all([
          providerIds.length
            ? supabase
                .from('provider_directory')
                .select('provider_id, professional_name, display_name')
                .in('provider_id', providerIds)
            : Promise.resolve({ data: [], error: null }),
          currencyIds.length
            ? supabase.from('currencies').select('id, code').in('id', currencyIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (providerResult.error) throw providerResult.error;
        if (currencyResult.error) throw currencyResult.error;

        const { data: notificationData, error: notificationError } = await supabase
          .from('notifications')
          .select('id, title, message, created_at')
          .eq('user_id', userResult.user.id)
          .order('created_at', { ascending: false })
          .limit(10);
        if (notificationError) throw notificationError;

        const serviceMap = Object.fromEntries(
          (serviceResult.data ?? []).map((service) => [service.id, service.name]),
        );
        const cityMap = Object.fromEntries(
          (cityResult.data ?? []).map((city) => [city.id, city.name]),
        );
        const groupedResponses = responses.reduce<Record<string, ProviderResponse[]>>(
          (grouped, response) => {
            grouped[response.request_id] = [...(grouped[response.request_id] ?? []), response];
            return grouped;
          },
          {},
        );
        const bookingMap = Object.fromEntries(
          bookings
            .filter((booking) => booking.request_id)
            .map((booking) => [booking.request_id, booking]),
        );
        const providerMap = Object.fromEntries(
          ((providerResult.data ?? []) as ProviderName[]).map((provider) => [
            provider.provider_id,
            provider.professional_name || provider.display_name || copy.provider,
          ]),
        );
        const currencyMap = Object.fromEntries(
          (currencyResult.data ?? []).map((currency) => [currency.id, currency.code]),
        );

        setRequests((current) => (append ? [...current, ...visiblePage] : visiblePage));
        setServiceNames((current) => (append ? { ...current, ...serviceMap } : serviceMap));
        setCityNames((current) => (append ? { ...current, ...cityMap } : cityMap));
        setResponsesByRequest((current) =>
          append ? { ...current, ...groupedResponses } : groupedResponses,
        );
        setBookingsByRequest((current) => (append ? { ...current, ...bookingMap } : bookingMap));
        setReviewedBookings((current) => (append ? { ...current, ...reviewedMap } : reviewedMap));
        setProviderNames((current) => (append ? { ...current, ...providerMap } : providerMap));
        setCurrencyCodes((current) => (append ? { ...current, ...currencyMap } : currencyMap));
        setNotifications((notificationData ?? []) as CustomerNotification[]);
        setHasMore(moreAvailable);
        const lastRequest = visiblePage.at(-1);
        setCursor(
          moreAvailable && lastRequest
            ? { createdAt: lastRequest.created_at, id: lastRequest.id }
            : null,
        );
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : copy.requestError);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [copy.provider, copy.requestError, selectedStatus],
  );

  useFocusEffect(
    useCallback(() => {
      void fetchPage(null, false);
    }, [fetchPage]),
  );

  async function confirmCompletion(bookingId: string) {
    setConfirmingBookingId(bookingId);
    setLoadError('');
    try {
      const { error } = await supabase.rpc('customer_confirm_booking_completion', {
        p_booking_id: bookingId,
      });
      if (error) throw error;
      await fetchPage(null, false);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : copy.requestError);
    } finally {
      setConfirmingBookingId(null);
    }
  }

  async function cancelRequest(requestId: string) {
    if (cancellingRequestId) return;
    setCancellingRequestId(requestId);
    setLoadError('');
    try {
      const { error } = await supabase.rpc('customer_cancel_service_request', {
        p_request_id: requestId,
      });
      if (error) throw error;
      Alert.alert(copy.cancelSuccessTitle, copy.cancelSuccessMessage);
      await fetchPage(null, false);
    } catch {
      setLoadError(copy.cancelError);
    } finally {
      setCancellingRequestId(null);
    }
  }

  function confirmCancellation(requestId: string) {
    Alert.alert(copy.cancelConfirmTitle, copy.cancelConfirmMessage, [
      { text: copy.keepRequest, style: 'cancel' },
      {
        text: copy.cancelRequest,
        style: 'destructive',
        onPress: () => void cancelRequest(requestId),
      },
    ]);
  }

  function openSignIn() {
    router.push({
      pathname: '/account',
      params: {
        role: 'customer',
        mode: 'login',
        language,
        returnTo: '/bookings',
      },
    } as Href);
  }

  function openNewRequest() {
    router.push({ pathname: '/bookings/new', params: { language } } as Href);
  }

  function confirmProvider(requestId: string) {
    router.push({
      pathname: '/bookings/confirm/[requestId]',
      params: { requestId, language },
    } as Href);
  }

  async function openConversation(request: ServiceRequest, response: ProviderResponse) {
    const booking = bookingsByRequest[request.id];
    if (!booking && (request.status !== 'pending' || response.status !== 'accepted')) return;
    setMessagingResponseId(response.id);
    setLoadError('');
    try {
      await startConversationAndNavigate({
        bookingId: booking?.id,
        requestId: booking ? undefined : request.id,
        providerId: response.provider_id,
        language,
      });
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : copy.requestError);
    } finally {
      setMessagingResponseId(null);
    }
  }

  function openInbox() {
    router.push({ pathname: '/messages', params: { language } } as Href);
  }

  function openNotificationPreferences() {
    router.push({ pathname: '/notifications/preferences', params: { language } } as Href);
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
                style={[styles.languageOption, language === option && styles.languageOptionActive]}
                onPress={() => setLanguage(option)}
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
        <Text style={styles.brand}>NSOMEX CONNECT</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{copy.titleList}</Text>
        <Text style={styles.subtitle}>{copy.listSubtitle}</Text>
        <Pressable style={styles.confirmButton} onPress={openInbox}>
          <Text style={styles.confirmButtonText}>
            {getTranslations(language).messaging.openInbox}
          </Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={openNotificationPreferences}>
          <Text style={styles.secondaryButtonText}>
            {getTranslations(language).notificationPreferences.title}
          </Text>
        </Pressable>

        {!authRequired && !profileMissing && !loading ? (
          <>
            <Text style={styles.responseHeading}>{copy.notifications}</Text>
            {notifications.length ? (
              notifications.map((notification) => (
                <View key={notification.id} style={styles.notificationCard}>
                  <Text style={styles.responseTitle}>{notification.title}</Text>
                  <Text style={styles.responseMessage}>{notification.message}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.detail}>{copy.noNotifications}</Text>
            )}
          </>
        ) : null}

        {authRequired ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{copy.signInRequired}</Text>
            <Pressable style={styles.button} onPress={openSignIn}>
              <Text style={styles.buttonText}>{copy.signIn}</Text>
            </Pressable>
          </View>
        ) : profileMissing ? (
          <View style={styles.notice}>
            <Text style={styles.errorText}>{copy.missingProfile}</Text>
          </View>
        ) : loadError ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>{copy.listErrorTitle}</Text>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable style={styles.secondaryButton} onPress={() => void fetchPage(null, false)}>
              <Text style={styles.secondaryButtonText}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}
            >
              {(['all', ...requestStatuses] as const).map((status) => {
                const label = status === 'all' ? copy.all : copy.statuses[status];
                return (
                  <Pressable
                    key={status}
                    onPress={() => setSelectedStatus(status)}
                    style={[styles.filter, selectedStatus === status && styles.activeFilter]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedStatus === status }}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        selectedStatus === status && styles.activeFilterText,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color="#16804A" />
                <Text style={styles.muted}>{copy.loading}</Text>
              </View>
            ) : requests.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>▤</Text>
                <Text style={styles.emptyTitle}>{copy.noRequests}</Text>
                <Pressable style={styles.button} onPress={openNewRequest}>
                  <Text style={styles.buttonText}>{copy.startRequest}</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {requests.map((request) => {
                  const requestedDate = formatDate(request.requested_date);
                  const booking = bookingsByRequest[request.id];
                  const canCancel = booking
                    ? cancellableBookingStatuses.includes(booking.status)
                    : request.status === 'pending';
                  return (
                    <View
                      key={request.id}
                      style={[
                        styles.requestCard,
                        bookingsByRequest[request.id]?.id === params.bookingId &&
                          styles.focusedRequestCard,
                      ]}
                    >
                      <View style={styles.cardTop}>
                        <Text style={styles.requestName}>
                          {serviceNames[request.service_id] ?? copy.service}
                        </Text>
                        <View style={styles.statusBadge}>
                          <Text style={styles.statusText}>{copy.statuses[request.status]}</Text>
                        </View>
                      </View>
                      <Text style={styles.requestDescription}>{request.description}</Text>
                      {(request.location || cityNames[request.city_id]) && (
                        <Text style={styles.detail}>
                          {copy.locationLabel}:{' '}
                          {[cityNames[request.city_id], request.location]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      )}
                      {requestedDate ? (
                        <Text style={styles.detail}>
                          {copy.dateLabel}: {requestedDate}
                        </Text>
                      ) : null}
                      {request.requested_time ? (
                        <Text style={styles.detail}>
                          {copy.timeLabel}: {request.requested_time.slice(0, 5)}
                        </Text>
                      ) : null}
                      {canCancel ? (
                        <Pressable
                          style={[
                            styles.cancelButton,
                            cancellingRequestId === request.id && styles.disabled,
                          ]}
                          onPress={() => confirmCancellation(request.id)}
                          disabled={cancellingRequestId === request.id}
                          accessibilityRole="button"
                        >
                          {cancellingRequestId === request.id ? (
                            <ActivityIndicator color="#A12A2A" />
                          ) : (
                            <Text style={styles.cancelButtonText}>{copy.cancelRequest}</Text>
                          )}
                        </Pressable>
                      ) : null}
                      <Text style={styles.responseHeading}>{copy.providerResponses}</Text>
                      {(responsesByRequest[request.id] ?? []).length ? (
                        (responsesByRequest[request.id] ?? []).map((response) => {
                          return (
                            <View key={response.id} style={styles.responseCard}>
                              <Text style={styles.responseTitle}>
                                {response.status === 'accepted'
                                  ? copy.responseAccepted
                                  : response.status === 'declined'
                                    ? copy.responseDeclined
                                    : copy.responseWithdrawn}
                              </Text>
                              <Text style={styles.detail}>
                                {copy.provider}:{' '}
                                {providerNames[response.provider_id] ?? copy.provider}
                              </Text>
                              {response.response_message ? (
                                <Text style={styles.responseMessage}>
                                  {copy.providerMessage}: {response.response_message}
                                </Text>
                              ) : null}
                              {response.proposed_price !== null && response.currency_id ? (
                                <Text style={styles.detail}>
                                  {copy.proposedPrice}: {response.proposed_price}{' '}
                                  {currencyCodes[response.currency_id] ?? ''}
                                </Text>
                              ) : null}
                              {booking ||
                              (request.status === 'pending' && response.status === 'accepted') ? (
                                <Pressable
                                  style={[
                                    styles.confirmButton,
                                    messagingResponseId === response.id && styles.disabled,
                                  ]}
                                  onPress={() => void openConversation(request, response)}
                                  disabled={messagingResponseId === response.id}
                                >
                                  {messagingResponseId === response.id ? (
                                    <ActivityIndicator color="#FFFFFF" />
                                  ) : (
                                    <Text style={styles.confirmButtonText}>
                                      {getTranslations(language).messaging.messageProvider}
                                    </Text>
                                  )}
                                </Pressable>
                              ) : null}
                              {booking ? (
                                <View style={styles.bookingStatus}>
                                  <Text style={styles.responseTitle}>{copy.bookingProgress}</Text>
                                  <Text style={styles.detail}>
                                    {copy.bookingStatuses[booking.status]}
                                  </Text>
                                  <Text style={styles.detail}>
                                    {copy.proposedPrice}: {booking.agreed_price}{' '}
                                    {currencyCodes[booking.currency_id] ?? ''}
                                  </Text>
                                  {booking.status === 'provider_completed' ? (
                                    <Pressable
                                      style={[
                                        styles.reviewButton,
                                        confirmingBookingId === booking.id && styles.disabled,
                                      ]}
                                      onPress={() => void confirmCompletion(booking.id)}
                                      disabled={confirmingBookingId === booking.id}
                                    >
                                      {confirmingBookingId === booking.id ? (
                                        <ActivityIndicator color="#16804A" />
                                      ) : (
                                        <Text style={styles.reviewButtonText}>
                                          {copy.confirmCompletion}
                                        </Text>
                                      )}
                                    </Pressable>
                                  ) : null}
                                  {booking.status === 'completed' ? (
                                    reviewedBookings[booking.id] ? (
                                      <Text style={styles.reviewSubmitted}>
                                        {getTranslations(language).customerReviews.reviewSubmitted}
                                      </Text>
                                    ) : (
                                      <Pressable
                                        style={styles.reviewButton}
                                        onPress={() =>
                                          router.push({
                                            pathname: '/reviews/[bookingId]',
                                            params: { bookingId: booking.id, language },
                                          } as Href)
                                        }
                                      >
                                        <Text style={styles.reviewButtonText}>
                                          {
                                            getTranslations(language).customerReviews
                                              .reviewCompleted
                                          }
                                        </Text>
                                      </Pressable>
                                    )
                                  ) : null}
                                </View>
                              ) : response.status === 'accepted' ? (
                                <Pressable
                                  style={styles.confirmButton}
                                  onPress={() => confirmProvider(request.id)}
                                >
                                  <Text style={styles.confirmButtonText}>{copy.createBooking}</Text>
                                </Pressable>
                              ) : null}
                            </View>
                          );
                        })
                      ) : (
                        <Text style={styles.detail}>{copy.noProviderResponses}</Text>
                      )}
                    </View>
                  );
                })}

                {hasMore ? (
                  <Pressable
                    style={[styles.secondaryButton, loadingMore && styles.disabled]}
                    onPress={() => void fetchPage(cursor, true)}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <ActivityIndicator color="#16804A" />
                    ) : (
                      <Text style={styles.secondaryButtonText}>{copy.loadMore}</Text>
                    )}
                  </Pressable>
                ) : null}
                <Pressable style={styles.button} onPress={openNewRequest}>
                  <Text style={styles.buttonText}>{copy.startRequest}</Text>
                </Pressable>
              </>
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
    paddingTop: 55,
    paddingHorizontal: 20,
    paddingBottom: 18,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5ECE6',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  back: { color: '#16804A', fontSize: 16, fontWeight: '700' },
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
  brand: { color: '#16804A', fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  content: { padding: 20, paddingBottom: 45 },
  title: { fontSize: 29, fontWeight: '800', color: '#15251A', marginTop: 10 },
  subtitle: { color: '#66736A', fontSize: 15, marginTop: 8, lineHeight: 22 },
  filters: { gap: 9, marginTop: 24, marginBottom: 18 },
  filter: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE7DF',
  },
  activeFilter: { backgroundColor: '#16804A', borderColor: '#16804A' },
  filterText: { color: '#536358', fontWeight: '600', fontSize: 13 },
  activeFilterText: { color: '#FFFFFF' },
  center: { paddingVertical: 55, alignItems: 'center' },
  muted: { color: '#66736A', marginTop: 10 },
  notice: {
    backgroundColor: '#FFFFFF',
    padding: 18,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#E5ECE6',
    marginTop: 22,
  },
  noticeTitle: { color: '#15251A', fontWeight: '800', fontSize: 17 },
  noticeText: { color: '#66736A', lineHeight: 21 },
  errorText: { color: '#A12A2A', marginTop: 8, lineHeight: 20 },
  empty: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E5ECE6',
  },
  emptyIcon: { fontSize: 35, color: '#16804A', marginBottom: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#15251A', textAlign: 'center' },
  requestCard: {
    backgroundColor: '#FFFFFF',
    padding: 17,
    borderRadius: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5ECE6',
  },
  focusedRequestCard: { borderColor: '#16804A', borderWidth: 2 },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  requestName: { flex: 1, fontSize: 17, fontWeight: '800', color: '#15251A' },
  statusBadge: {
    backgroundColor: '#EAF6EE',
    borderRadius: 12,
    paddingVertical: 5,
    paddingHorizontal: 9,
  },
  statusText: { color: '#16804A', fontSize: 12, fontWeight: '800' },
  requestDescription: { color: '#536358', lineHeight: 21, marginTop: 10 },
  detail: { color: '#66736A', marginTop: 8, fontSize: 13, lineHeight: 19 },
  responseHeading: { color: '#16804A', fontSize: 14, fontWeight: '800', marginTop: 17 },
  responseCard: {
    backgroundColor: '#F6FAF6',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 11,
    padding: 12,
    marginTop: 9,
  },
  responseTitle: { color: '#15251A', fontSize: 13, fontWeight: '800' },
  responseMessage: { color: '#536358', fontSize: 13, lineHeight: 19, marginTop: 8 },
  notificationCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 11,
    padding: 12,
    marginTop: 9,
  },
  bookingStatus: { borderTopWidth: 1, borderTopColor: '#E2EAE3', marginTop: 10, paddingTop: 10 },
  confirmButton: {
    backgroundColor: '#16804A',
    borderRadius: 9,
    minHeight: 43,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 11,
    paddingHorizontal: 10,
  },
  confirmButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  reviewButton: {
    alignSelf: 'flex-start',
    minHeight: 40,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 9,
    marginTop: 11,
    paddingHorizontal: 11,
  },
  reviewButtonText: { color: '#16804A', fontSize: 12, fontWeight: '800' },
  reviewSubmitted: { color: '#16804A', fontSize: 12, fontWeight: '700', marginTop: 10 },
  button: {
    backgroundColor: '#16804A',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 49,
    marginTop: 18,
  },
  buttonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 11,
    minHeight: 47,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 14,
  },
  secondaryButtonText: { color: '#16804A', fontWeight: '800' },
  cancelButton: {
    minHeight: 44,
    marginTop: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A12A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: { color: '#A12A2A', fontWeight: '800' },
  disabled: { opacity: 0.6 },
});
