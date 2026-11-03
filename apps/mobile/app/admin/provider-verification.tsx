import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { getTranslations, type Language } from '../../lib/translations';
import { usePersistentLanguage } from '../../lib/usePersistentLanguage';

const PAGE_SIZE = 25;
const SIGNED_URL_SECONDS = 60;

type ApplicationStatus = 'pending' | 'requires_documents' | 'approved' | 'rejected';
type StatusFilter = 'all' | ApplicationStatus;
type ReviewAction = 'approve' | 'reject' | 'request_documents';

type ProviderApplication = {
  id: string;
  user_id: string;
  provider_type: 'individual' | 'business';
  contact_name: string;
  business_name: string | null;
  phone: string;
  service_location: string;
  profession: string;
  verification_status: ApplicationStatus;
  review_reason: string | null;
  created_at: string;
};

type ApplicationDocument = {
  id: string;
  application_id: string;
  storage_path: string;
  document_name: string;
  mime_type: string;
  document_type: string;
  created_at: string;
};

const DOCUMENT_TYPE_LABELS: Record<Language, Record<string, string>> = {
  en: {
    national_id: 'National ID',
    passport: 'Passport',
    professional_certificate: 'Professional Certificate',
    business_registration: 'Business Registration',
    other: 'Other supporting document',
  },
  fr: {
    national_id: 'Carte nationale d’identité',
    passport: 'Passeport',
    professional_certificate: 'Certificat professionnel',
    business_registration: 'Immatriculation de l’entreprise',
    other: 'Autre document justificatif',
  },
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Please try again.';
}

function getStatusLabel(
  status: ApplicationStatus,
  copy: ReturnType<typeof getTranslations>['adminDashboard'],
) {
  switch (status) {
    case 'requires_documents':
      return copy.requiresDocuments;
    case 'approved':
      return copy.approved;
    case 'rejected':
      return copy.rejected;
    default:
      return copy.pending;
  }
}

