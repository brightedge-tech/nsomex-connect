import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { getTranslations, resolveLanguage, type Language } from '../../lib/translations';

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  message_text: string | null;
  read_at: string | null;
  created_at: string;
};
type ConversationRow = {
  id: string;
  booking_id: string | null;
  request_id: string | null;
};
type Cursor = { createdAt: string; id: string };
const pageSize = 40;
const messageColumns = 'id, conversation_id, sender_id, message_text, read_at, created_at';

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function mergeMessages(current: Message[], additions: Message[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  additions.forEach((message) => byId.set(message.id, message));
  return [...byId.values()].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
  );
}

export default function ConversationScreen() {
  const params = useLocalSearchParams<{
    conversationId?: string | string[];
    language?: string | string[];
  }>();
  const conversationId = firstParam(params.conversationId);
  const [language, setLanguage] = useState<Language>(resolveLanguage(firstParam(params.language)));
  const copy = getTranslations(language).messaging;
  const [userId, setUserId] = useState('');
  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [sendError, setSendError] = useState(false);
  const [connected, setConnected] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const scrollToBottomRef = useRef(false);

  const markConversationRead = useCallback(
    async (currentConversationId: string, currentUserId: string) => {
      const { error: readError } = await supabase.rpc('mark_conversation_read', {
        p_conversation_id: currentConversationId,
      });
      if (readError) {
        setError(copy.loadError);
        return;
      }

      const readAt = new Date().toISOString();
      setMessages((current) =>
        current.map((message) =>
          message.conversation_id === currentConversationId &&
          message.sender_id !== currentUserId &&
          !message.read_at
            ? { ...message, read_at: readAt }
            : message,
        ),
      );
    },
    [copy.loadError],
  );

  const loadConversation = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (!conversationId) throw new Error(copy.unavailable);
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userResult.user) throw new Error(copy.signInRequired);
      setUserId(userResult.user.id);

      const { data: row, error: conversationError } = await supabase
        .from('conversations')
        .select('id, booking_id, request_id')
        .eq('id', conversationId)
        .maybeSingle();
      if (conversationError) throw conversationError;
      if (!row) throw new Error(copy.unavailable);

      const { data, error: messageError } = await supabase
        .from('messages')
        .select(messageColumns)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(pageSize + 1);
      if (messageError) throw messageError;

      const page = (data ?? []) as Message[];
      const more = page.length > pageSize;
      const visible = page.slice(0, pageSize).reverse();
      setConversation(row as ConversationRow);
      scrollToBottomRef.current = true;
      setMessages(visible);
      setHasOlder(more);
      const oldest = visible[0];
      setCursor(more && oldest ? { createdAt: oldest.created_at, id: oldest.id } : null);
      await markConversationRead(conversationId, userResult.user.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.loadError);
      setConversation(null);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [conversationId, copy.loadError, copy.signInRequired, copy.unavailable, markConversationRead]);

  useFocusEffect(
    useCallback(() => {
      void loadConversation();
    }, [loadConversation]),
  );

  useEffect(() => {
    if (!conversationId || !userId || !conversation) return undefined;
    let active = true;
    let channel: RealtimeChannel;

    channel = supabase
      .channel(`messages:${conversationId}:${reconnectKey}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new;
          if (!('id' in row) || typeof row.id !== 'string') return;
          void supabase
            .from('messages')
            .select(messageColumns)
            .eq('id', row.id)
            .maybeSingle()
            .then(({ data, error: queryError }) => {
              if (!active || queryError || !data) return;
              const nextMessage = data as Message;
              scrollToBottomRef.current = true;
              setMessages((current) => mergeMessages(current, [nextMessage]));
              if (
                payload.eventType === 'INSERT' &&
                nextMessage.sender_id !== userId &&
                !nextMessage.read_at
              ) {
                void markConversationRead(conversationId, userId);
              }
            });
        },
      )
      .subscribe((status) => {
        if (active) setConnected(status === 'SUBSCRIBED');
      });

    return () => {
      active = false;
      setConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [conversation, conversationId, markConversationRead, reconnectKey, userId]);

  useEffect(() => {
    if (!scrollToBottomRef.current) return;
    scrollToBottomRef.current = false;
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [messages]);

  async function loadOlder() {
    if (!conversationId || !cursor || loadingOlder) return;
    setLoadingOlder(true);
    setError('');
    try {
      const { data, error: queryError } = await supabase
        .from('messages')
        .select(messageColumns)
        .eq('conversation_id', conversationId)
        .or(
          `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
        )
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(pageSize + 1);
      if (queryError) throw queryError;

      const page = (data ?? []) as Message[];
      const more = page.length > pageSize;
      const visible = page.slice(0, pageSize).reverse();
      scrollToBottomRef.current = false;
      setMessages((current) => mergeMessages(visible, current));
      setHasOlder(more);
      const oldest = visible[0];
      setCursor(more && oldest ? { createdAt: oldest.created_at, id: oldest.id } : null);
      await markConversationRead(conversationId, userId);
    } catch {
      setError(copy.loadError);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!conversationId || !userId || sending) return;
    if (!text) {
      setError(copy.invalidMessage);
      return;
    }
    if (text.length > 5000) {
      setError(copy.messageTooLong);
      return;
    }

    setSending(true);
    setSendError(false);
    setError('');
    try {
      const { data, error: insertError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: userId,
          message_text: text,
        })
        .select(messageColumns)
        .single();
      if (insertError) throw insertError;
      scrollToBottomRef.current = true;
      setMessages((current) => mergeMessages(current, [data as Message]));
      setDraft('');
    } catch {
      setSendError(true);
      setError(copy.sendError);
    } finally {
      setSending(false);
    }
  }

  function formatTime(value: string) {
    return new Date(value).toLocaleString(language === 'fr' ? 'fr-FR' : 'en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  const conversationLabel = conversation?.booking_id
    ? copy.booking
    : conversation?.request_id
      ? copy.serviceRequest
      : copy.conversation;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 16 : 0}
    >
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
        <Text style={styles.headerTitle}>{conversationLabel}</Text>
        <Pressable
          onPress={() => {
            if (!connected) setReconnectKey((current) => current + 1);
          }}
          accessibilityRole="button"
          accessibilityState={{ disabled: connected }}
        >
          <Text style={[styles.connection, connected ? styles.connected : styles.disconnected]}>
            {connected ? copy.connected : copy.reconnecting}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#16804A" />
          <Text style={styles.muted}>{copy.loadingConversation}</Text>
        </View>
      ) : error && !conversation ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => void loadConversation()}>
            <Text style={styles.retryText}>{copy.retry}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                onPress={() => {
                  if (sendError) void sendMessage();
                  else void loadConversation();
                }}
              >
                <Text style={styles.retryText}>{copy.retry}</Text>
              </Pressable>
            </View>
          ) : null}
          <ScrollView
            ref={scrollRef}
            style={styles.messages}
            contentContainerStyle={styles.messageContent}
            keyboardShouldPersistTaps="handled"
            maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
          >
            {hasOlder ? (
              <Pressable
                style={[styles.olderButton, loadingOlder && styles.disabled]}
                onPress={() => void loadOlder()}
                disabled={loadingOlder}
              >
                {loadingOlder ? (
                  <ActivityIndicator color="#16804A" />
                ) : (
                  <Text style={styles.olderText}>{copy.loadOlder}</Text>
                )}
              </Pressable>
            ) : null}
            {!messages.length ? <Text style={styles.empty}>{copy.noMessages}</Text> : null}
            {messages.map((message) => {
              const own = message.sender_id === userId;
              return (
                <View
                  key={message.id}
                  style={[styles.messageRow, own ? styles.messageRowOwn : styles.messageRowOther]}
                >
                  <View style={[styles.bubble, own ? styles.bubbleOwn : styles.bubbleOther]}>
                    <Text style={[styles.messageText, own && styles.messageTextOwn]}>
                      {message.message_text}
                    </Text>
                    <Text style={[styles.messageTime, own && styles.messageTimeOwn]}>
                      {formatTime(message.created_at)}
                    </Text>
                    {own ? (
                      <Text style={[styles.receipt, own && styles.messageTimeOwn]}>
                        {message.read_at ? copy.read : copy.sent}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={(value) => {
                setDraft(value);
                setSendError(false);
                setError('');
              }}
              placeholder={copy.messagePlaceholder}
              placeholderTextColor="#89958B"
              multiline
              maxLength={5000}
              editable={!sending}
              textAlignVertical="center"
              accessibilityLabel={copy.messagePlaceholder}
            />
            <Pressable
              style={[styles.sendButton, (sending || !draft.trim()) && styles.disabled]}
              onPress={() => void sendMessage()}
              disabled={sending || !draft.trim()}
              accessibilityRole="button"
            >
              {sending ? (
                <View style={styles.sendingContent}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={styles.sendText}>{copy.sending}</Text>
                </View>
              ) : (
                <Text style={styles.sendText}>{copy.send}</Text>
              )}
            </Pressable>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F8F5' },
  header: {
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5ECE6',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 13,
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
  brand: { color: '#16804A', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  headerTitle: { color: '#15251A', fontWeight: '900', fontSize: 19, marginTop: 8 },
  connection: { fontSize: 11, marginTop: 4 },
  connected: { color: '#16804A' },
  disconnected: { color: '#89958B' },
  messages: { flex: 1 },
  messageContent: { padding: 16, paddingBottom: 24 },
  messageRow: { flexDirection: 'row', marginVertical: 5 },
  messageRowOwn: { justifyContent: 'flex-end' },
  messageRowOther: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '84%',
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingTop: 10,
    paddingBottom: 8,
  },
  bubbleOwn: { backgroundColor: '#16804A', borderBottomRightRadius: 4 },
  bubbleOther: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderBottomLeftRadius: 4,
  },
  messageText: { color: '#15251A', fontSize: 15, lineHeight: 21 },
  messageTextOwn: { color: '#FFFFFF' },
  messageTime: { color: '#89958B', fontSize: 10, marginTop: 6, textAlign: 'right' },
  messageTimeOwn: { color: '#D7F0DF' },
  receipt: { color: '#D7F0DF', fontSize: 10, textAlign: 'right', marginTop: 2 },
  empty: { color: '#66736A', textAlign: 'center', marginTop: 50 },
  olderButton: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  olderText: { color: '#16804A', fontSize: 12, fontWeight: '800' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 9,
    paddingHorizontal: 13,
    paddingVertical: 11,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5ECE6',
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#F5F8F5',
    color: '#15251A',
    borderWidth: 1,
    borderColor: '#DDE6DE',
  },
  sendButton: {
    minWidth: 70,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#16804A',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  sendText: { color: '#FFFFFF', fontWeight: '800' },
  sendingContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  disabled: { opacity: 0.55 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { color: '#66736A', marginTop: 10 },
  errorBanner: { backgroundColor: '#FCECEC', padding: 12 },
  errorText: { color: '#8E2525', lineHeight: 20, textAlign: 'center' },
  retryButton: {
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#16804A',
    marginTop: 12,
  },
  retryText: { color: '#16804A', fontWeight: '800', marginTop: 8 },
});
