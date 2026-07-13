declare module "@echogarden/espeak-ng-emscripten" {
  interface ESpeakEvent {
    type: string;
    text_position: number;
    word_length: number;
    audio_position: number;
  }

  interface ESpeakEngine {
    samplerate: number;
    set_voice(voice: string): void;
    set_rate(rate: number): void;
    set_pitch(pitch: number): void;
    synthesize(
      text: string,
      callback: (samples: Int16Array, events: ESpeakEvent[]) => boolean,
    ): void;
  }

  interface ESpeakModule {
    eSpeakNGWorker: new () => ESpeakEngine;
  }

  export default function createESpeakModule(): Promise<ESpeakModule>;
}
