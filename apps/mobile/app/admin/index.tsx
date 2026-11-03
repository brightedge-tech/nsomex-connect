import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { getTranslations, type Language } from '../../lib/translations';
import { usePersistentLanguage } from '../../lib/usePersistentLanguage';

type Section =
  | 'overview'
  | 'providers'
  | 'customers'
  | 'catalog'
  | 'marketplace'
  | 'reports'
  | 'audit'
  | 'settings';
type CatalogType = 'category' | 'profession' | 'service';
type Row = Record<string, unknown> & { id: string };
type Summary = {
  total_customers: number;
  total_providers: number;
  pending_applications: number;
  verified_providers: number;
  rejected_applications: number;
  active_service_listings: number;
  total_requests: number;
  active_bookings: number;
  completed_bookings: number;
  cancelled_bookings: number;
};
type Account = {
  id: string;
  profile_id: string;
  provider_id?: string | null;
  user_id: string;
  display_name: string | null;
  professional_name: string | null;
  phone: string | null;
  email: string | null;
  account_status: string;
  account_status_reason: string | null;
  provider_status: string | null;
  suspension_reason: string | null;
  created_at: string;
};
type CatalogItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  category_id?: string;
  profession_id?: string;
};
type ProviderDetails = { profile: string[]; services: string[]; areas: string[] };
type CustomerDetails = { requests: number; bookings: number };

const PAGE_SIZE = 25;
const REQUEST_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'in_progress',
  'completed',
  'disputed',
];
const BOOKING_STATUSES = [
  'pending',
  'accepted',
  'provider_on_way',
  'arrived',
  'in_progress',
  'provider_completed',
  'completed',
  'cancelled',
  'disputed',
];
const REPORT_STATUSES = ['open', 'investigating', 'resolved', 'dismissed'];

function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function formatDate(value: unknown, language: Language) {
  if (typeof value !== 'string') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(language === 'fr' ? 'fr-FR' : 'en');
}

