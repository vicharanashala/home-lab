/* Captures raw microphone samples and ships them to the main thread in
   one-second blocks. Working in raw PCM avoids the encode/decode round
   trip that makes MediaRecorder chunks unreliable to transcribe. */

class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(16000);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    let offset = 0;
    while (offset < channel.length) {
      const room = this.buffer.length - this.filled;
      const take = Math.min(room, channel.length - offset);

      this.buffer.set(channel.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;

      if (this.filled === this.buffer.length) {
        this.port.postMessage(this.buffer);
        this.buffer = new Float32Array(16000);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PCMCapture);