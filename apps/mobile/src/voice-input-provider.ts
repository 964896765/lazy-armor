export type VoiceInputState = 'IDLE' | 'LISTENING' | 'TRANSCRIBING' | 'ERROR';
export interface VoiceInputSnapshot { state: VoiceInputState; error: string | null }
export interface VoiceInputProvider {
  start(onTranscribing: () => void): Promise<string>;
  cancel(): Promise<void>;
}

/** Only returns editable text. This controller has no send/action/execution dependency. */
export class VoiceInputController {
  private generation = 0;
  private cancelInFlight: Promise<void> | null = null;
  private releaseRecognizer(): Promise<void> {
    if (!this.cancelInFlight) this.cancelInFlight = this.provider.cancel().catch(() => undefined).finally(() => { this.cancelInFlight = null; });
    return this.cancelInFlight;
  }
  private timer?: ReturnType<typeof setTimeout>;
  private snapshot: VoiceInputSnapshot = { state: 'IDLE', error: null };
  constructor(private readonly provider: VoiceInputProvider, private readonly changed: (snapshot: VoiceInputSnapshot) => void, private readonly timeoutMs = 45000) {}
  private update(state: VoiceInputState, error: string | null = null) {
    this.snapshot = { state, error }; this.changed(this.snapshot);
  }
  async start(): Promise<string | null> {
    if (this.cancelInFlight) return null;
    if (this.snapshot.state === 'LISTENING' || this.snapshot.state === 'TRANSCRIBING') return null;
    const generation = ++this.generation;
    this.update('LISTENING');
    this.timer = setTimeout(() => {
      if (generation !== this.generation) return;
      ++this.generation;
      this.update('ERROR', '语音输入超时，请重试');
      void this.releaseRecognizer();
    }, this.timeoutMs);
    try {
      const text = await this.provider.start(() => { if (generation === this.generation) this.update('TRANSCRIBING'); });
      if (generation !== this.generation) return null;
      if (!text.trim()) throw new Error('没有识别到语音内容，请重试');
      this.update('IDLE');
      return text.trim().slice(0, 12000);
    } catch (error) {
      if (generation === this.generation) this.update('ERROR', error instanceof Error ? error.message : '语音识别失败，请重试');
      return null;
    } finally { if (generation === this.generation) clearTimeout(this.timer); }
  }
  async cancel(): Promise<void> {
    ++this.generation; clearTimeout(this.timer); this.update('IDLE');
    await this.releaseRecognizer();
  }
}
