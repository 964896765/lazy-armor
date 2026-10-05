import { useEffect, useMemo, useState } from 'react';
import { nativeVoiceInputProvider } from './native-voice-input';
import { VoiceInputController, type VoiceInputSnapshot } from './voice-input-provider';
export function useVoiceInput() {
  const [snapshot, setSnapshot] = useState<VoiceInputSnapshot>({ state: 'IDLE', error: null });
  const controller = useMemo(() => new VoiceInputController(nativeVoiceInputProvider, setSnapshot), []);
  useEffect(() => () => { void controller.cancel(); }, [controller]);
  return { ...snapshot, start: () => controller.start(), cancel: () => controller.cancel() };
}
