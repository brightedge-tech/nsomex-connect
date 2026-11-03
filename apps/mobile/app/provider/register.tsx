import { useState } from 'react';
import {
  Text,
  Pressable,
  TextInput,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router, Stack, type Href } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function ProviderRegistration() {
  const [providerType, setProviderType] = useState<'individual' | 'business' | null>(null);

  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [profession, setProfession] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitRegistration() {
    if (submitting) return;

    if (!providerType) {
      Alert.alert('Choose account type', 'Select individual or business.');
      return;
    }

    if (!fullName.trim() || !phone.trim() || !location.trim() || !profession.trim()) {
      Alert.alert('Missing information', 'Complete your name, phone, location and profession.');
      return;
    }

    if (providerType === 'business' && !businessName.trim()) {
      Alert.alert('Missing information', 'Enter your business name.');
      return;
    }

    setSubmitting(true);

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) throw authError;

      if (!user) {
        Alert.alert(
          'Sign in required',
          'Please sign in to your NSOMEX Connect account before applying.',
        );
        return;
      }

      const { data: existingApplication, error: existingApplicationError } = await supabase
        .from('provider_applications')
        .select('id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingApplicationError) throw existingApplicationError;

      if (existingApplication) {
        router.replace({
          pathname: '/provider/verification/[id]',
          params: { id: existingApplication.id },
        } as unknown as Href);
        return;
      }

      const { data: application, error: applicationError } = await supabase
        .from('provider_applications')
        .insert({
          user_id: user.id,
          provider_type: providerType,
          contact_name: fullName.trim(),
          business_name: providerType === 'business' ? businessName.trim() : null,
          phone: phone.trim(),
          service_location: location.trim(),
          profession: profession.trim(),
          verification_status: 'pending',
        })
        .select('id')
        .single();

      if (applicationError) throw applicationError;

      router.push({
        pathname: '/provider/verification/[id]',
        params: { id: application.id },
      } as unknown as Href);
    } catch (error: any) {
      Alert.alert(
        'Registration failed',
        error?.message || 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: 'Become a Provider' }} />

      <Text style={styles.brand}>NSOMEX CONNECT</Text>
      <Text style={styles.title}>Become a Provider</Text>
      <Text style={styles.subtitle}>
        Offer your professional services to customers on NSOMEX Connect.
      </Text>

      <Text style={styles.heading}>Choose your provider type</Text>

      <Pressable
        style={[styles.option, providerType === 'individual' && styles.selected]}
        onPress={() => setProviderType('individual')}
      >
        <Text style={styles.optionTitle}>Individual Professional</Text>
        <Text style={styles.description}>
          Independent barbers, tailors, drivers, carpenters and skilled professionals.
        </Text>
      </Pressable>

      <Pressable
        style={[styles.option, providerType === 'business' && styles.selected]}
        onPress={() => setProviderType('business')}
      >
        <Text style={styles.optionTitle}>Registered Business</Text>
        <Text style={styles.description}>
          Companies and registered businesses offering professional services.
        </Text>
      </Pressable>

      <Text style={styles.heading}>Your information</Text>

      <Text style={styles.label}>Contact person's full name *</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter full name"
        value={fullName}
        onChangeText={setFullName}
      />

      {providerType === 'business' && (
        <>
          <Text style={styles.label}>Business name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Registered business name"
            value={businessName}
            onChangeText={setBusinessName}
          />
        </>
      )}

      <Text style={styles.label}>Phone number *</Text>
      <TextInput
        style={styles.input}
        placeholder="Include country code"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
      />

      <Text style={styles.label}>City or service location *</Text>
      <TextInput
        style={styles.input}
        placeholder="Example: Douala, Cameroon"
        value={location}
        onChangeText={setLocation}
      />

      <Text style={styles.label}>Your profession *</Text>
      <TextInput
        style={styles.input}
        placeholder="Example: Barber, Tailor, Driver"
        value={profession}
        onChangeText={setProfession}
      />

      <Pressable
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={submitRegistration}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>Submit Application</Text>
        )}
      </Pressable>

      <Text style={styles.footer}>
        Applications remain pending until reviewed and approved by NSOMEX.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F8F5' },
  content: { padding: 22, paddingBottom: 50 },
  brand: { color: '#16804A', fontWeight: '800', letterSpacing: 1.5 },
  title: {
    fontSize: 30,
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
  heading: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 28,
    marginBottom: 12,
    color: '#15251A',
  },
  option: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5ECE6',
    borderRadius: 14,
    padding: 17,
    marginBottom: 11,
  },
  selected: {
    borderColor: '#16804A',
    borderWidth: 2,
    backgroundColor: '#EAF6EE',
  },
  optionTitle: { fontSize: 16, fontWeight: '800', color: '#15251A' },
  description: { marginTop: 7, color: '#66736A', lineHeight: 21 },
  label: {
    fontWeight: '700',
    color: '#263B2D',
    marginTop: 15,
    marginBottom: 7,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE6DE',
    borderRadius: 11,
    padding: 14,
    fontSize: 15,
  },
  button: {
    backgroundColor: '#16804A',
    padding: 17,
    borderRadius: 13,
    alignItems: 'center',
    marginTop: 30,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  footer: {
    textAlign: 'center',
    color: '#78847B',
    marginTop: 20,
    lineHeight: 20,
  },
});
