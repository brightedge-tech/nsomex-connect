import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '../../../lib/supabase';
import { getTranslations, type Language } from '../../../lib/translations';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

type ProviderType = 'individual' | 'business';
type DocumentType =
  'national_id' | 'passport' | 'professional_certificate' | 'business_registration' | 'other';

type Application = {
  id: string;
  user_id: string;
  provider_type: ProviderType;
  verification_status: string;
  review_reason: string | null;
};

type SavedDocument = {
  document_type: DocumentType;
  document_name: string;
};

type PendingDocument = {
  id: string;
  asset: DocumentPicker.DocumentPickerAsset;
  documentType: DocumentType;
  storagePath?: string;
};

type ProviderNotification = {
  title: string;
  message: string;
  created_at: string;
};

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  national_id: 'National ID',
  passport: 'Passport',
  professional_certificate: 'Professional Certificate',
  business_registration: 'Business Registration',
  other: 'Other supporting document',
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Please try again.';
}

function getRequiredDocuments(providerType: ProviderType) {
  if (providerType === 'business') {
    return [
      {
        key: 'business_registration',
        label: 'Business Registration',
        isComplete: (types: DocumentType[]) => types.includes('business_registration'),
      },
      {
        key: 'representative_identity',
        label: "Representative's National ID or Passport",
        isComplete: (types: DocumentType[]) =>
          types.includes('national_id') || types.includes('passport'),
      },
    ];
  }

  return [
    {
      key: 'provider_identity',
      label: 'National ID or Passport',
      isComplete: (types: DocumentType[]) =>
        types.includes('national_id') || types.includes('passport'),
    },
  ];
}

