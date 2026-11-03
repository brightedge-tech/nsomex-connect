import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { getTranslations, resolveLanguage, type Language } from '../../lib/translations';

type Conversation = {
  conversation_id: string;
  booking_id: string | null;
  request_id: string | null;
  provider_id: string | null;
  updated_at: string;
  other_party_name: string;
  service_name: string | null;
  latest_message_id: string | null;
  latest_message_text: string | null;
  latest_message_sender_id: string | null;
  latest_message_created_at: string | null;
  unread_count: number;
};
type Cursor = { updatedAt: string; id: string };
const pageSize = 25;

export default function MessageInboxScreen() {
  const params = useLocalSearchParams<{ language?: string }>();
  const [language, setLanguage] = useState<Language>(resolveLanguage(params.language));
  const copy = getTranslations(language).messaging;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);

  const loadPage = useCallback(
    async (before: Cursor | null, append: boolean) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError('');
        setAuthRequired(false);
      }

      try {
        const { data: userResult, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!userResult.user) {
          setAuthRequired(true);
          setConversations([]);
          setHasMore(false);
          setCursor(null);
          return;
        }

        const { data, error: listError } = await supabase.rpc('list_my_conversations', {
          p_before_updated_at: before?.updatedAt ?? null,
          p_before_id: before?.id ?? null,
          p_page_size: pageSize + 1,
        });
        if (listError) throw listError;

        const page = (data ?? []) as Conversation[];
        const moreAvailable = page.length > pageSize;
        const visible = page.slice(0, pageSize);
        setConversations((current) => (append ? [...current, ...visible] : visible));
        setHasMore(moreAvailable);
        const last = visible.at(-1);
        setCursor(
          moreAvailable && last ? { updatedAt: last.updated_at, id: last.conversation_id } : null,
        );
      } catch {
        setError(copy.loadError);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [copy.loadError],
  );

  useFocusEffect(
    useCallback(() => {
      void loadPage(null, false);
    }, [loadPage]),
  );

  function openConversation(conversationId: string) {
    router.push({
      pathname: '/messages/[conversationId]',
      params: { conversationId, language },
    } as Href);
  }

  function openSignIn() {
    router.push({
      pathname: '/account',
      params: { role: 'customer', mode: 'login', language, returnTo: '/messages' },
    } as Href);
  }

  function formatDate(value: string) {
    return new Date(value).toLocaleString(language === 'fr' ? 'fr-FR' : 'en', {
      dateStyle: 'medium',
      timeStyle: 'short',
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
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void loadPage(null, false)}>
              <Text style={styles.retry}>{copy.retry}</Text>
            </Pressable>
          </View>
        ) : null}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
            <Text style={styles.muted}>{copy.loadingInbox}</Text>
          </View>
        ) : authRequired ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>{copy.signInRequired}</Text>
            <Pressable style={styles.primaryButton} onPress={openSignIn}>
              <Text style={styles.primaryButtonText}>
                {getTranslations(language).account.signIn}
              </Text>
            </Pressable>
          </View>
        ) : conversations.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>{copy.noConversations}</Text>
          </View>
        ) : (
          <>
            {conversations.map((conversation) => (
              <Pressable
                key={conversation.conversation_id}
                style={styles.card}
                onPress={() => openConversation(conversation.conversation_id)}
                accessibilityRole="button"
              >
                <View style={styles.cardTop}>
                  <Text style={styles.name} numberOfLines={1}>
                    {conversation.other_party_name}
                  </Text>
                  {conversation.unread_count > 0 ? (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadText}>{conversation.unread_count}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.service} numberOfLines={1}>
                  {conversation.service_name || copy.conversation}
                  {' · '}
                  {conversation.booking_id ? copy.booking : copy.serviceRequest}
                </Text>
                <Text style={styles.preview} numberOfLines={2}>
                  {conversation.latest_message_text || copy.noMessages}
                </Text>
                <Text style={styles.date}>
                  {formatDate(conversation.latest_message_created_at ?? conversation.updated_at)}
                  {conversation.unread_count > 0
                    ? ` · ${conversation.unread_count} ${copy.unread}`
                    : ''}
                </Text>
              </Pressable>
            ))}
            {hasMore ? (
              <Pressable
                style={[styles.moreButton, loadingMore && styles.disabled]}
                onPress={() => void loadPage(cursor, true)}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <ActivityIndicator color="#16804A" />
                ) : (
                  <Text style={styles.moreText}>
                    {getTranslations(language).customerRequests.loadMore}
                  </Text>
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
  title: { color: '#15251A', fontSize: 28, fontWeight: '900' },
  subtitle: { color: '#66736A', lineHeight: 21, marginTop: 7, marginBottom: 18 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 15,
    padding: 16,
    marginBottom: 11,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: '#15251A', fontWeight: '900', fontSize: 17, flex: 1 },
  unreadBadge: {
    minWidth: 25,
    height: 25,
    borderRadius: 13,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16804A',
  },
  unreadText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  service: { color: '#16804A', fontSize: 12, fontWeight: '800', marginTop: 7 },
  preview: { color: '#536358', lineHeight: 20, marginTop: 9 },
  date: { color: '#89958B', fontSize: 11, marginTop: 8 },
  center: { paddingVertical: 50, alignItems: 'center' },
  muted: { color: '#66736A', marginTop: 9 },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 15,
    padding: 22,
    alignItems: 'center',
  },
  emptyText: { color: '#66736A', textAlign: 'center', lineHeight: 22 },
  primaryButton: {
    backgroundColor: '#16804A',
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 15,
  },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '800' },
  errorCard: { backgroundColor: '#FCECEC', padding: 13, borderRadius: 10, marginBottom: 12 },
  errorText: { color: '#8E2525', lineHeight: 20 },
  retry: { color: '#16804A', fontWeight: '800', marginTop: 8 },
  moreButton: {
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 10,
    minHeight: 46,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  moreText: { color: '#16804A', fontWeight: '800' },
  disabled: { opacity: 0.6 },
});
