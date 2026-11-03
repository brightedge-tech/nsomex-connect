import { router, type Href } from 'expo-router';
import { supabase } from './supabase';
import type { Language } from './translations';

type StartConversationOptions = {
  bookingId?: string;
  requestId?: string;
  providerId?: string;
  language: Language;
};

export async function startConversationAndNavigate({
  bookingId,
  requestId,
  providerId,
  language,
}: StartConversationOptions) {
  if ((bookingId === undefined) === (requestId === undefined)) {
    throw new Error('Choose exactly one booking or service request.');
  }

  let resolvedProviderId = providerId;
  if (requestId && !resolvedProviderId) {
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!userResult.user) throw new Error('Sign in to start a conversation.');

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', userResult.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) throw new Error('Your account profile could not be found.');

    const { data: provider, error: providerError } = await supabase
      .from('provider_profiles')
      .select('id')
      .eq('profile_id', profile.id)
      .maybeSingle();
    if (providerError) throw providerError;
    if (!provider) throw new Error('Your provider profile could not be found.');
    resolvedProviderId = provider.id;
  }

  const { data: conversationId, error } = await supabase.rpc('start_conversation', {
    p_booking_id: bookingId ?? null,
    p_request_id: requestId ?? null,
    p_provider_id: resolvedProviderId ?? null,
  });
  if (error) throw error;
  if (typeof conversationId !== 'string' || !conversationId) {
    throw new Error('The conversation could not be opened.');
  }

  router.push({
    pathname: '/messages/[conversationId]',
    params: { conversationId, language },
  } as Href);
}