export default function AdminProviderVerificationDashboard() {
  const [language, setLanguage] = usePersistentLanguage();
  const copy = getTranslations(language).adminDashboard;
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [accessRetry, setAccessRetry] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [applications, setApplications] = useState<ProviderApplication[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const loadingListRef = useRef(false);
  const cursorRef = useRef<{ createdAt: string; id: string } | null>(null);
  const [listError, setListError] = useState('');
  const [listErrorKind, setListErrorKind] = useState<'list' | 'detail'>('list');
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<ApplicationDocument[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [reviewMessage, setReviewMessage] = useState('');

  const loadApplications = useCallback(async (reset: boolean, filter: StatusFilter) => {
    if (loadingListRef.current) return;

    loadingListRef.current = true;
    setLoadingList(true);
    setListError('');
    const currentCursor = reset ? null : cursorRef.current;
    if (reset) {
      cursorRef.current = null;
      setHasMore(false);
    }

    try {
      const { data, error } = await supabase.rpc('admin_list_provider_applications', {
        p_status: filter === 'all' ? null : filter,
        p_before_created_at: currentCursor?.createdAt ?? null,
        p_before_id: currentCursor?.id ?? null,
        p_page_size: PAGE_SIZE,
      });

      if (error) throw error;

      const page = (data ?? []) as ProviderApplication[];
      setApplications((current) => (reset ? page : [...current, ...page]));
      const lastApplication = page.at(-1);
      const nextCursor = lastApplication
        ? {
            createdAt: lastApplication.created_at,
            id: lastApplication.id,
          }
        : currentCursor;
      cursorRef.current = nextCursor;
      setHasMore(page.length === PAGE_SIZE);
    } catch (error) {
      setListErrorKind('list');
      setListError(getErrorMessage(error));
    } finally {
      loadingListRef.current = false;
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function checkAdminAccess() {
      setCheckingAccess(true);
      setAccessError('');

      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError) throw authError;
        if (!user) {
          if (active) setAuthorized(false);
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle();

        if (profileError) throw profileError;
        if (active) {
          const isAdmin = profile?.role === 'admin';
          setAuthorized(isAdmin);
          if (isAdmin) void loadApplications(true, 'pending');
        }
      } catch (error) {
        if (active) setAccessError(getErrorMessage(error));
      } finally {
        if (active) setCheckingAccess(false);
      }
    }

    void checkAdminAccess();
    return () => {
      active = false;
    };
  }, [accessRetry, loadApplications]);

  async function toggleApplication(applicationId: string) {
    if (selectedApplicationId === applicationId) {
      setSelectedApplicationId(null);
      setDocuments([]);
      return;
    }

    setSelectedApplicationId(applicationId);
    setDocuments([]);
    setLoadingDocuments(true);
    setListError('');

    try {
      const { data, error } = await supabase
        .from('provider_application_documents')
        .select(
          'id, application_id, storage_path, document_name, mime_type, document_type, created_at',
        )
        .eq('application_id', applicationId)
        .order('created_at', { ascending: true })
        .limit(100);

      if (error) throw error;
      setDocuments((data ?? []) as ApplicationDocument[]);
    } catch (error) {
      setListErrorKind('detail');
      setListError(`${copy.documentError} ${getErrorMessage(error)}`);
    } finally {
      setLoadingDocuments(false);
    }
  }

  async function openPrivateDocument(document: ApplicationDocument) {
    if (openingDocumentId) return;

    setOpeningDocumentId(document.id);
    setListError('');

    try {
      const { data, error } = await supabase.storage
        .from('provider-documents')
        .createSignedUrl(document.storage_path, SIGNED_URL_SECONDS);

      if (error) throw error;
      await Linking.openURL(data.signedUrl);
    } catch (error) {
      setListErrorKind('detail');
      setListError(`${copy.signedUrlError} ${getErrorMessage(error)}`);
    } finally {
      setOpeningDocumentId(null);
    }
  }

  function beginReview(action: ReviewAction) {
    setReviewAction(action);
    setReviewReason('');
    setReviewMessage('');
  }

  async function submitReview() {
    if (!reviewAction || savingReview) return;

    const reason = reviewReason.trim();
    if (reviewAction !== 'approve' && !reason) {
      setReviewMessage(copy.reasonRequired);
      return;
    }

    if (reason.length > 2000) {
      setReviewMessage(copy.reasonRequired);
      return;
    }

    const applicationId = selectedApplicationId;
    if (!applicationId) return;

    setSavingReview(true);
    setReviewMessage('');

    try {
      const { data, error } = await supabase.rpc('admin_review_provider_application', {
        p_application_id: applicationId,
        p_action: reviewAction,
        p_reason: reason || null,
      });

      if (error) throw error;

      const reviewed = (data ?? [])[0] as
        | {
            id: string;
            verification_status: ApplicationStatus;
            review_reason: string | null;
          }
        | undefined;

      if (!reviewed) throw new Error(copy.reviewError);

      setApplications((current) => {
        const updated = current.map((application) =>
          application.id === reviewed.id
            ? {
                ...application,
                verification_status: reviewed.verification_status,
                review_reason: reviewed.review_reason,
              }
            : application,
        );

        return statusFilter !== 'all' && reviewed.verification_status !== statusFilter
          ? updated.filter((application) => application.id !== reviewed.id)
          : updated;
      });
      setReviewAction(null);
      setReviewReason('');
      Alert.alert(copy.title, copy.reviewSuccess);
    } catch (error) {
      setReviewMessage(`${copy.reviewError} ${getErrorMessage(error)}`);
    } finally {
      setSavingReview(false);
    }
  }

  const statusTabs: StatusFilter[] = [
    'all',
    'pending',
    'requires_documents',
    'approved',
    'rejected',
  ];

  if (checkingAccess) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: copy.title }} />
        <ActivityIndicator size="large" color="#16804A" />
      </View>
    );
  }

  if (!authorized) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: copy.title }} />
        <Text style={styles.deniedTitle}>{copy.deniedTitle}</Text>
        <Text style={styles.deniedMessage}>{accessError || copy.deniedMessage}</Text>
        {accessError ? (
          <Pressable
            style={styles.primaryButton}
            onPress={() => setAccessRetry((current) => current + 1)}
          >
            <Text style={styles.primaryButtonText}>{copy.retry}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: copy.title }} />
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.brand}>NSOMEX CONNECT</Text>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.subtitle}>{copy.subtitle}</Text>
        </View>
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
                style={[
                  styles.languageOptionText,
                  language === option && styles.languageOptionTextActive,
                ]}
              >
                {option.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
      >
        {statusTabs.map((status) => {
          const label = status === 'all' ? copy.all : getStatusLabel(status, copy);
          return (
            <Pressable
              key={status}
              style={[styles.tab, statusFilter === status && styles.tabSelected]}
              onPress={() => {
                if (loadingList || status === statusFilter) return;
                setApplications([]);
                cursorRef.current = null;
                setHasMore(false);
                setSelectedApplicationId(null);
                setDocuments([]);
                setStatusFilter(status);
                void loadApplications(true, status);
              }}
              disabled={loadingList}
            >
              <Text style={[styles.tabText, statusFilter === status && styles.tabTextSelected]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {listError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>
              {listErrorKind === 'list' ? `${copy.listError} ${listError}` : listError}
            </Text>
            <Pressable onPress={() => void loadApplications(true, statusFilter)}>
              <Text style={styles.retryText}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : null}

        {applications.map((application) => {
          const expanded = selectedApplicationId === application.id;
          return (
            <View key={application.id} style={styles.applicationCard}>
              <Pressable
                style={styles.applicationHeader}
                onPress={() => void toggleApplication(application.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
              >
                <View style={styles.applicationCopy}>
                  <Text style={styles.applicantName}>{application.contact_name}</Text>
                  <Text style={styles.applicationMeta}>
                    {application.provider_type === 'business'
                      ? application.business_name || copy.businessName
                      : application.profession}
                  </Text>
                  <Text style={styles.applicationMeta}>
                    {new Date(application.created_at).toLocaleDateString(
                      language === 'fr' ? 'fr-FR' : 'en',
                    )}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusPill,
                    application.verification_status === 'approved' && styles.approvedPill,
                    application.verification_status === 'rejected' && styles.rejectedPill,
                    application.verification_status === 'requires_documents' &&
                      styles.requiresDocumentsPill,
                  ]}
                >
                  <Text style={styles.statusPillText}>
                    {getStatusLabel(application.verification_status, copy)}
                  </Text>
                </View>
              </Pressable>

              {expanded ? (
                <View style={styles.details}>
                  <Text style={styles.detailsHeading}>{copy.applicationDetails}</Text>
                  <DetailRow label={copy.contactName} value={application.contact_name} />
                  {application.business_name ? (
                    <DetailRow label={copy.businessName} value={application.business_name} />
                  ) : null}
                  <DetailRow label={copy.phone} value={application.phone} />
                  <DetailRow label={copy.location} value={application.service_location} />
                  <DetailRow label={copy.profession} value={application.profession} />
                  <DetailRow
                    label={copy.submitted}
                    value={new Date(application.created_at).toLocaleString(
                      language === 'fr' ? 'fr-FR' : 'en',
                    )}
                  />
                  {application.review_reason ? (
                    <DetailRow label={copy.reviewReason} value={application.review_reason} />
                  ) : null}

                  <Text style={styles.detailsHeading}>{copy.documents}</Text>
                  {loadingDocuments ? (
                    <ActivityIndicator color="#16804A" />
                  ) : documents.length === 0 ? (
                    <Text style={styles.emptyText}>{copy.noDocuments}</Text>
                  ) : (
                    documents.map((document) => (
                      <View key={document.id} style={styles.documentCard}>
                        <Text style={styles.documentName}>{document.document_name}</Text>
                        <Text style={styles.documentMeta}>
                          {DOCUMENT_TYPE_LABELS[language][document.document_type] ??
                            document.document_type.replaceAll('_', ' ')}{' '}
                          · {document.mime_type}
                        </Text>
                        <Text style={styles.documentMeta}>
                          {new Date(document.created_at).toLocaleString(
                            language === 'fr' ? 'fr-FR' : 'en',
                          )}
                        </Text>
                        <Pressable
                          style={styles.documentButton}
                          onPress={() => void openPrivateDocument(document)}
                          disabled={openingDocumentId !== null}
                        >
                          {openingDocumentId === document.id ? (
                            <ActivityIndicator color="#16804A" />
                          ) : (
                            <Text style={styles.documentButtonText}>{copy.viewDocument}</Text>
                          )}
                        </Pressable>
                      </View>
                    ))
                  )}

                  <View style={styles.reviewActions}>
                    <Pressable style={styles.approveButton} onPress={() => beginReview('approve')}>
                      <Text style={styles.actionButtonText}>{copy.approve}</Text>
                    </Pressable>
                    <Pressable style={styles.rejectButton} onPress={() => beginReview('reject')}>
                      <Text style={styles.actionButtonText}>{copy.reject}</Text>
                    </Pressable>
                    <Pressable
                      style={styles.requestButton}
                      onPress={() => beginReview('request_documents')}
                    >
                      <Text style={styles.actionButtonText}>{copy.requestDocuments}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}

        {loadingList && applications.length === 0 ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#16804A" />
            <Text style={styles.loadingText}>{copy.loading}</Text>
          </View>
        ) : null}

        {!loadingList && applications.length === 0 && !listError ? (
          <Text style={styles.emptyText}>{copy.empty}</Text>
        ) : null}

        {hasMore ? (
          <Pressable
            style={styles.loadMoreButton}
            onPress={() => void loadApplications(false, statusFilter)}
            disabled={loadingList}
          >
            {loadingList ? (
              <ActivityIndicator color="#16804A" />
            ) : (
              <Text style={styles.loadMoreText}>{copy.loadMore}</Text>
            )}
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal
        visible={reviewAction !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!savingReview) setReviewAction(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {reviewAction === 'approve'
                ? copy.approve
                : reviewAction === 'reject'
                  ? copy.reject
                  : copy.requestDocuments}
            </Text>
            {reviewAction !== 'approve' ? (
              <>
                <Text style={styles.modalHint}>
                  {reviewAction === 'reject' ? copy.rejectReasonHint : copy.requestReasonHint}
                </Text>
                <TextInput
                  style={styles.reasonInput}
                  placeholder={copy.reasonPlaceholder}
                  placeholderTextColor="#89958B"
                  value={reviewReason}
                  onChangeText={setReviewReason}
                  multiline
                  maxLength={2000}
                  textAlignVertical="top"
                />
              </>
            ) : null}
            {reviewMessage ? <Text style={styles.reviewError}>{reviewMessage}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable
                style={styles.cancelButton}
                onPress={() => setReviewAction(null)}
                disabled={savingReview}
              >
                <Text style={styles.cancelButtonText}>{copy.cancel}</Text>
              </Pressable>
              <Pressable
                style={styles.confirmButton}
                onPress={() => void submitReview()}
                disabled={savingReview}
              >
                {savingReview ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmButtonText}>{copy.confirm}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable style={styles.detailValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F8F5' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#F5F8F5',
  },
  deniedTitle: { color: '#15251A', fontSize: 21, fontWeight: '900' },
  deniedMessage: {
    color: '#66736A',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 9,
  },
  header: {
    paddingTop: 20,
    paddingHorizontal: 18,
    paddingBottom: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2EAE3',
  },
  headerText: { flex: 1, marginRight: 10 },
  brand: { color: '#16804A', fontWeight: '900', letterSpacing: 1.1, fontSize: 11 },
  title: { color: '#15251A', fontSize: 21, fontWeight: '900', marginTop: 7 },
  subtitle: { color: '#66736A', fontSize: 12, marginTop: 4 },
  languageOptions: { flexDirection: 'row', gap: 5 },
  languageOption: {
    borderWidth: 1,
    borderColor: '#DDE6DE',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#FFFFFF',
  },
  languageOptionActive: { backgroundColor: '#EAF6EE', borderColor: '#16804A' },
  languageOptionText: { color: '#66736A', fontSize: 11, fontWeight: '700' },
  languageOptionTextActive: { color: '#16804A' },
  tabs: { paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  tab: {
    borderWidth: 1,
    borderColor: '#DDE6DE',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  tabSelected: { backgroundColor: '#16804A', borderColor: '#16804A' },
  tabText: { color: '#526258', fontSize: 12, fontWeight: '700' },
  tabTextSelected: { color: '#FFFFFF' },
  list: { flex: 1 },
  listContent: { padding: 14, paddingBottom: 35 },
  applicationCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 14,
    marginBottom: 11,
    overflow: 'hidden',
  },
  applicationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
  },
  applicationCopy: { flex: 1, marginRight: 10 },
  applicantName: { color: '#15251A', fontSize: 15, fontWeight: '800' },
  applicationMeta: { color: '#66736A', fontSize: 12, marginTop: 4 },
  statusPill: {
    backgroundColor: '#FFF3E6',
    borderRadius: 15,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  approvedPill: { backgroundColor: '#EAF6EE' },
  rejectedPill: { backgroundColor: '#FDEDEC' },
  requiresDocumentsPill: { backgroundColor: '#FFF8DD' },
  statusPillText: { color: '#526258', fontSize: 10, fontWeight: '800' },
  details: {
    borderTopWidth: 1,
    borderTopColor: '#E8EEE9',
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  detailsHeading: {
    color: '#263B2D',
    fontSize: 14,
    fontWeight: '900',
    marginTop: 15,
    marginBottom: 8,
  },
  detailRow: { marginTop: 7 },
  detailLabel: { color: '#78847B', fontSize: 11, fontWeight: '700' },
  detailValue: { color: '#263B2D', fontSize: 13, lineHeight: 19, marginTop: 2 },
  documentCard: {
    backgroundColor: '#F8FAF8',
    borderRadius: 10,
    padding: 11,
    marginTop: 7,
  },
  documentName: { color: '#263B2D', fontWeight: '800', fontSize: 13 },
  documentMeta: { color: '#66736A', fontSize: 11, marginTop: 4 },
  documentButton: {
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 9,
    marginTop: 10,
  },
  documentButtonText: { color: '#16804A', fontWeight: '800', fontSize: 12 },
  reviewActions: { gap: 8, marginTop: 16 },
  approveButton: {
    backgroundColor: '#16804A',
    borderRadius: 9,
    alignItems: 'center',
    padding: 12,
  },
  rejectButton: {
    backgroundColor: '#A93226',
    borderRadius: 9,
    alignItems: 'center',
    padding: 12,
  },
  requestButton: {
    backgroundColor: '#FFFFFF',
    borderColor: '#16804A',
    borderWidth: 1,
    borderRadius: 9,
    alignItems: 'center',
    padding: 12,
  },
  actionButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  emptyText: { color: '#66736A', fontSize: 13, lineHeight: 20, marginTop: 10 },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  loadingText: { color: '#66736A', fontSize: 13 },
  loadMoreButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 10,
    marginTop: 5,
  },
  loadMoreText: { color: '#16804A', fontWeight: '800' },
  errorBanner: { backgroundColor: '#FDEDEC', padding: 12, borderRadius: 10, marginBottom: 12 },
  errorText: { color: '#8D332B', lineHeight: 19, fontSize: 12 },
  retryText: { color: '#16804A', fontWeight: '800', marginTop: 8 },
  primaryButton: {
    backgroundColor: '#16804A',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 20,
    marginTop: 18,
  },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '800' },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 22,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  modalCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 19 },
  modalTitle: { color: '#15251A', fontSize: 19, fontWeight: '900' },
  modalHint: { color: '#66736A', fontSize: 13, lineHeight: 20, marginTop: 8 },
  reasonInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: '#DDE6DE',
    borderRadius: 10,
    padding: 12,
    color: '#263B2D',
    marginTop: 13,
  },
  reviewError: { color: '#A93226', fontSize: 12, lineHeight: 18, marginTop: 9 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 17 },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#DDE6DE',
    borderRadius: 9,
    paddingHorizontal: 15,
    minHeight: 43,
    justifyContent: 'center',
  },
  cancelButtonText: { color: '#526258', fontWeight: '700' },
  confirmButton: {
    backgroundColor: '#16804A',
    borderRadius: 9,
    paddingHorizontal: 15,
    minHeight: 43,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmButtonText: { color: '#FFFFFF', fontWeight: '800' },
});