export default function ProviderVerificationScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const applicationId = Array.isArray(routeId) ? routeId[0] : routeId;
  const [language, setLanguage] = useState<Language>('en');
  const copy = getTranslations(language).providerVerification;
  const [application, setApplication] = useState<Application | null>(null);
  const [savedDocuments, setSavedDocuments] = useState<SavedDocument[]>([]);
  const [providerNotification, setProviderNotification] = useState<ProviderNotification | null>(
    null,
  );
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>([]);
  const [selectedDocumentType, setSelectedDocumentType] = useState<DocumentType>('national_id');
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;

    async function loadApplication() {
      setLoading(true);
      setErrorMessage('');

      if (!applicationId) {
        setErrorMessage('This verification link is missing its application ID.');
        setLoading(false);
        return;
      }

      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError) throw authError;
        if (!user) {
          throw new Error('Sign in to the account used to start this application.');
        }

        const { data: applicationData, error: applicationError } = await supabase
          .from('provider_applications')
          .select('id, user_id, provider_type, verification_status, review_reason')
          .eq('id', applicationId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (applicationError) throw applicationError;
        if (!applicationData || applicationData.user_id !== user.id) {
          throw new Error(
            'This application does not exist or you do not have permission to access it.',
          );
        }
        if (
          applicationData.provider_type !== 'individual' &&
          applicationData.provider_type !== 'business'
        ) {
          throw new Error('This application has an unsupported provider type.');
        }

        const { data: documentData, error: documentsError } = await supabase
          .from('provider_application_documents')
          .select('document_type, document_name')
          .eq('application_id', applicationData.id)
          .eq('user_id', user.id);

        if (documentsError) throw documentsError;
        const { data: notificationData, error: notificationError } = await supabase
          .from('notifications')
          .select('title, message, created_at')
          .eq('user_id', user.id)
          .eq('type', 'verification_update')
          .eq('related_entity_type', 'provider_application')
          .eq('related_entity_id', applicationData.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (notificationError) throw notificationError;
        if (!active) return;

        setApplication(applicationData);
        setProviderNotification(notificationData);
        setSavedDocuments(
          (documentData ?? []).map((document) => ({
            document_type: document.document_type as DocumentType,
            document_name: document.document_name,
          })),
        );
      } catch (error) {
        if (active) {
          setErrorMessage(
            getErrorMessage(error) || 'The application could not be loaded. Please try again.',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadApplication();
    return () => {
      active = false;
    };
  }, [applicationId]);

  const documentTypeOptions = useMemo(() => {
    const requiredTypes: DocumentType[] =
      application?.provider_type === 'business'
        ? ['business_registration', 'national_id', 'passport']
        : ['national_id', 'passport'];

    return [...requiredTypes, 'professional_certificate', 'other'] as DocumentType[];
  }, [application?.provider_type]);

  const requiredChecks = useMemo(() => {
    if (!application) return [];

    const availableTypes = [
      ...savedDocuments.map((document) => document.document_type),
      ...pendingDocuments.map((document) => document.documentType),
    ];

    return getRequiredDocuments(application.provider_type).map((required) => ({
      ...required,
      complete: required.isComplete(availableTypes),
    }));
  }, [application, pendingDocuments, savedDocuments]);

  const requiredDocumentsComplete =
    requiredChecks.length > 0 && requiredChecks.every((item) => item.complete);
  const statusLabel =
    application?.verification_status === 'approved'
      ? copy.approved
      : application?.verification_status === 'rejected'
        ? copy.rejected
        : application?.verification_status === 'requires_documents'
          ? copy.moreDocuments
          : copy.pending;

  async function chooseDocuments() {
    if (!application || selecting || uploading) return;

    setSelecting(true);
    setErrorMessage('');
    setNotice('');

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...ACCEPTED_MIME_TYPES],
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const validDocuments: PendingDocument[] = [];
      const invalidFiles: string[] = [];

      for (const asset of result.assets) {
        if (!ACCEPTED_MIME_TYPES.includes(asset.mimeType as (typeof ACCEPTED_MIME_TYPES)[number])) {
          invalidFiles.push(`${asset.name}: unsupported file type`);
          continue;
        }

        if (asset.size !== undefined && asset.size > MAX_FILE_SIZE) {
          invalidFiles.push(`${asset.name}: larger than 20 MB`);
          continue;
        }

        validDocuments.push({
          id: `${selectedDocumentType}:${asset.uri}`,
          asset,
          documentType: selectedDocumentType,
        });
      }

      setPendingDocuments((current) => {
        const existingIds = new Set(current.map((document) => document.id));
        return [...current, ...validDocuments.filter((document) => !existingIds.has(document.id))];
      });

      if (invalidFiles.length > 0) {
        setErrorMessage(`${invalidFiles.join('. ')}. Choose PDF, JPEG or PNG files up to 20 MB.`);
      }
    } catch (error) {
      setErrorMessage(`Document selection failed. ${getErrorMessage(error)}`);
    } finally {
      setSelecting(false);
    }
  }

  function removePendingDocument(documentId: string) {
    setPendingDocuments((current) => current.filter((document) => document.id !== documentId));
  }

  async function uploadDocuments() {
    if (!application || uploading || pendingDocuments.length === 0 || !requiredDocumentsComplete) {
      return;
    }

    setUploading(true);
    setErrorMessage('');
    setNotice('');
    setUploadProgress('');

    const documentsToUpload = pendingDocuments.map((document) => ({
      ...document,
    }));
    const completedIds = new Set<string>();
    let updatedSavedDocuments = [...savedDocuments];
    let currentDocumentName = '';

    try {
      for (let index = 0; index < documentsToUpload.length; index += 1) {
        const document = documentsToUpload[index];
        currentDocumentName = document.asset.name;
        setUploadProgress(`Uploading ${index + 1} of ${documentsToUpload.length}`);

        let storagePath = document.storagePath;
        if (!storagePath) {
          const response = await fetch(document.asset.uri);
          if (!response.ok) {
            throw new Error(`Could not read ${document.asset.name}.`);
          }

          const fileData = await response.arrayBuffer();
          if (fileData.byteLength > MAX_FILE_SIZE) {
            throw new Error(`${document.asset.name} is larger than 20 MB.`);
          }

          const safeName = document.asset.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const uniqueName =
            `${Date.now().toString(36)}-` + `${Math.random().toString(36).slice(2)}-${safeName}`;
          storagePath = `${application.user_id}/${application.id}/${uniqueName}`;

          const { error: uploadError } = await supabase.storage
            .from('provider-documents')
            .upload(storagePath, fileData, {
              contentType: document.asset.mimeType ?? undefined,
              upsert: false,
            });

          if (uploadError) throw uploadError;

          document.storagePath = storagePath;
          setPendingDocuments((current) =>
            current.map((item) => (item.id === document.id ? { ...item, storagePath } : item)),
          );
        }

        const { error: metadataError } = await supabase
          .from('provider_application_documents')
          .insert({
            application_id: application.id,
            user_id: application.user_id,
            storage_path: storagePath,
            document_name: document.asset.name,
            mime_type: document.asset.mimeType,
            document_type: document.documentType,
          });

        if (metadataError) throw metadataError;

        completedIds.add(document.id);
        updatedSavedDocuments = [
          ...updatedSavedDocuments,
          {
            document_type: document.documentType,
            document_name: document.asset.name,
          },
        ];
        setSavedDocuments(updatedSavedDocuments);
      }

      setPendingDocuments((current) =>
        current.filter((document) => !completedIds.has(document.id)),
      );
      setNotice(
        application.verification_status === 'approved'
          ? 'Your documents were saved. Your application remains approved.'
          : application.verification_status === 'rejected'
            ? 'Your documents were saved. Your application status remains unchanged; contact NSOMEX support if you need a new review.'
            : 'Your required documents are saved. Your application is awaiting NSOMEX administrator review.',
      );
    } catch (error) {
      setPendingDocuments((current) =>
        current.filter((document) => !completedIds.has(document.id)),
      );
      setErrorMessage(
        `Could not finish saving ${currentDocumentName || 'your documents'}. ${
          completedIds.size > 0
            ? 'Some documents were saved; the remaining file is still available to retry.'
            : 'No success was recorded. Your selected file is available to retry.'
        } ${getErrorMessage(error)}`,
      );
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Verify your documents' }} />
        <ActivityIndicator size="large" color="#16804A" />
        <Text style={styles.loadingText}>Loading your application…</Text>
      </View>
    );
  }

  if (errorMessage && !application) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Verify your documents' }} />
        <Text style={styles.errorTitle}>Unable to open verification</Text>
        <Text style={styles.errorText}>{errorMessage}</Text>
      </View>
    );
  }

  if (!application) return null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: 'Verify your documents' }} />

      <View style={styles.languageOptions}>
        <Text style={styles.languageLabel}>{copy.language}</Text>
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

      <Text style={styles.brand}>NSOMEX CONNECT</Text>
      <Text style={styles.title}>Verify your documents</Text>
      <Text style={styles.subtitle}>
        Provide the required documents to verify your{' '}
        {application.provider_type === 'business' ? 'business' : 'provider'} application.
      </Text>

      <View style={styles.statusCard}>
        <Text style={styles.statusCaption}>APPLICATION STATUS</Text>
        <Text style={styles.statusValue}>{statusLabel}</Text>
        <Text style={styles.statusHint}>
          Only an NSOMEX administrator can change your verification status.
        </Text>
      </View>

      {application.verification_status === 'requires_documents' || application.review_reason ? (
        <View style={styles.reviewCard}>
          <Text style={styles.reviewTitle}>
            {application.verification_status === 'requires_documents'
              ? copy.moreDocuments
              : copy.reviewReason}
          </Text>
          {application.review_reason ? (
            <Text style={styles.reviewReason}>{application.review_reason}</Text>
          ) : null}
        </View>
      ) : null}

      {providerNotification ? (
        <View style={styles.notificationCard}>
          <Text style={styles.notificationTitle}>{copy.submittedNotice}</Text>
          <Text style={styles.notificationMessage}>{providerNotification.message}</Text>
          <Text style={styles.notificationDate}>
            {new Date(providerNotification.created_at).toLocaleString(
              language === 'fr' ? 'fr-FR' : 'en',
            )}
          </Text>
        </View>
      ) : null}

      <Text style={styles.heading}>Required documents</Text>
      <Text style={styles.helper}>
        Add all required documents before submitting for review. National ID or Passport satisfies
        the identity requirement.
      </Text>

      {requiredChecks.map((item) => (
        <View key={item.key} style={styles.requirementRow}>
          <View style={[styles.checkMark, item.complete && styles.checkMarkComplete]}>
            <Text style={[styles.checkMarkText, item.complete && styles.checkMarkTextComplete]}>
              {item.complete ? '✓' : '!'}
            </Text>
          </View>
          <View style={styles.requirementCopy}>
            <Text style={styles.requirementTitle}>{item.label}</Text>
            <Text style={styles.requirementState}>{item.complete ? 'Complete' : 'Missing'}</Text>
          </View>
        </View>
      ))}

      {savedDocuments.length > 0 && (
        <>
          <Text style={styles.subheading}>Documents received</Text>
          {savedDocuments.map((document, index) => (
            <View
              key={`${document.document_type}-${document.document_name}-${index}`}
              style={styles.savedDocument}
            >
              <Text style={styles.savedDocumentTitle}>
                {DOCUMENT_LABELS[document.document_type]}
              </Text>
              <Text style={styles.savedDocumentName}>{document.document_name}</Text>
            </View>
          ))}
        </>
      )}

      <Text style={styles.heading}>Add documents</Text>
      <Text style={styles.helper}>
        Select a document category, then choose one or more PDF, JPEG or PNG files. Each file must
        be 20 MB or smaller.
      </Text>

      <Text style={styles.label}>Document type</Text>
      <View style={styles.typeOptions}>
        {documentTypeOptions.map((documentType) => (
          <Pressable
            key={documentType}
            style={[
              styles.typeOption,
              selectedDocumentType === documentType && styles.typeOptionSelected,
            ]}
            onPress={() => setSelectedDocumentType(documentType)}
            disabled={uploading || selecting}
          >
            <Text
              style={[
                styles.typeOptionText,
                selectedDocumentType === documentType && styles.typeOptionTextSelected,
              ]}
            >
              {DOCUMENT_LABELS[documentType]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.outlineButton, (selecting || uploading) && styles.disabled]}
        onPress={chooseDocuments}
        disabled={selecting || uploading}
      >
        {selecting ? (
          <ActivityIndicator color="#16804A" />
        ) : (
          <Text style={styles.outlineButtonText}>Choose file(s)</Text>
        )}
      </Pressable>

      {pendingDocuments.map((document) => (
        <View key={document.id} style={styles.pendingRow}>
          <View style={styles.pendingCopy}>
            <Text style={styles.pendingName}>{document.asset.name}</Text>
            <Text style={styles.pendingType}>
              {DOCUMENT_LABELS[document.documentType]}
              {document.storagePath ? ' · uploaded, metadata needs retry' : ''}
            </Text>
            <Text style={styles.pendingSize}>
              {document.asset.size === undefined
                ? 'File size checked before upload'
                : `${(document.asset.size / (1024 * 1024)).toFixed(2)} MB`}
            </Text>
          </View>
          <Pressable
            onPress={() => removePendingDocument(document.id)}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${document.asset.name}`}
          >
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        </View>
      ))}

      {errorMessage ? (
        <View style={styles.messageError}>
          <Text style={styles.messageErrorText}>{errorMessage}</Text>
        </View>
      ) : null}
      {notice ? (
        <View style={styles.messageSuccess}>
          <Text style={styles.messageSuccessText}>{notice}</Text>
        </View>
      ) : null}

      {!requiredDocumentsComplete && (
        <Text style={styles.validationHint}>
          Select documents for every missing requirement to continue.
        </Text>
      )}

      <Pressable
        style={[
          styles.primaryButton,
          (uploading || pendingDocuments.length === 0 || !requiredDocumentsComplete) &&
            styles.disabled,
        ]}
        onPress={uploadDocuments}
        disabled={uploading || pendingDocuments.length === 0 || !requiredDocumentsComplete}
      >
        {uploading ? (
          <View style={styles.progressContent}>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.buttonText}>{uploadProgress}</Text>
          </View>
        ) : (
          <Text style={styles.buttonText}>
            {requiredDocumentsComplete ? 'Submit for verification' : 'Complete required documents'}
          </Text>
        )}
      </Pressable>

      <Text style={styles.footer}>
        Your documents are stored privately and can only be reviewed by you and authorised NSOMEX
        administrators.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F8F5' },
  content: { padding: 22, paddingBottom: 50 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
    backgroundColor: '#F5F8F5',
  },
  loadingText: { marginTop: 14, color: '#66736A', fontSize: 15 },
  errorTitle: {
    color: '#15251A',
    fontSize: 21,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorText: {
    color: '#8D332B',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 10,
  },
  languageOptions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 7,
    marginBottom: 18,
  },
  languageLabel: { color: '#66736A', fontSize: 12, marginRight: 2 },
  languageOption: {
    borderWidth: 1,
    borderColor: '#DDE6DE',
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#FFFFFF',
  },
  languageOptionActive: { backgroundColor: '#EAF6EE', borderColor: '#16804A' },
  languageOptionText: { color: '#66736A', fontSize: 11, fontWeight: '700' },
  languageOptionTextActive: { color: '#16804A' },
  brand: { color: '#16804A', fontWeight: '800', letterSpacing: 1.5 },
  title: {
    fontSize: 29,
    fontWeight: '800',
    color: '#15251A',
    marginTop: 18,
  },
  subtitle: {
    color: '#66736A',
    fontSize: 15,
    lineHeight: 23,
    marginTop: 9,
  },
  statusCard: {
    backgroundColor: '#EAF6EE',
    borderColor: '#C8E4D0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginTop: 22,
  },
  statusCaption: {
    color: '#66736A',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  statusValue: {
    color: '#16804A',
    fontSize: 17,
    fontWeight: '800',
    marginTop: 5,
  },
  statusHint: { color: '#526258', lineHeight: 20, marginTop: 6 },
  reviewCard: {
    backgroundColor: '#FFF8DD',
    borderColor: '#F1DE9B',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
  },
  reviewTitle: { color: '#735315', fontWeight: '800' },
  reviewReason: { color: '#526258', lineHeight: 21, marginTop: 7 },
  notificationCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2EAE3',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },
  notificationTitle: { color: '#16804A', fontWeight: '800' },
  notificationMessage: { color: '#526258', lineHeight: 21, marginTop: 6 },
  notificationDate: { color: '#78847B', fontSize: 11, marginTop: 7 },
  heading: {
    fontSize: 19,
    fontWeight: '800',
    color: '#15251A',
    marginTop: 27,
    marginBottom: 9,
  },
  subheading: {
    fontSize: 15,
    fontWeight: '800',
    color: '#263B2D',
    marginTop: 20,
    marginBottom: 8,
  },
  helper: { color: '#66736A', lineHeight: 21 },
  requirementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E5ECE6',
    borderWidth: 1,
    borderRadius: 12,
    padding: 13,
    marginTop: 9,
  },
  checkMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFF3E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMarkComplete: { backgroundColor: '#EAF6EE' },
  checkMarkText: { color: '#9B5B1D', fontWeight: '800' },
  checkMarkTextComplete: { color: '#16804A' },
  requirementCopy: { flex: 1, marginLeft: 11 },
  requirementTitle: { color: '#263B2D', fontWeight: '700' },
  requirementState: { color: '#66736A', fontSize: 12, marginTop: 3 },
  savedDocument: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginTop: 7,
  },
  savedDocumentTitle: { color: '#263B2D', fontWeight: '700' },
  savedDocumentName: { color: '#66736A', fontSize: 13, marginTop: 4 },
  label: {
    color: '#263B2D',
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  typeOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeOption: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DDE6DE',
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  typeOptionSelected: {
    backgroundColor: '#EAF6EE',
    borderColor: '#16804A',
  },
  typeOptionText: { color: '#526258', fontSize: 13, fontWeight: '700' },
  typeOptionTextSelected: { color: '#16804A' },
  outlineButton: {
    backgroundColor: '#FFFFFF',
    borderColor: '#16804A',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderRadius: 12,
    padding: 15,
    alignItems: 'center',
    marginTop: 16,
  },
  outlineButtonText: { color: '#16804A', fontWeight: '800', fontSize: 15 },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginTop: 9,
  },
  pendingCopy: { flex: 1, marginRight: 12 },
  pendingName: { color: '#263B2D', fontWeight: '700' },
  pendingType: { color: '#66736A', fontSize: 12, marginTop: 4 },
  pendingSize: { color: '#78847B', fontSize: 12, marginTop: 3 },
  removeText: { color: '#C0392B', fontWeight: '700' },
  messageError: {
    backgroundColor: '#FDEDEC',
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
  },
  messageErrorText: { color: '#8D332B', lineHeight: 20 },
  messageSuccess: {
    backgroundColor: '#EAF6EE',
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
  },
  messageSuccessText: { color: '#16804A', lineHeight: 20, fontWeight: '700' },
  validationHint: {
    color: '#8D5A22',
    lineHeight: 20,
    marginTop: 16,
  },
  primaryButton: {
    backgroundColor: '#16804A',
    padding: 17,
    borderRadius: 13,
    alignItems: 'center',
    marginTop: 18,
  },
  disabled: { opacity: 0.55 },
  progressContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  footer: {
    textAlign: 'center',
    color: '#78847B',
    marginTop: 20,
    lineHeight: 20,
  },
});
