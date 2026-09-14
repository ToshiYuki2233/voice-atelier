// Owns all microphone resources. A generation token invalidates late permissions.
export class AudioSession {
  constructor({ mediaDevices, AudioContextClass, onInterrupted = () => {} }) {
    this.mediaDevices = mediaDevices;
    this.AudioContextClass = AudioContextClass;
    this.onInterrupted = onInterrupted;
    this.generation = 0;
    this.resources = null;
  }

  async start() {
    this.stop();
    const generation = this.generation;
    const context = new this.AudioContextClass();
    const resources = { context, stream: null, source: null, analyser: null, gain: null, samples: null, active: false };
    this.resources = resources;
    // Called directly from the tap, before awaiting the permission prompt (iPad).
    const resumed = context.resume();
    resumed.catch(() => {});
    const interrupt = () => {
      if (this.resources !== resources) return;
      this.stop();
      this.onInterrupted();
    };
    context.onstatechange = () => {
      if (resources.active && context.state !== 'running') interrupt();
    };
    try {
      const stream = await this.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: { ideal: false },
          noiseSuppression: { ideal: false },
          autoGainControl: { ideal: false }
        },
        video: false
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop());
        return null;
      }
      resources.stream = stream;
      stream.getTracks().forEach(track => {
        track.addEventListener('ended', interrupt);
        track.addEventListener('mute', interrupt);
      });
      await resumed;
      if (generation !== this.generation) return null;
      if (context.state !== 'running') throw new Error('AudioContextNotRunning');
      if (stream.getAudioTracks().some(track => track.readyState === 'ended' || track.muted)) {
        throw new Error('InputUnavailable');
      }
      resources.source = context.createMediaStreamSource(stream);
      resources.analyser = context.createAnalyser();
      resources.analyser.fftSize = 4096;
      resources.analyser.smoothingTimeConstant = 0;
      resources.gain = context.createGain();
      resources.gain.gain.value = 0; // Keep graph processing without microphone playback.
      resources.source.connect(resources.analyser);
      resources.analyser.connect(resources.gain);
      resources.gain.connect(context.destination);
      resources.samples = new Float32Array(resources.analyser.fftSize);
      resources.active = true;
      return resources;
    } catch (error) {
      if (generation !== this.generation) return null;
      this.stop();
      throw error;
    }
  }

  stop() {
    this.generation++;
    const resources = this.resources;
    this.resources = null;
    if (!resources) return;
    resources.active = false;
    resources.context.onstatechange = null;
    resources.stream?.getTracks().forEach(track => track.stop());
    resources.source?.disconnect();
    resources.analyser?.disconnect();
    resources.gain?.disconnect();
    resources.samples?.fill(0);
    if (resources.context.state !== 'closed') resources.context.close().catch(() => {});
  }
}

// Keeps the screen on only while the microphone is in use. On iPad, auto-lock
// hides the page, and a hidden page must stop the microphone, so without this a
// pause between takes could end the session in front of the audience. Nothing is
// held while idle, and a stop that lands while a request is still pending
// releases the lock as soon as it arrives.
export class ScreenAwake {
  constructor(wakeLock) {
    this.wakeLock = wakeLock;
    this.sentinel = null;
    this.generation = 0;
  }

  get supported() {
    return typeof this.wakeLock?.request === 'function';
  }

  async acquire() {
    const generation = ++this.generation;
    if (!this.supported) return 'unsupported';
    try {
      const sentinel = await this.wakeLock.request('screen');
      if (generation !== this.generation) {
        sentinel?.release?.().catch?.(() => {});
        return 'cancelled';
      }
      this.sentinel = sentinel;
      return 'held';
    } catch {
      return 'refused';
    }
  }

  release() {
    this.generation++;
    const sentinel = this.sentinel;
    this.sentinel = null;
    sentinel?.release?.().catch?.(() => {});
  }
}
