import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface ShowroomModeContextType {
  isShowroomMode: boolean;
  toggleShowroomMode: () => void;
  setShowroomMode: (val: boolean) => void;
}

const STORAGE_KEY = 'synergy:showroom_client_mode';

const ShowroomModeContext = createContext<ShowroomModeContextType>({
  isShowroomMode: false,
  toggleShowroomMode: () => {},
  setShowroomMode: () => {},
});

export function ShowroomModeProvider({ children }: { children: ReactNode }) {
  const [isShowroomMode, setIsShowroomModeState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const setShowroomMode = useCallback((val: boolean) => {
    setIsShowroomModeState(val);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, String(val));
      } catch {
        // Ignore storage write issues
      }
    }
  }, []);

  const toggleShowroomMode = useCallback(() => {
    setShowroomMode(!isShowroomMode);
  }, [isShowroomMode, setShowroomMode]);

  // Synchronize state across tabs if opened in multiple showroom windows
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue !== null) {
        setIsShowroomModeState(e.newValue === 'true');
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return (
    <ShowroomModeContext.Provider value={{ isShowroomMode, toggleShowroomMode, setShowroomMode }}>
      {children}
    </ShowroomModeContext.Provider>
  );
}

export function useShowroomMode() {
  return useContext(ShowroomModeContext);
}
export default ShowroomModeContext;
