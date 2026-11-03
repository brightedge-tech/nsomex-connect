import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { getTranslations } from '../../lib/translations';
import { usePersistentLanguage } from '../../lib/usePersistentLanguage';

type Summary = {
  total_incoming: number;
  pending_requests: number;
  accepted_jobs: number;
  in_progress_jobs: number;
  awaiting_confirmation_jobs: number;
  completed_jobs: number;
};
type Notification = { id: string; title: string; message: string; created_at: string };
type ProviderInfo = {
  name: string;
  verification_status: string;
  active_services: number;
  profile_completion: number;
};

export default function ProviderDashboardScreen() {
  const params = useLocalSearchParams<{ language?: string }>();
  const [language, setLanguage] = usePersistentLanguage(params.language);
  const copy = getTranslations(language).providerOperations;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userResult.user) throw new Error(copy.signInRequired);

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, display_name, first_name, avatar_url')
        .eq('user_id', userResult.user.id)
        .single();
      if (profileError) throw profileError;

      const { data: providerProfile, error: providerProfileError } = await supabase
        .from('provider_profiles')
        .select('id, professional_name, description, verification_status')
        .eq('profile_id', profile.id)
        .maybeSingle();
      if (providerProfileError) throw providerProfileError;
      if (!providerProfile) throw new Error(copy.signInRequired);

      const [
        summaryResult,
        confirmationResult,
        notificationResult,
        serviceCountResult,
        areaCountResult,
        hoursCountResult,
      ] = await Promise.all([
        supabase.rpc('provider_dashboard_summary'),
        supabase.rpc('provider_awaiting_customer_confirmation_count'),
        supabase
          .from('notifications')
          .select('id, title, message, created_at')
          .eq('user_id', userResult.user.id)
          .order('created_at', { ascending: false })
          .limit(8),
        supabase
          .from('provider_services')
          .select('id', { count: 'exact', head: true })
          .eq('provider_id', providerProfile.id)
          .eq('is_active', true),
        supabase
          .from('provider_service_areas')
          .select('id', { count: 'exact', head: true })
          .eq('provider_id', providerProfile.id),
        supabase
          .from('provider_availability')
          .select('id', { count: 'exact', head: true })
          .eq('provider_id', providerProfile.id)
          .eq('is_available', true),
      ]);
      if (summaryResult.error) throw summaryResult.error;
      if (confirmationResult.error) throw confirmationResult.error;
      if (notificationResult.error) throw notificationResult.error;
      if (serviceCountResult.error) throw serviceCountResult.error;
      if (areaCountResult.error) throw areaCountResult.error;
      if (hoursCountResult.error) throw hoursCountResult.error;

      const summaryRow = (summaryResult.data ?? [])[0] as Summary | undefined;
      if (!summaryRow) throw new Error(copy.dashboardError);
      setSummary({
        ...summaryRow,
        awaiting_confirmation_jobs: Number(confirmationResult.data ?? 0),
      });
      setNotifications((notificationResult.data ?? []) as Notification[]);
      const activeServices = serviceCountResult.count ?? 0;
      const completionParts = [
        Boolean(providerProfile.professional_name.trim()),
        Boolean(providerProfile.description?.trim()),
        Boolean(profile.avatar_url),
        activeServices > 0,
        (areaCountResult.count ?? 0) > 0,
        (hoursCountResult.count ?? 0) > 0,
      ];
      setProvider({
        name:
          providerProfile.professional_name ||
          profile.display_name ||
          profile.first_name ||
          userResult.user.phone ||
          '',
        verification_status: providerProfile.verification_status,
        active_services: activeServices,
        profile_completion: Math.round(
          (completionParts.filter(Boolean).length / completionParts.length) * 100,
        ),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.dashboardError);
    } finally {
      setLoading(false);
    }
  }, [copy.dashboardError, copy.signInRequired]);

  useFocusEffect(
    useCallback(() => {
      void loadDashboard();
    }, [loadDashboard]),
  );

  function open(
    path:
      | '/provider/requests'
      | '/provider/jobs'
      | '/provider/profile'
      | '/provider/portfolio'
      | '/provider/services'
      | '/provider/coverage'
      | '/messages',
  ) {
    router.push({ pathname: path, params: { language } } as Href);
  }

  function openNotificationPreferences() {
    router.push({ pathname: '/notifications/preferences', params: { language } } as Href);
  }

  const metrics = summary
    ? [
        { label: copy.totalIncoming, value: summary.total_incoming },
        { label: copy.pendingRequests, value: summary.pending_requests },
        { label: copy.activeServices, value: provider?.active_services ?? 0 },
        { label: copy.acceptedJobs, value: summary.accepted_jobs },
        { label: copy.inProgressJobs, value: summary.in_progress_jobs },
        {
          label: copy.awaitingConfirmationJobs,
          value: summary.awaiting_confirmation_jobs,
        },
        { label: copy.completedJobs, value: summary.completed_jobs },
      ]
    : [];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: copy.dashboardTitle }} />
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
                accessibilityRole="button"
                accessibilityState={{ selected: language === option }}
              >
                <Text style={styles.languageText}>{option.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Text style={styles.brand}>NSOMEX CONNECT</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{copy.dashboardTitle}</Text>
        <Text style={styles.subtitle}>{copy.dashboardSubtitle}</Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
            <Text style={styles.muted}>{copy.loading}</Text>
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryButton} onPress={() => void loadDashboard()}>
              <Text style={styles.retryText}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {provider ? (
              <View style={styles.welcomeCard}>
                <Text style={styles.welcomeTitle}>
                  {copy.welcome.replace('{name}', provider.name)}
                </Text>
                <Text style={styles.welcomeStatus}>
                  {copy.verificationStatus}:{' '}
                  {copy.providerStatuses[
                    provider.verification_status as keyof typeof copy.providerStatuses
                  ] ?? provider.verification_status}
                </Text>
                <Text style={styles.completion}>
                  {copy.profileCompletion.replace('{percent}', String(provider.profile_completion))}
                </Text>
              </View>
            ) : null}
            <View style={styles.metrics}>
              {metrics.map((metric, index) => (
                <View
                  key={metric.label}
                  style={[styles.metricCard, index === 0 && styles.metricPrimary]}
                >
                  <Text style={[styles.metricValue, index === 0 && styles.metricValuePrimary]}>
                    {metric.value}
                  </Text>
                  <Text style={[styles.metricLabel, index === 0 && styles.metricLabelPrimary]}>
                    {metric.label}
                  </Text>
                </View>
              ))}
            </View>

            <Pressable style={styles.primaryButton} onPress={() => open('/provider/requests')}>
              <Text style={styles.primaryButtonText}>{copy.inbox}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => open('/messages')}>
              <Text style={styles.secondaryButtonText}>
                {getTranslations(language).messaging.openInbox}
              </Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={openNotificationPreferences}>
              <Text style={styles.secondaryButtonText}>
                {getTranslations(language).notificationPreferences.title}
              </Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => open('/provider/jobs')}>
              <Text style={styles.secondaryButtonText}>{copy.jobs}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => open('/provider/profile')}>
              <Text style={styles.secondaryButtonText}>
                {getTranslations(language).providerProfile.title}
              </Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => open('/provider/services')}>
              <Text style={styles.secondaryButtonText}>{copy.manageServices}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => open('/provider/coverage')}>
              <Text style={styles.secondaryButtonText}>{copy.manageCoverage}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => open('/provider/profile')}>
              <Text style={styles.secondaryButtonText}>{copy.manageAvailability}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => open('/provider/portfolio')}>
              <Text style={styles.secondaryButtonText}>
                {getTranslations(language).providerPortfolio.title}
              </Text>
            </Pressable>

            <Text style={styles.sectionTitle}>{copy.notifications}</Text>
            {notifications.length ? (
              notifications.map((notification) => (
                <View key={notification.id} style={styles.notificationCard}>
                  <Text style={styles.notificationTitle}>{notification.title}</Text>
                  <Text style={styles.notificationMessage}>{notification.message}</Text>
                  <Text style={styles.notificationDate}>
                    {new Date(notification.created_at).toLocaleString(
                      language === 'fr' ? 'fr-FR' : 'en',
                      {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      },
                    )}
                  </Text>
                </View>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.muted}>{copy.noNotifications}</Text>
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
    backgroundColor: '#FFFFFF',
  },
  languageActive: { backgroundColor: '#EAF6EE', borderColor: '#16804A' },
  languageText: { color: '#16804A', fontSize: 11, fontWeight: '800' },
  brand: { color: '#16804A', fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  content: { padding: 20, paddingBottom: 45 },
  title: { color: '#15251A', fontSize: 28, fontWeight: '900' },
  subtitle: { color: '#66736A', fontSize: 15, lineHeight: 22, marginTop: 7, marginBottom: 20 },
  welcomeCard: {
    backgroundColor: '#EAF6EE',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  welcomeTitle: { color: '#15251A', fontSize: 18, fontWeight: '900' },
  welcomeStatus: { color: '#16804A', fontSize: 13, fontWeight: '700', marginTop: 8 },
  completion: { color: '#536358', fontSize: 13, marginTop: 7 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 17 },
  metricCard: {
    width: '48%',
    minHeight: 106,
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 14,
    padding: 15,
    justifyContent: 'center',
  },
  metricPrimary: { backgroundColor: '#16804A', borderColor: '#16804A' },
  metricValue: { color: '#15251A', fontSize: 27, fontWeight: '900' },
  metricValuePrimary: { color: '#FFFFFF' },
  metricLabel: { color: '#66736A', fontSize: 13, lineHeight: 18, marginTop: 4, fontWeight: '600' },
  metricLabelPrimary: { color: '#EAF6EE' },
  primaryButton: {
    minHeight: 49,
    borderRadius: 12,
    backgroundColor: '#16804A',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  secondaryButton: {
    minHeight: 49,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#16804A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#16804A', fontSize: 14, fontWeight: '800' },
  sectionTitle: {
    color: '#15251A',
    fontSize: 19,
    fontWeight: '900',
    marginTop: 25,
    marginBottom: 12,
  },
  notificationCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 13,
    padding: 14,
    marginBottom: 10,
  },
  notificationTitle: { color: '#15251A', fontSize: 14, fontWeight: '800' },
  notificationMessage: { color: '#536358', fontSize: 13, lineHeight: 19, marginTop: 6 },
  notificationDate: { color: '#7B887E', fontSize: 11, marginTop: 8 },
  emptyCard: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 12 },
  center: { paddingVertical: 55, alignItems: 'center' },
  muted: { color: '#66736A', marginTop: 9 },
  errorCard: { backgroundColor: '#FCECEC', borderRadius: 12, padding: 15 },
  errorText: { color: '#8E2525', lineHeight: 21 },
  retryButton: { marginTop: 10, alignSelf: 'flex-start' },
  retryText: { color: '#16804A', fontWeight: '800' },
});
