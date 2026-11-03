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
import { router, Stack, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { getTranslations, resolveLanguage, type Language } from '../../lib/translations';

type ReviewBooking = {
  id: string;
  status: string;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function CustomerReviewScreen() {
  const params = useLocalSearchParams<{
    bookingId?: string | string[];
    language?: string | string[];
  }>();
  const bookingId = firstParam(params.bookingId);
  const [language, setLanguage] = useState<Language>(resolveLanguage(firstParam(params.language)));
  const copy = getTranslations(language).customerReviews;
  const [booking, setBooking] = useState<ReviewBooking | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const loadEligibility = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (!bookingId) throw new Error(copy.error);
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userResult.user) throw new Error(copy.signInRequired);

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', userResult.user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) throw new Error(copy.completedBookingOnly);

      const { data: bookingData, error: bookingError } = await supabase
        .from('bookings')
        .select('id, status')
        .eq('id', bookingId)
        .eq('customer_id', profile.id)
        .maybeSingle();
      if (bookingError) throw bookingError;
      if (!bookingData || bookingData.status !== 'completed') {
        setBooking(null);
        return;
      }

      const { data: review, error: reviewError } = await supabase
        .from('reviews')
        .select('id')
        .eq('booking_id', bookingId)
        .maybeSingle();
      if (reviewError) throw reviewError;
      setBooking(bookingData as ReviewBooking);
      setAlreadyReviewed(!!review);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.error);
    } finally {
      setLoading(false);
    }
  }, [bookingId, copy.completedBookingOnly, copy.error, copy.signInRequired]);

  useFocusEffect(
    useCallback(() => {
      void loadEligibility();
    }, [loadEligibility]),
  );

  async function submitReview() {
    if (!booking || alreadyReviewed || submitting) return;
    setError('');
    if (rating < 1 || rating > 5) {
      setError(copy.ratingRequired);
      return;
    }
    setSubmitting(true);
    try {
      const { error: reviewError } = await supabase.rpc('customer_submit_booking_review', {
        p_booking_id: booking.id,
        p_rating: rating,
        p_comment: comment.trim() || null,
      });
      if (reviewError) {
        if (reviewError.code === '23505') {
          setAlreadyReviewed(true);
          throw new Error(copy.alreadyReviewed);
        }
        throw reviewError;
      }
      setSuccess(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.error);
    } finally {
      setSubmitting(false);
    }
  }

  function returnToRequests() {
    router.replace({ pathname: '/bookings', params: { language } } as Href);
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
              >
                <Text style={styles.languageText}>{option.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Text style={styles.brand}>NSOMEX CONNECT</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{copy.title}</Text>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16804A" />
            <Text style={styles.muted}>{copy.loading}</Text>
          </View>
        ) : success ? (
          <View style={styles.card}>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.body}>{copy.success}</Text>
            <Pressable style={styles.primaryButton} onPress={returnToRequests}>
              <Text style={styles.primaryButtonText}>{getTranslations(language).back}</Text>
            </Pressable>
          </View>
        ) : alreadyReviewed ? (
          <View style={styles.card}>
            <Text style={styles.body}>{copy.alreadyReviewed}</Text>
          </View>
        ) : !booking ? (
          <View style={styles.card}>
            <Text style={styles.body}>{error || copy.completedBookingOnly}</Text>
            {error ? (
              <Pressable style={styles.secondaryButton} onPress={() => void loadEligibility()}>
                <Text style={styles.secondaryButtonText}>{copy.retry}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.body}>{copy.completedBookingOnly}</Text>
            <Text style={styles.label}>{copy.rating}</Text>
            <View style={styles.ratingRow}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable
                  key={value}
                  onPress={() => setRating(value)}
                  accessibilityRole="button"
                  accessibilityLabel={`${value} stars`}
                  accessibilityState={{ selected: rating === value }}
                >
                  <Text style={[styles.star, value <= rating && styles.starSelected]}>★</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>{copy.comment}</Text>
            <TextInput
              style={styles.commentInput}
              placeholder={copy.commentPlaceholder}
              placeholderTextColor="#89958A"
              value={comment}
              onChangeText={setComment}
              maxLength={5000}
              multiline
              textAlignVertical="top"
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable
              style={[styles.primaryButton, submitting && styles.disabled]}
              onPress={() => void submitReview()}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>{copy.submit}</Text>
              )}
            </Pressable>
          </View>
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
  title: { color: '#15251A', fontSize: 26, fontWeight: '900', marginBottom: 15 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EAE3',
    borderRadius: 15,
    padding: 17,
  },
  body: { color: '#536358', fontSize: 14, lineHeight: 21 },
  label: { color: '#16804A', fontSize: 13, fontWeight: '800', marginTop: 18, marginBottom: 8 },
  ratingRow: { flexDirection: 'row', gap: 12, justifyContent: 'center', paddingVertical: 7 },
  star: { color: '#CFD6D0', fontSize: 37 },
  starSelected: { color: '#B27B09' },
  commentInput: {
    minHeight: 115,
    borderWidth: 1,
    borderColor: '#DDE7DF',
    borderRadius: 10,
    padding: 12,
    color: '#15251A',
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: '#16804A',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 17,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  secondaryButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#16804A',
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryButtonText: { color: '#16804A', fontWeight: '800' },
  successIcon: { color: '#16804A', fontSize: 31, fontWeight: '900', marginBottom: 10 },
  errorText: { color: '#A12A2A', marginTop: 10, lineHeight: 20 },
  disabled: { opacity: 0.6 },
  center: { paddingVertical: 50, alignItems: 'center' },
  muted: { color: '#66736A', marginTop: 9 },
});
