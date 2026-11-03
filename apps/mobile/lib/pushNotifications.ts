import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';

const storedPushTokenKey = 'nsomex-connect.android-expo-push-token';

export type PushRegistrationFailure =
  | 'androidOnly'
  | 'physicalDeviceRequired'
  | 'projectIdMissing'
  | 'permissionDenied'
  | 'registrationFailed';

export class PushRegistrationError extends Error {
  constructor(readonly reason: PushRegistrationFailure) {
    super(reason);
    this.name = 'PushRegistrationError';
  }
}

function getProjectId() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
    null
  );
}

async function getExpoPushToken() {
  const projectId = getProjectId();
  if (!projectId) throw new PushRegistrationError('projectIdMissing');
  const result = await Notifications.getExpoPushTokenAsync({ projectId });
  return result.data;
}

export async function registerCurrentAndroidPushDevice() {
  if (Platform.OS !== 'android') throw new PushRegistrationError('androidOnly');
  if (!Device.isDevice) throw new PushRegistrationError('physicalDeviceRequired');

  await Notifications.setNotificationChannelAsync('default', {
    name: 'Service updates',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#16804A',
  });

  const existing = await Notifications.getPermissionsAsync();
  const permission =
    existing.status === 'granted' ? existing : await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') throw new PushRegistrationError('permissionDenied');

  let token: string;
  try {
    token = await getExpoPushToken();
  } catch (error) {
    if (error instanceof PushRegistrationError) throw error;
    throw new PushRegistrationError('registrationFailed');
  }

  const previousToken = await SecureStore.getItemAsync(storedPushTokenKey);
  const { error: registerError } = await supabase.rpc('register_push_device', {
    p_expo_push_token: token,
    p_device_name: Device.modelName ?? Device.brand ?? 'Android device',
  });
  if (registerError) throw new PushRegistrationError('registrationFailed');

  if (previousToken && previousToken !== token) {
    const { error: unregisterError } = await supabase.rpc('unregister_push_device', {
      p_expo_push_token: previousToken,
    });
    if (unregisterError) {
      const { error: rollbackError } = await supabase.rpc('unregister_push_device', {
        p_expo_push_token: token,
      });
      if (rollbackError) throw rollbackError;
      throw new PushRegistrationError('registrationFailed');
    }
  }

  try {
    await SecureStore.setItemAsync(storedPushTokenKey, token);
  } catch (error) {
    const { error: unregisterError } = await supabase.rpc('unregister_push_device', {
      p_expo_push_token: token,
    });
    if (unregisterError) throw unregisterError;
    throw error;
  }
}

export async function refreshRegisteredAndroidPushDevice(force = false) {
  if (Platform.OS !== 'android' || !Device.isDevice) return;

  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') return;

  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userResult.user) return;

  const { data: preferences, error: preferenceError } = await supabase
    .from('notification_preferences')
    .select('push_enabled')
    .eq('user_id', userResult.user.id)
    .maybeSingle();
  if (preferenceError) throw preferenceError;

  const registeredToken = await SecureStore.getItemAsync(storedPushTokenKey);
  if (preferences?.push_enabled && (force || !registeredToken)) {
    await registerCurrentAndroidPushDevice();
  }
}

export async function unregisterCurrentAndroidPushDevice() {
  if (Platform.OS !== 'android') return;
  const token = await SecureStore.getItemAsync(storedPushTokenKey);
  if (!token) return;

  const { error } = await supabase.rpc('unregister_push_device', {
    p_expo_push_token: token,
  });
  if (error) throw error;
  await SecureStore.deleteItemAsync(storedPushTokenKey);
}
