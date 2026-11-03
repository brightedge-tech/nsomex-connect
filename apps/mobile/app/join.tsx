import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, type Href } from 'expo-router';
import {
  getTranslations,
  type AuthMode,
  type Language,
  type OnboardingRole,
} from '../lib/translations';

export default function JoinScreen() {
  const [language, setLanguage] = useState<Language>('en');
  const copy = getTranslations(language);

  function openAccount(role: OnboardingRole, mode: AuthMode) {
    router.push({
      pathname: '/account',
      params: { role, mode, language },
    } as unknown as Href);
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: copy.join.title }} />

      <View style={styles.topRow}>
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.back}>‹ {copy.back}</Text>
        </Pressable>
        <View style={styles.languageControl}>
          <Text style={styles.languageLabel}>{copy.language}</Text>
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
                  {option === 'en' ? copy.english : copy.french}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <Text style={styles.brand}>{copy.brand}</Text>
      <Text style={styles.eyebrow}>{copy.join.eyebrow}</Text>
      <Text style={styles.title}>{copy.join.title}</Text>
      <Text style={styles.subtitle}>{copy.join.subtitle}</Text>

      <View style={styles.roleCard}>
        <View style={styles.cardIcon}>
          <Text style={styles.cardIconText}>⌂</Text>
        </View>
        <Text style={styles.cardTitle}>{copy.join.customerTitle}</Text>
        <Text style={styles.cardDescription}>{copy.join.customerDescription}</Text>
        <View style={styles.actions}>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => openAccount('customer', 'login')}
          >
            <Text style={styles.secondaryButtonText}>{copy.join.signIn}</Text>
          </Pressable>
          <Pressable style={styles.primaryButton} onPress={() => openAccount('customer', 'signup')}>
            <Text style={styles.primaryButtonText}>{copy.join.signUp}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.roleCard}>
        <View style={styles.cardIcon}>
          <Text style={styles.cardIconText}>♙</Text>
        </View>
        <Text style={styles.cardTitle}>{copy.join.providerTitle}</Text>
        <Text style={styles.cardDescription}>{copy.join.providerDescription}</Text>
        <View style={styles.actions}>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => openAccount('provider', 'login')}
          >
            <Text style={styles.secondaryButtonText}>{copy.join.signIn}</Text>
          </Pressable>
          <Pressable style={styles.primaryButton} onPress={() => openAccount('provider', 'signup')}>
            <Text style={styles.primaryButtonText}>{copy.join.signUp}</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F8F5' },
  content: { flexGrow: 1, padding: 22, paddingTop: 28, paddingBottom: 40 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 34,
  },
  back: { color: '#16804A', fontSize: 15, fontWeight: '700' },
  languageControl: { alignItems: 'flex-end' },
  languageLabel: { color: '#66736A', fontSize: 11, marginBottom: 5 },
  languageOptions: { flexDirection: 'row', gap: 5 },
  languageOption: {
    borderWidth: 1,
    borderColor: '#DDE6DE',
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#FFFFFF',
  },
  languageOptionActive: { backgroundColor: '#EAF6EE', borderColor: '#16804A' },
  languageOptionText: { color: '#66736A', fontSize: 12, fontWeight: '700' },
  languageOptionTextActive: { color: '#16804A' },
  brand: { color: '#16804A', fontWeight: '900', letterSpacing: 1.4 },
  eyebrow: {
    color: '#78847B',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 27,
  },
  title: {
    color: '#15251A',
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 35,
    marginTop: 8,
  },
  subtitle: { color: '#66736A', fontSize: 15, lineHeight: 22, marginTop: 8 },
  roleCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2EAE3',
    borderWidth: 1,
    borderRadius: 17,
    padding: 18,
    marginTop: 20,
  },
  cardIcon: {
    width: 43,
    height: 43,
    borderRadius: 13,
    backgroundColor: '#EAF6EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconText: { color: '#16804A', fontSize: 24, fontWeight: '800' },
  cardTitle: { color: '#15251A', fontSize: 19, fontWeight: '900', marginTop: 14 },
  cardDescription: { color: '#66736A', fontSize: 14, lineHeight: 21, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#16804A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: '#16804A', fontSize: 14, fontWeight: '800' },
  primaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 11,
    backgroundColor: '#16804A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
