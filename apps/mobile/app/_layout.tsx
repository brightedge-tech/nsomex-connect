import { useEffect, useRef, useState } from 'react';
import {
  Stack,
  router,
  useGlobalSearchParams,
  usePathname,
  useRootNavigationState,
  type Href,
} from 'expo-router';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { refreshRegisteredAndroidPushDevice } from '../lib/pushNotifications';
import { appendQueryParams, sanitizeReturnTo } from '../lib/auth';
import type { Language } from '../lib/translations';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function openNotificationDestination(data: Record<string, unknown>) {
  const language: Language = data.language === 'fr' ? 'fr' : 'en';
  switch (data.route) {
    case 'booking':
      router.push({
        pathname: '/bookings',
        params: {
          language,
          ...(isUuid(data.bookingId) ? { bookingId: data.bookingId } : {}),
        },
      } as Href);
      break;
    case 'provider_requests':
      router.push({
        pathname: '/provider/requests',
        params: {
          language,
          ...(isUuid(data.requestId) ? { requestId: data.requestId } : {}),
        },
      } as Href);
      break;
    case 'provider_jobs':
      router.push({
        pathname: '/provider/jobs',
        params: {
          language,
          ...(isUuid(data.bookingId) ? { bookingId: data.bookingId } : {}),
        },
      } as Href);
      break;
    case 'booking_confirmation':
      if (isUuid(data.requestId)) {
        router.push({
          pathname: '/bookings/confirm/[requestId]',
          params: { requestId: data.requestId, language },
        } as Href);
      }
      break;
    case 'conversation':
      if (isUuid(data.conversationId)) {
        router.push({
          pathname: '/messages/[conversationId]',
          params: { conversationId: data.conversationId, language },
        } as Href);
      }
      break;
    case 'provider_verification':
      if (isUuid(data.applicationId)) {
        router.push({
          pathname: '/provider/verification/[id]',
          params: { id: data.applicationId, language },
        } as Href);
      }
      break;
    case 'home':
      router.push({ pathname: '/', params: { language } } as Href);
      break;
    default:
      break;
  }
}

function useNotificationObserver() {
  const handledNotifications = useRef(new Set<string>());

  useEffect(() => {
    function redirect(response: Notifications.NotificationResponse) {
      const notification = response.notification;
      const identifier = notification.request.identifier;
      if (handledNotifications.current.has(identifier)) return;
      handledNotifications.current.add(identifier);
      if (handledNotifications.current.size > 25) {
        const oldest = handledNotifications.current.values().next().value;
        if (oldest) handledNotifications.current.delete(oldest);
      }
      openNotificationDestination(notification.request.content.data ?? {});
    }

    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse) redirect(lastResponse);

    const subscription = Notifications.addNotificationResponseReceivedListener(redirect);
    return () => subscription.remove();
  }, []);
}

function useAndroidPushRegistrationSync() {
  useEffect(() => {
    let active = true;
    const refresh = (force = false) => {
      if (!active) return;
      void refreshRegisteredAndroidPushDevice(force).catch((error: unknown) => {
        console.error('Unable to refresh Android push registration', error);
      });
    };

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setTimeout(refresh, 0);
    });
    const tokenListener = Notifications.addPushTokenListener(() => refresh(true));
    const appStateListener = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    refresh();

    return () => {
      active = false;
      data.subscription.unsubscribe();
      tokenListener.remove();
      appStateListener.remove();
    };
  }, []);
}

function useAuthenticationGuard() {
  const pathname = usePathname();
  const searchParams = useGlobalSearchParams();
  const rootNavigationState = useRootNavigationState();
  const [authStatus, setAuthStatus] = useState<'loading' | 'guest' | 'verified'>('loading');

  const returnTo = appendQueryParams(pathname, searchParams);
  const routeRole = pathname.startsWith('/provider/') ? 'provider' : 'customer';
  const isPublicRoute =
    pathname === '/' ||
    pathname === '/join' ||
    pathname === '/account' ||
    pathname === '/auth/verify';

  useEffect(() => {
    let active = true;
    const updateStatus = async (session: Session | null) => {
      if (!active) return;
      if (!session) {
        setAuthStatus('guest');
        return;
      }
      if (!session.user.phone_confirmed_at) {
        setTimeout(() => {
          void supabase.auth
            .signOut({ scope: 'local' })
            .then(({ error }) => {
              if (error) console.error('Unable to clear an unverified session', error);
            })
            .catch((error: unknown) => {
              console.error('Unable to clear an unverified session', error);
            });
        }, 0);
        if (active) setAuthStatus('guest');
        return;
      }
      setAuthStatus('verified');
    };

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void updateStatus(session);
    });
    void supabase.auth
      .getSession()
      .then(({ data: sessionData, error }) => {
        if (error) {
          console.error('Unable to restore the authentication session', error);
          if (active) setAuthStatus('guest');
          return;
        }
        return updateStatus(sessionData.session);
      })
      .catch((error: unknown) => {
        console.error('Unable to restore the authentication session', error);
        if (active) setAuthStatus('guest');
      });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!rootNavigationState?.key || authStatus === 'loading' || isPublicRoute) return;
    if (authStatus === 'guest') {
      router.replace({
        pathname: '/account',
        params: {
          role: routeRole,
          mode: 'login',
          returnTo: sanitizeReturnTo(returnTo) ?? undefined,
        },
      } as Href);
    }
  }, [authStatus, isPublicRoute, returnTo, rootNavigationState?.key, routeRole]);

  return authStatus;
}

export default function RootLayout() {
  useNotificationObserver();
  useAndroidPushRegistrationSync();
  const authStatus = useAuthenticationGuard();

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {authStatus === 'loading' ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#16804A" />
        </View>
      ) : (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#F5F8F5' },
          }}
        />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
