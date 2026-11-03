import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveLanguage, type Language } from './translations';

const languageStorageKey = 'nsomex-language';

export function usePersistentLanguage(value?: string | string[]) {
  const routeLanguage = Array.isArray(value) ? value[0] : value;
  const [language, setLanguageState] = useState<Language>(() => resolveLanguage(routeLanguage));
  const [ready, setReady] = useState(Boolean(routeLanguage));

  useEffect(() => {
    if (routeLanguage) return;

    let active = true;
    void AsyncStorage.getItem(languageStorageKey)
      .then((savedLanguage) => {
        if (active) setLanguageState(resolveLanguage(savedLanguage ?? undefined));
      })
      .catch((error: unknown) => {
        console.error('Unable to restore the preferred language', error);
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, [routeLanguage]);

  useEffect(() => {
    if (!ready) return;
    void AsyncStorage.setItem(languageStorageKey, language).catch((error: unknown) => {
      console.error('Unable to save the preferred language', error);
    });
  }, [language, ready]);

  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage);
  }, []);

  return [language, setLanguage] as const;
}