export default function AdminDashboardScreen() {
  const params = useLocalSearchParams<{ language?: string }>();
  const [language, setLanguage] = usePersistentLanguage(params.language);
  const strings = getTranslations(language);
  const copy = strings.adminConsole;
  const [section, setSection] = useState<Section>('overview');
  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [loading, setLoading] = useState(false);
  const loadingRecordsRef = useRef(false);
  const recordsRef = useRef<Row[]>([]);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activity, setActivity] = useState<Row[]>([]);
  const [records, setRecords] = useState<Row[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [marketplaceKind, setMarketplaceKind] = useState<'requests' | 'bookings'>('requests');
  const [catalogType, setCatalogType] = useState<CatalogType>('category');
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [catalogCategories, setCatalogCategories] = useState<CatalogItem[]>([]);
  const [catalogProfessions, setCatalogProfessions] = useState<CatalogItem[]>([]);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemSlug, setItemSlug] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemParent, setItemParent] = useState('');
  const [itemActive, setItemActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusTarget, setStatusTarget] = useState<Account | null>(null);
  const [suspensionReason, setSuspensionReason] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [sessionEmail, setSessionEmail] = useState('');
  const [providerDetails, setProviderDetails] = useState<Record<string, ProviderDetails>>({});
  const [loadingProviderDetails, setLoadingProviderDetails] = useState('');
  const [customerDetails, setCustomerDetails] = useState<Record<string, CustomerDetails>>({});
  const [loadingCustomerDetails, setLoadingCustomerDetails] = useState('');

  const sections = useMemo(
    () =>
      [
        ['overview', copy.overview],
        ['providers', copy.providers],
        ['customers', copy.customers],
        ['catalog', copy.catalog],
        ['marketplace', copy.marketplace],
        ['reports', copy.reports],
        ['audit', copy.audit],
        ['settings', copy.settings],
      ] as const,
    [copy],
  );

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summaryResult, activityResult] = await Promise.all([
        supabase.rpc('admin_dashboard_summary'),
        supabase
          .from('admin_actions')
          .select('id, action, target_type, target_id, created_at')
          .order('created_at', { ascending: false })
          .limit(8),
      ]);
      if (summaryResult.error) throw summaryResult.error;
      if (activityResult.error) throw activityResult.error;
      const row = asRows<Summary>(summaryResult.data)[0];
      if (!row) throw new Error('Empty administrator summary');
      setSummary(row);
      setActivity((activityResult.data ?? []) as Row[]);
    } catch (reason) {
      console.error('Unable to load administrator overview', reason);
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [copy.loadError]);

  const loadRecords = useCallback(
    async (reset = true) => {
      if (loadingRecordsRef.current) return;
      loadingRecordsRef.current = true;
      setLoading(true);
      setError('');
      try {
        let result:
          | { data: unknown; error: { message: string } | null }
          | { data: Row[] | null; error: { message: string } | null };
        if (section === 'providers' || section === 'customers') {
          const current = reset ? [] : recordsRef.current;
          const last = current.at(-1) as Account | undefined;
          result = await supabase.rpc('admin_list_accounts', {
            p_kind: section,
            p_status: statusFilter || null,
            p_search: appliedSearch || null,
            p_before_created_at: reset ? null : (last?.created_at ?? null),
            p_before_id: reset ? null : (last?.id ?? null),
            p_page_size: PAGE_SIZE,
          });
        } else if (section === 'marketplace') {
          const current = reset ? [] : recordsRef.current;
          let query = supabase
            .from(marketplaceKind === 'requests' ? 'service_requests' : 'bookings')
            .select(
              marketplaceKind === 'requests'
                ? 'id, customer_id, service_id, description, status, created_at'
                : 'id, request_id, customer_id, provider_id, service_id, status, scheduled_date, scheduled_time, created_at',
            )
            .order('created_at', { ascending: false })
            .order('id', { ascending: false });
          if (statusFilter) query = query.eq('status', statusFilter);
          result = await query.range(current.length, current.length + PAGE_SIZE - 1);
        } else if (section === 'reports') {
          let query = supabase
            .from('reports')
            .select(
              'id, reporter_id, reported_user_id, booking_id, reason, description, status, created_at, updated_at',
            )
            .order('created_at', { ascending: false })
            .order('id', { ascending: false });
          if (statusFilter) query = query.eq('status', statusFilter);
          const offset = reset ? 0 : recordsRef.current.length;
          result = await query.range(offset, offset + PAGE_SIZE - 1);
        } else if (section === 'audit') {
          const offset = reset ? 0 : recordsRef.current.length;
          result = await supabase
            .from('admin_actions')
            .select('id, action, target_type, target_id, created_at')
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(offset, offset + PAGE_SIZE - 1);
        } else {
          setLoading(false);
          return;
        }
        if (result.error) throw result.error;
        let page = (result.data ?? []) as Row[];
        if (section === 'marketplace' && page.length) {
          const customerIds = [
            ...new Set(page.map((item) => String(item.customer_id ?? '')).filter(Boolean)),
          ];
          const providerIds = [
            ...new Set(page.map((item) => String(item.provider_id ?? '')).filter(Boolean)),
          ];
          const serviceIds = [
            ...new Set(page.map((item) => String(item.service_id ?? '')).filter(Boolean)),
          ];
          const [customers, providers, services] = await Promise.all([
            customerIds.length
              ? supabase
                  .from('profiles')
                  .select('id, display_name, first_name, last_name')
                  .in('id', customerIds)
              : Promise.resolve({ data: [], error: null }),
            providerIds.length
              ? supabase
                  .from('provider_profiles')
                  .select('id, professional_name')
                  .in('id', providerIds)
              : Promise.resolve({ data: [], error: null }),
            serviceIds.length
              ? supabase.from('services').select('id, name').in('id', serviceIds)
              : Promise.resolve({ data: [], error: null }),
          ]);
          if (customers.error) throw customers.error;
          if (providers.error) throw providers.error;
          if (services.error) throw services.error;
          const customerNames = new Map(
            (customers.data ?? []).map((item) => [
              item.id,
              item.display_name ||
                [item.first_name, item.last_name].filter(Boolean).join(' ') ||
                item.id,
            ]),
          );
          const providerNames = new Map(
            (providers.data ?? []).map((item) => [item.id, item.professional_name]),
          );
          const serviceNames = new Map((services.data ?? []).map((item) => [item.id, item.name]));
          page = page.map((item) => ({
            ...item,
            customer_name: customerNames.get(String(item.customer_id)) ?? item.customer_id,
            provider_name: providerNames.get(String(item.provider_id)) ?? item.provider_id,
            service_name: serviceNames.get(String(item.service_id)) ?? item.service_id,
          }));
        }
        const nextRecords = reset ? page : [...recordsRef.current, ...page];
        recordsRef.current = nextRecords;
        setRecords(nextRecords);
        setHasMore(page.length === PAGE_SIZE);
      } catch (reason) {
        console.error('Unable to load administrator records', reason);
        setError(copy.loadError);
      } finally {
        loadingRecordsRef.current = false;
        setLoading(false);
      }
    },
    [appliedSearch, copy.loadError, marketplaceKind, section, statusFilter],
  );

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [categoriesResult, professionsResult] = await Promise.all([
        supabase
          .from('service_categories')
          .select('id, name, slug, description, is_active')
          .order('name')
          .limit(500),
        supabase
          .from('professions')
          .select('id, category_id, name, slug, description, is_active')
          .order('name')
          .limit(500),
      ]);
      if (categoriesResult.error) throw categoriesResult.error;
      if (professionsResult.error) throw professionsResult.error;
      const categories = (categoriesResult.data ?? []) as CatalogItem[];
      const professions = (professionsResult.data ?? []) as CatalogItem[];
      setCatalogCategories(categories);
      setCatalogProfessions(professions);

      if (catalogType === 'category') {
        setCatalogItems(categories);
      } else if (catalogType === 'profession') {
        setCatalogItems(professions);
      } else {
        const { data, error: serviceError } = await supabase
          .from('services')
          .select('id, profession_id, name, slug, description, is_active')
          .order('name')
          .limit(500);
        if (serviceError) throw serviceError;
        setCatalogItems((data ?? []) as CatalogItem[]);
      }
    } catch (reason) {
      console.error('Unable to load service catalog', reason);
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [catalogType, copy.loadError]);

  useEffect(() => {
    let active = true;
    async function checkAdmin() {
      setCheckingAccess(true);
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
        const { data, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (active) {
          setAuthorized(data?.role === 'admin');
          setSessionEmail(user.email ?? user.phone ?? '');
        }
      } catch (reason) {
        console.error('Unable to verify administrator access', reason);
        if (active) setError(copy.loadError);
      } finally {
        if (active) setCheckingAccess(false);
      }
    }
    void checkAdmin();
    return () => {
      active = false;
    };
  }, [copy.loadError]);

  useEffect(() => {
    if (!authorized) return;
    const timer = setTimeout(() => {
      if (section === 'overview') void loadOverview();
      else if (
        section === 'providers' ||
        section === 'customers' ||
        section === 'marketplace' ||
        section === 'reports' ||
        section === 'audit'
      )
        void loadRecords(true);
      else if (section === 'catalog') void loadCatalog();
    }, 0);
    return () => clearTimeout(timer);
  }, [authorized, section, loadOverview, loadRecords, loadCatalog]);

  function chooseSection(next: Section) {
    setSection(next);
    setError('');
    setRecords([]);
    setStatusFilter('');
    setSearch('');
    setAppliedSearch('');
  }

  function startCatalogEdit(item: CatalogItem | null) {
    setEditingItem(item);
    setItemName(item?.name ?? '');
    setItemSlug(item?.slug ?? '');
    setItemDescription(item?.description ?? '');
    setItemParent(
      catalogType === 'profession'
        ? (item?.category_id ?? '')
        : catalogType === 'service'
          ? (item?.profession_id ?? '')
          : '',
    );
    setItemActive(item?.is_active ?? true);
    setEditorVisible(true);
  }

  async function saveCatalogItem() {
    if (
      !itemName.trim() ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(itemSlug.trim()) ||
      (catalogType !== 'category' && !itemParent)
    ) {
      setError(copy.catalogSaveError);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { error: saveError } = await supabase.rpc('admin_save_catalog_item', {
        p_entity: catalogType,
        p_id: editingItem?.id ?? null,
        p_parent_id: itemParent || null,
        p_name: itemName.trim(),
        p_slug: itemSlug.trim(),
        p_description: itemDescription.trim() || null,
        p_is_active: itemActive,
      });
      if (saveError) throw saveError;
      setEditorVisible(false);
      await loadCatalog();
    } catch (reason) {
      console.error('Unable to save catalog item', reason);
      setError(copy.catalogSaveError);
    } finally {
      setSaving(false);
    }
  }

  async function changeAccountStatus(account: Account, suspend: boolean) {
    if (suspend && !suspensionReason.trim()) {
      setError(copy.reasonRequired);
      return;
    }
    setSavingStatus(true);
    setError('');
    try {
      const response =
        section === 'providers'
          ? await supabase.rpc('admin_set_provider_suspension', {
              p_provider_id: account.provider_id as string,
              p_suspend: suspend,
              p_reason: suspend ? suspensionReason.trim() : null,
            })
          : await supabase.rpc('admin_set_customer_status', {
              p_user_id: account.user_id,
              p_status: suspend ? 'suspended' : 'active',
              p_reason: suspend ? suspensionReason.trim() : null,
            });
      if (response.error) throw response.error;
      setStatusTarget(null);
      setSuspensionReason('');
      setError('');
      await loadRecords(true);
    } catch (reason) {
      console.error('Unable to change account status', reason);
      setError(copy.actionError);
    } finally {
      setSavingStatus(false);
    }
  }

  async function updateReport(reportId: string, nextStatus: string) {
    setLoading(true);
    setError('');
    try {
      const { error: updateError } = await supabase
        .from('reports')
        .update({ status: nextStatus })
        .eq('id', reportId)
        .select('id')
        .single();
      if (updateError) throw updateError;
      await loadRecords(true);
    } catch (reason) {
      console.error('Unable to update report status', reason);
      setError(copy.reportError);
    } finally {
      setLoading(false);
    }
  }

  async function toggleProviderDetails(account: Account) {
    const providerId = account.provider_id;
    if (!providerId) return;
    if (providerDetails[providerId]) {
      setProviderDetails((current) => {
        const next = { ...current };
        delete next[providerId];
        return next;
      });
      return;
    }

    setLoadingProviderDetails(providerId);
    setError('');
    try {
      const { data: providerServices, error: serviceError } = await supabase
        .from('provider_services')
        .select('service_id, title, is_active')
        .eq('provider_id', providerId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (serviceError) throw serviceError;
      const { data: areas, error: areaError } = await supabase
        .from('provider_service_areas')
        .select('city_id, region_id, country_id')
        .eq('provider_id', providerId)
        .limit(100);
      if (areaError) throw areaError;
      const { data: provider, error: providerError } = await supabase
        .from('provider_profiles')
        .select('description, years_experience, availability_status')
        .eq('id', providerId)
        .maybeSingle();
      if (providerError) throw providerError;

      const serviceIds = [...new Set((providerServices ?? []).map((item) => item.service_id))];
      const cityIds = [...new Set((areas ?? []).map((item) => item.city_id))];
      const regionIds = [...new Set((areas ?? []).map((item) => item.region_id))];
      const countryIds = [...new Set((areas ?? []).map((item) => item.country_id))];
      const [serviceNames, cities, regions, countries] = await Promise.all([
        serviceIds.length
          ? supabase.from('services').select('id, name').in('id', serviceIds)
          : Promise.resolve({ data: [], error: null }),
        cityIds.length
          ? supabase.from('cities').select('id, name').in('id', cityIds)
          : Promise.resolve({ data: [], error: null }),
        regionIds.length
          ? supabase.from('regions').select('id, name').in('id', regionIds)
          : Promise.resolve({ data: [], error: null }),
        countryIds.length
          ? supabase.from('countries').select('id, name').in('id', countryIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (serviceNames.error) throw serviceNames.error;
      if (cities.error) throw cities.error;
      if (regions.error) throw regions.error;
      if (countries.error) throw countries.error;
      const serviceById = new Map((serviceNames.data ?? []).map((item) => [item.id, item.name]));
      const cityById = new Map((cities.data ?? []).map((item) => [item.id, item.name]));
      const regionById = new Map((regions.data ?? []).map((item) => [item.id, item.name]));
      const countryById = new Map((countries.data ?? []).map((item) => [item.id, item.name]));
      setProviderDetails((current) => ({
        ...current,
        [providerId]: {
          profile: [
            provider?.description?.trim()
              ? `${copy.profileDescription}: ${provider.description.trim()}`
              : '',
            provider ? `${copy.experienceYears}: ${provider.years_experience}` : '',
            provider
              ? `${copy.availabilityStatus}: ${
                  copy.providerAvailability[
                    provider.availability_status as keyof typeof copy.providerAvailability
                  ] ?? provider.availability_status
                }`
              : '',
          ].filter(Boolean),
          services: (providerServices ?? []).map((item) => {
            const name = serviceById.get(item.service_id) ?? item.service_id;
            return `${item.title || name} · ${item.is_active ? copy.active : copy.disabled}`;
          }),
          areas: (areas ?? []).map((area) =>
            [
              cityById.get(area.city_id),
              regionById.get(area.region_id),
              countryById.get(area.country_id),
            ]
              .filter(Boolean)
              .join(', '),
          ),
        },
      }));
    } catch (reason) {
      console.error('Unable to load provider details', reason);
      setError(copy.detailsError);
    } finally {
      setLoadingProviderDetails('');
    }
  }

  async function toggleCustomerDetails(account: Account) {
    if (customerDetails[account.profile_id]) {
      setCustomerDetails((current) => {
        const next = { ...current };
        delete next[account.profile_id];
        return next;
      });
      return;
    }

    setLoadingCustomerDetails(account.profile_id);
    setError('');
    try {
      const [requests, bookings] = await Promise.all([
        supabase
          .from('service_requests')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', account.profile_id),
        supabase
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', account.profile_id),
      ]);
      if (requests.error) throw requests.error;
      if (bookings.error) throw bookings.error;
      setCustomerDetails((current) => ({
        ...current,
        [account.profile_id]: {
          requests: requests.count ?? 0,
          bookings: bookings.count ?? 0,
        },
      }));
    } catch (reason) {
      console.error('Unable to load customer activity', reason);
      setError(copy.loadError);
    } finally {
      setLoadingCustomerDetails('');
    }
  }

  async function signOut() {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(copy.signOutError);
      return;
    }
    router.replace('/account' as Href);
  }

  const statusOptions =
    section === 'providers'
      ? ['', 'verified', 'pending', 'under_review', 'rejected', 'suspended']
      : section === 'customers'
        ? ['', 'active', 'suspended']
        : section === 'marketplace'
          ? marketplaceKind === 'requests'
            ? ['', ...REQUEST_STATUSES]
            : ['', ...BOOKING_STATUSES]
          : section === 'reports'
            ? ['', ...REPORT_STATUSES]
            : [];
  const providerParentOptions =
    catalogType === 'profession' ? catalogCategories : catalogProfessions;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: copy.title }} />
      {checkingAccess ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#16804A" />
          <Text style={styles.muted}>{copy.loading}</Text>
        </View>
      ) : !authorized ? (
        <View style={styles.center}>
          <Text style={styles.sectionTitle}>{copy.accessDenied}</Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable style={styles.button} onPress={() => router.replace('/account' as Href)}>
            <Text style={styles.buttonText}>{strings.back}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <Text style={styles.brand}>NSOMEX CONNECT</Text>
                <Text style={styles.headerTitle}>{copy.title}</Text>
                <Text style={styles.subtitle}>{copy.subtitle}</Text>
              </View>
              <View style={styles.languageRow}>
                {(['en', 'fr'] as const).map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setLanguage(option)}
                    style={[styles.languageChip, language === option && styles.languageChipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: language === option }}
                  >
                    <Text style={styles.languageText}>{option.toUpperCase()}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.navigation}
          >
            {sections.map(([key, label]) => (
              <Pressable
                key={key}
                onPress={() => chooseSection(key)}
                style={[styles.navItem, section === key && styles.navItemActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: section === key }}
              >
                <Text style={[styles.navText, section === key && styles.navTextActive]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView contentContainerStyle={styles.content}>
            {error ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
                <Pressable
                  onPress={() => {
                    if (section === 'overview') void loadOverview();
                    else if (section === 'catalog') void loadCatalog();
                    else void loadRecords(true);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.retryText}>{copy.retry}</Text>
                </Pressable>
              </View>
            ) : null}

            {section === 'overview' ? (
              <View>
                <Text style={styles.sectionTitle}>{copy.overview}</Text>
                {loading ? (
                  <ActivityIndicator color="#16804A" />
                ) : summary ? (
                  <>
                    <View style={styles.metrics}>
                      {[
                        [copy.totalCustomers, summary.total_customers],
                        [copy.totalProviders, summary.total_providers],
                        [copy.pendingApplications, summary.pending_applications],
                        [copy.verifiedProviders, summary.verified_providers],
                        [copy.rejectedApplications, summary.rejected_applications],
                        [copy.activeListings, summary.active_service_listings],
                        [copy.totalRequests, summary.total_requests],
                        [copy.activeBookings, summary.active_bookings],
                        [copy.completedBookings, summary.completed_bookings],
                        [copy.cancelledBookings, summary.cancelled_bookings],
                      ].map(([label, value]) => (
                        <View key={String(label)} style={styles.metricCard}>
                          <Text style={styles.metricValue}>{value}</Text>
                          <Text style={styles.metricLabel}>{label}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={styles.card}>
                      <Text style={styles.cardTitle}>{copy.recentActivity}</Text>
                      {activity.length ? (
                        activity.map((item) => (
                          <View key={item.id} style={styles.listRow}>
                            <View style={styles.rowCopy}>
                              <Text style={styles.rowTitle}>{String(item.action)}</Text>
                              <Text style={styles.muted}>
                                {String(item.target_type)} · {formatDate(item.created_at, language)}
                              </Text>
                            </View>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.muted}>{copy.noActivity}</Text>
                      )}
                    </View>
                    <Pressable
                      style={styles.button}
                      onPress={() =>
                        router.push({
                          pathname: '/admin/provider-verification',
                          params: { language },
                        } as Href)
                      }
                    >
                      <Text style={styles.buttonText}>{copy.openReview}</Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={styles.muted}>{copy.noResults}</Text>
                )}
              </View>
            ) : null}

            {section === 'providers' || section === 'customers' ? (
              <View>
                <Text style={styles.sectionTitle}>
                  {section === 'providers' ? copy.providers : copy.customers}
                </Text>
                <View style={styles.searchRow}>
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    onSubmitEditing={() => {
                      setAppliedSearch(search.trim());
                      setRecords([]);
                    }}
                    placeholder={copy.search}
                    placeholderTextColor="#83918A"
                    style={styles.input}
                    returnKeyType="search"
                  />
                  <Pressable
                    style={styles.smallButton}
                    onPress={() => {
                      setAppliedSearch(search.trim());
                      setRecords([]);
                    }}
                  >
                    <Text style={styles.buttonText}>{copy.applySearch}</Text>
                  </Pressable>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.chipRow}>
                    {statusOptions.map((option) => (
                      <Pressable
                        key={option || 'all'}
                        style={[styles.chip, statusFilter === option && styles.chipSelected]}
                        onPress={() => {
                          setStatusFilter(option);
                          setRecords([]);
                        }}
                      >
                        <Text style={styles.chipText}>{accountStatusLabel(option, copy)}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                {loading && !records.length ? <ActivityIndicator color="#16804A" /> : null}
                {records.length ? (
                  records.map((raw) => {
                    const account = raw as Account;
                    const displayName =
                      account.professional_name ||
                      account.display_name ||
                      account.phone ||
                      copy.name;
                    const currentStatus =
                      section === 'providers'
                        ? (account.provider_status ?? 'pending')
                        : account.account_status;
                    const isSuspended =
                      section === 'providers'
                        ? account.provider_status === 'suspended'
                        : account.account_status === 'suspended';
                    return (
                      <View key={account.id} style={styles.card}>
                        <View style={styles.listRow}>
                          <View style={styles.rowCopy}>
                            <Text style={styles.rowTitle}>{displayName}</Text>
                            {account.email ? (
                              <Text style={styles.muted}>{account.email}</Text>
                            ) : null}
                            {account.phone ? (
                              <Text style={styles.muted}>{account.phone}</Text>
                            ) : null}
                            <Text style={styles.muted}>
                              {copy.status}: {accountStatusLabel(currentStatus, copy)}
                            </Text>
                            {section === 'providers' ? (
                              <Text style={styles.muted}>
                                {copy.accountStatus}:{' '}
                                {accountStatusLabel(account.account_status, copy)}
                              </Text>
                            ) : null}
                            <Text style={styles.muted}>
                              {formatDate(account.created_at, language)}
                            </Text>
                            {account.account_status_reason || account.suspension_reason ? (
                              <Text style={styles.reasonText}>
                                {copy.reason}:{' '}
                                {account.account_status_reason || account.suspension_reason}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                        {section === 'providers' &&
                        account.provider_status !== 'verified' &&
                        !isSuspended ? (
                          <Text style={styles.muted}>{copy.reviewApplications}</Text>
                        ) : null}
                        {isSuspended ? (
                          <Pressable
                            style={styles.secondaryButton}
                            onPress={() => void changeAccountStatus(account, false)}
                          >
                            <Text style={styles.secondaryButtonText}>{copy.reactivate}</Text>
                          </Pressable>
                        ) : section === 'providers' &&
                          account.provider_status !== 'verified' ? null : (
                          <Pressable
                            style={styles.dangerButton}
                            onPress={() => {
                              setStatusTarget(account);
                              setSuspensionReason('');
                            }}
                          >
                            <Text style={styles.buttonText}>{copy.suspend}</Text>
                          </Pressable>
                        )}
                        {section === 'providers' ? (
                          <>
                            <Pressable
                              style={styles.secondaryButton}
                              onPress={() => void toggleProviderDetails(account)}
                            >
                              <Text style={styles.secondaryButtonText}>
                                {loadingProviderDetails === account.provider_id
                                  ? copy.loading
                                  : copy.viewDetails}
                              </Text>
                            </Pressable>
                            {providerDetails[account.provider_id ?? ''] ? (
                              <View style={styles.detailsBlock}>
                                <Text style={styles.settingLabel}>{copy.profileDetails}</Text>
                                {providerDetails[account.provider_id ?? ''].profile.map(
                                  (detail) => (
                                    <Text key={detail} style={styles.muted}>
                                      {detail}
                                    </Text>
                                  ),
                                )}
                                <Text style={styles.settingLabel}>{copy.serviceListings}</Text>
                                {providerDetails[account.provider_id ?? ''].services.length ? (
                                  providerDetails[account.provider_id ?? ''].services.map(
                                    (service) => (
                                      <Text key={service} style={styles.muted}>
                                        {service}
                                      </Text>
                                    ),
                                  )
                                ) : (
                                  <Text style={styles.muted}>{copy.noResults}</Text>
                                )}
                                <Text style={styles.settingLabel}>{copy.serviceAreas}</Text>
                                {providerDetails[account.provider_id ?? ''].areas.length ? (
                                  providerDetails[account.provider_id ?? ''].areas.map(
                                    (area, index) => (
                                      <Text key={`${area}-${index}`} style={styles.muted}>
                                        {area}
                                      </Text>
                                    ),
                                  )
                                ) : (
                                  <Text style={styles.muted}>{copy.noResults}</Text>
                                )}
                              </View>
                            ) : null}
                          </>
                        ) : null}
                        {section === 'customers' ? (
                          <>
                            <Pressable
                              style={styles.secondaryButton}
                              onPress={() => void toggleCustomerDetails(account)}
                            >
                              <Text style={styles.secondaryButtonText}>
                                {loadingCustomerDetails === account.profile_id
                                  ? copy.loading
                                  : copy.customerActivity}
                              </Text>
                            </Pressable>
                            {customerDetails[account.profile_id] ? (
                              <View style={styles.detailsBlock}>
                                <Text style={styles.muted}>
                                  {copy.requestCount}:{' '}
                                  {customerDetails[account.profile_id].requests}
                                </Text>
                                <Text style={styles.muted}>
                                  {copy.bookingCount}:{' '}
                                  {customerDetails[account.profile_id].bookings}
                                </Text>
                              </View>
                            ) : null}
                          </>
                        ) : null}
                      </View>
                    );
                  })
                ) : !loading ? (
                  <Text style={styles.muted}>{copy.noResults}</Text>
                ) : null}
                {hasMore ? (
                  <Pressable style={styles.secondaryButton} onPress={() => void loadRecords(false)}>
                    <Text style={styles.secondaryButtonText}>
                      {loading ? copy.loading : copy.loadMore}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {section === 'catalog' ? (
              <View>
                <Text style={styles.sectionTitle}>{copy.catalog}</Text>
                <View style={styles.chipRow}>
                  {(['category', 'profession', 'service'] as const).map((kind) => (
                    <Pressable
                      key={kind}
                      style={[styles.chip, catalogType === kind && styles.chipSelected]}
                      onPress={() => setCatalogType(kind)}
                    >
                      <Text style={styles.chipText}>{copy[kind]}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable style={styles.button} onPress={() => startCatalogEdit(null)}>
                  <Text style={styles.buttonText}>{copy.addItem}</Text>
                </Pressable>
                {loading && !catalogItems.length ? <ActivityIndicator color="#16804A" /> : null}
                {catalogItems.map((item) => (
                  <Pressable
                    key={item.id}
                    style={styles.card}
                    onPress={() => startCatalogEdit(item)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.rowTitle}>{item.name}</Text>
                    <Text style={styles.muted}>{item.slug}</Text>
                    {item.description ? <Text style={styles.muted}>{item.description}</Text> : null}
                    <Text style={item.is_active ? styles.activeText : styles.inactiveText}>
                      {item.is_active ? copy.enabled : copy.disabled} · {copy.editItem}
                    </Text>
                  </Pressable>
                ))}
                {!loading && !catalogItems.length ? (
                  <Text style={styles.muted}>{copy.noResults}</Text>
                ) : null}
              </View>
            ) : null}

            {section === 'marketplace' ? (
              <View>
                <Text style={styles.sectionTitle}>{copy.marketplace}</Text>
                <View style={styles.chipRow}>
                  {(['requests', 'bookings'] as const).map((kind) => (
                    <Pressable
                      key={kind}
                      style={[styles.chip, marketplaceKind === kind && styles.chipSelected]}
                      onPress={() => {
                        setMarketplaceKind(kind);
                        setStatusFilter('');
                        setRecords([]);
                      }}
                    >
                      <Text style={styles.chipText}>{copy[kind]}</Text>
                    </Pressable>
                  ))}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.chipRow}>
                    {statusOptions.map((status) => (
                      <Pressable
                        key={status || 'all'}
                        style={[styles.chip, statusFilter === status && styles.chipSelected]}
                        onPress={() => {
                          setStatusFilter(status);
                          setRecords([]);
                        }}
                      >
                        <Text style={styles.chipText}>
                          {status
                            ? marketplaceStatusLabel(status, marketplaceKind, copy)
                            : copy.all}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                {loading && !records.length ? <ActivityIndicator color="#16804A" /> : null}
                {records.map((item) => (
                  <View key={item.id} style={styles.card}>
                    <Text style={styles.rowTitle}>
                      {marketplaceKind === 'requests' ? copy.requestDescription : copy.booking}
                    </Text>
                    <Text style={styles.bodyText}>
                      {marketplaceKind === 'requests'
                        ? String(item.description ?? '')
                        : `${String(item.scheduled_date ?? '')} ${String(item.scheduled_time ?? '')}`}
                    </Text>
                    <Text style={styles.muted}>
                      {copy.status}:{' '}
                      {marketplaceStatusLabel(String(item.status ?? ''), marketplaceKind, copy)}
                    </Text>
                    <Text style={styles.muted}>
                      {copy.created}: {formatDate(item.created_at, language)}
                    </Text>
                    <Text style={styles.muted}>
                      {copy.customer}: {String(item.customer_name ?? item.customer_id ?? '')}
                    </Text>
                    {item.provider_id ? (
                      <Text style={styles.muted}>
                        {copy.provider}: {String(item.provider_name ?? item.provider_id)}
                      </Text>
                    ) : null}
                    <Text style={styles.muted}>
                      {copy.serviceLabel}: {String(item.service_name ?? item.service_id ?? '')}
                    </Text>
                  </View>
                ))}
                {!loading && !records.length ? (
                  <Text style={styles.muted}>{copy.noMarketplaceRecords}</Text>
                ) : null}
                {hasMore ? (
                  <Pressable style={styles.secondaryButton} onPress={() => void loadRecords(false)}>
                    <Text style={styles.secondaryButtonText}>
                      {loading ? copy.loading : copy.loadMore}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {section === 'reports' ? (
              <View>
                <Text style={styles.sectionTitle}>{copy.reports}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.chipRow}>
                    {statusOptions.map((status) => (
                      <Pressable
                        key={status || 'all'}
                        style={[styles.chip, statusFilter === status && styles.chipSelected]}
                        onPress={() => {
                          setStatusFilter(status);
                          setRecords([]);
                        }}
                      >
                        <Text style={styles.chipText}>
                          {status ? reportStatusLabel(status, copy) : copy.all}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                {loading && !records.length ? <ActivityIndicator color="#16804A" /> : null}
                {records.map((report) => (
                  <View key={report.id} style={styles.card}>
                    <Text style={styles.rowTitle}>{String(report.reason)}</Text>
                    <Text style={styles.muted}>
                      {copy.status}: {reportStatusLabel(String(report.status), copy)}
                    </Text>
                    <Text style={styles.muted}>
                      {copy.reporter}: {String(report.reporter_id)}
                    </Text>
                    {report.reported_user_id ? (
                      <Text style={styles.muted}>
                        {copy.reportedUser}: {String(report.reported_user_id)}
                      </Text>
                    ) : null}
                    {report.booking_id ? (
                      <Text style={styles.muted}>
                        {copy.booking}: {String(report.booking_id)}
                      </Text>
                    ) : null}
                    {report.description ? (
                      <Text style={styles.bodyText}>{String(report.description)}</Text>
                    ) : null}
                    <View style={styles.chipRow}>
                      {REPORT_STATUSES.filter((status) => status !== report.status).map(
                        (status) => (
                          <Pressable
                            key={status}
                            style={styles.secondaryButton}
                            onPress={() => void updateReport(report.id, status)}
                          >
                            <Text style={styles.secondaryButtonText}>
                              {reportStatusLabel(status, copy)}
                            </Text>
                          </Pressable>
                        ),
                      )}
                    </View>
                  </View>
                ))}
                {!loading && !records.length ? (
                  <Text style={styles.muted}>{copy.noReports}</Text>
                ) : null}
                {hasMore ? (
                  <Pressable style={styles.secondaryButton} onPress={() => void loadRecords(false)}>
                    <Text style={styles.secondaryButtonText}>
                      {loading ? copy.loading : copy.loadMore}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {section === 'audit' ? (
              <View>
                <Text style={styles.sectionTitle}>{copy.audit}</Text>
                {loading ? <ActivityIndicator color="#16804A" /> : null}
                {records.map((item) => (
                  <View key={item.id} style={styles.card}>
                    <Text style={styles.rowTitle}>{String(item.action)}</Text>
                    <Text style={styles.muted}>
                      {String(item.target_type)} · {String(item.target_id ?? '')}
                    </Text>
                    <Text style={styles.muted}>{formatDate(item.created_at, language)}</Text>
                  </View>
                ))}
                {!loading && !records.length ? (
                  <Text style={styles.muted}>{copy.noAudit}</Text>
                ) : null}
                {hasMore ? (
                  <Pressable style={styles.secondaryButton} onPress={() => void loadRecords(false)}>
                    <Text style={styles.secondaryButtonText}>
                      {loading ? copy.loading : copy.loadMore}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {section === 'settings' ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{copy.settings}</Text>
                <Text style={styles.muted}>{copy.signedInAs}</Text>
                <Text style={styles.rowTitle}>{sessionEmail}</Text>
                <Text style={styles.settingLabel}>{copy.language}</Text>
                <View style={styles.chipRow}>
                  {(['en', 'fr'] as const).map((option) => (
                    <Pressable
                      key={option}
                      style={[styles.chip, language === option && styles.chipSelected]}
                      onPress={() => setLanguage(option)}
                    >
                      <Text style={styles.chipText}>
                        {option === 'en' ? strings.english : strings.french}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() =>
                    router.push({
                      pathname: '/notifications/preferences',
                      params: { language },
                    } as Href)
                  }
                >
                  <Text style={styles.secondaryButtonText}>{copy.notificationSettings}</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() =>
                    router.push({
                      pathname: '/admin/provider-verification',
                      params: { language },
                    } as Href)
                  }
                >
                  <Text style={styles.secondaryButtonText}>{copy.openReview}</Text>
                </Pressable>
                <Pressable style={styles.dangerButton} onPress={() => void signOut()}>
                  <Text style={styles.buttonText}>{copy.signOut}</Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
        </>
      )}

      <Modal
        visible={editorVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditorVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.sectionTitle}>
              {editingItem ? copy.editItem : copy.addItem} · {copy[catalogType]}
            </Text>
            <TextInput
              value={itemName}
              onChangeText={setItemName}
              placeholder={copy.itemName}
              style={styles.input}
            />
            <TextInput
              value={itemSlug}
              onChangeText={setItemSlug}
              placeholder={copy.slug}
              autoCapitalize="none"
              style={styles.input}
            />
            <TextInput
              value={itemDescription}
              onChangeText={setItemDescription}
              placeholder={copy.description}
              multiline
              style={[styles.input, styles.multiline]}
            />
            {catalogType !== 'category' ? (
              <>
                <Text style={styles.settingLabel}>{copy.chooseParent}</Text>
                {providerParentOptions.map((parent) => (
                  <Pressable
                    key={parent.id}
                    style={[
                      styles.parentOption,
                      itemParent === parent.id && styles.parentOptionSelected,
                    ]}
                    onPress={() => setItemParent(parent.id)}
                  >
                    <Text style={styles.bodyText}>{parent.name}</Text>
                  </Pressable>
                ))}
              </>
            ) : null}
            <View style={styles.switchRow}>
              <Text style={styles.bodyText}>{itemActive ? copy.enabled : copy.disabled}</Text>
              <Switch
                value={itemActive}
                onValueChange={setItemActive}
                trackColor={{ true: '#16804A' }}
              />
            </View>
            <Pressable
              style={styles.button}
              disabled={saving}
              onPress={() => void saveCatalogItem()}
            >
              <Text style={styles.buttonText}>{saving ? copy.loading : copy.save}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setEditorVisible(false)}>
              <Text style={styles.secondaryButtonText}>{copy.cancel}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={Boolean(statusTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setStatusTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>
              {section === 'providers' ? copy.suspendProviderTitle : copy.suspendCustomerTitle}
            </Text>
            <TextInput
              value={suspensionReason}
              onChangeText={setSuspensionReason}
              placeholder={copy.suspensionReason}
              multiline
              style={[styles.input, styles.multiline]}
            />
            <Pressable
              style={styles.dangerButton}
              disabled={savingStatus}
              onPress={() => statusTarget && void changeAccountStatus(statusTarget, true)}
            >
              <Text style={styles.buttonText}>{savingStatus ? copy.loading : copy.save}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setStatusTarget(null)}>
              <Text style={styles.secondaryButtonText}>{copy.cancel}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function accountStatusLabel(
  status: string,
  copy: ReturnType<typeof getTranslations>['adminConsole'],
) {
  const labels: Record<string, string> = {
    '': copy.all,
    active: copy.active,
    suspended: copy.suspended,
    verified: copy.verified,
    pending: copy.pending,
    under_review: copy.underReview,
    rejected: copy.rejected,
  };
  return labels[status] ?? status;
}

function marketplaceStatusLabel(
  status: string,
  kind: 'requests' | 'bookings',
  copy: ReturnType<typeof getTranslations>['adminConsole'],
) {
  const labels = kind === 'requests' ? copy.serviceRequestStatus : copy.bookingStatus;
  return labels[status as keyof typeof labels] ?? status;
}

function reportStatusLabel(
  status: string,
  copy: ReturnType<typeof getTranslations>['adminConsole'],
) {
  switch (status) {
    case 'open':
      return copy.open;
    case 'investigating':
      return copy.investigating;
    case 'resolved':
      return copy.resolved;
    case 'dismissed':
      return copy.dismissed;
    default:
      return status;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7F5' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14, backgroundColor: '#FFFFFF' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: { flex: 1 },
  brand: { color: '#16804A', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  headerTitle: { color: '#17251D', fontSize: 23, fontWeight: '800', marginTop: 4 },
  subtitle: { color: '#65736B', fontSize: 13, marginTop: 3 },
  languageRow: { flexDirection: 'row', gap: 6 },
  languageChip: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#EFF3F0',
  },
  languageChipActive: { backgroundColor: '#DDEFE4' },
  languageText: { color: '#176B42', fontSize: 12, fontWeight: '800' },
  navigation: { paddingHorizontal: 14, paddingVertical: 10, gap: 8, backgroundColor: '#FFFFFF' },
  navItem: {
    borderRadius: 20,
    backgroundColor: '#F1F4F2',
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  navItemActive: { backgroundColor: '#16804A' },
  navText: { color: '#536159', fontSize: 13, fontWeight: '700' },
  navTextActive: { color: '#FFFFFF' },
  content: { padding: 18, paddingBottom: 44, gap: 14 },
  sectionTitle: { color: '#17251D', fontSize: 21, fontWeight: '800', marginBottom: 12 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  metricCard: {
    width: '48%',
    minHeight: 94,
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
  },
  metricValue: { color: '#16804A', fontSize: 26, fontWeight: '800' },
  metricLabel: { color: '#5E6A63', fontSize: 12, marginTop: 5 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 15, marginBottom: 10, gap: 8 },
  cardTitle: { color: '#17251D', fontSize: 16, fontWeight: '800', marginBottom: 4 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  rowCopy: { flex: 1, gap: 3 },
  rowTitle: { color: '#1C2A22', fontSize: 15, fontWeight: '700' },
  muted: { color: '#738078', fontSize: 13, lineHeight: 18 },
  bodyText: { color: '#35433B', fontSize: 14, lineHeight: 20 },
  reasonText: { color: '#9A4E13', fontSize: 13 },
  detailsBlock: { borderTopWidth: 1, borderTopColor: '#E4EAE6', marginTop: 6, paddingTop: 8 },
  errorCard: { padding: 14, backgroundColor: '#FDEDEC', borderRadius: 12, marginBottom: 12 },
  errorText: { color: '#9D2D24', fontSize: 14, marginBottom: 8 },
  retryText: { color: '#176B42', fontWeight: '800', paddingVertical: 5 },
  button: {
    backgroundColor: '#16804A',
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginVertical: 5,
  },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  secondaryButton: {
    backgroundColor: '#E8F2EC',
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
    marginVertical: 4,
  },
  secondaryButtonText: { color: '#176B42', fontSize: 13, fontWeight: '800' },
  dangerButton: {
    backgroundColor: '#B83A32',
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
    marginVertical: 4,
  },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#D5DED8',
    backgroundColor: '#FFFFFF',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#17251D',
  },
  smallButton: {
    backgroundColor: '#16804A',
    borderRadius: 9,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingVertical: 5, marginBottom: 6 },
  chip: { backgroundColor: '#E9EEEA', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  chipSelected: { backgroundColor: '#D4EBDD' },
  chipText: { color: '#28533C', fontWeight: '700', fontSize: 12 },
  activeText: { color: '#16804A', fontWeight: '700', fontSize: 13 },
  inactiveText: { color: '#9A4E13', fontWeight: '700', fontSize: 13 },
  settingLabel: { color: '#36453C', fontWeight: '700', marginTop: 8, marginBottom: 5 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
    padding: 18,
  },
  modalContent: { backgroundColor: '#F5F7F5', borderRadius: 16, padding: 18, gap: 10 },
  modalCard: { backgroundColor: '#F5F7F5', borderRadius: 16, padding: 18, gap: 10 },
  multiline: { minHeight: 92, textAlignVertical: 'top' },
  parentOption: {
    padding: 11,
    backgroundColor: '#FFFFFF',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#E1E7E3',
  },
  parentOptionSelected: { borderColor: '#16804A', backgroundColor: '#E8F2EC' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
  },
});
