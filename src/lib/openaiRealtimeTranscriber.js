import { createRealtimeTranscriptionSession } from "./realtimeSessionClient";

const REALTIME_WEBRTC_URL = "https://api.openai.com/v1/realtime?intent=transcription";

const pickClientSecret = (payload) =>
  payload?.session?.client_secret?.value ||
  payload?.session?.client_secret ||
  payload?.client_secret?.value ||
  payload?.client_secret ||
  "";

const resolveTextChunk = (event) =>
  event?.delta ||
  event?.transcript ||
  event?.text ||
  event?.item?.delta ||
  event?.item?.transcript ||
  "";

export class OpenAIRealtimeTranscriber {
  constructor(options = {}) {
    this.options = options;
    this.pc = null;
    this.dc = null;
    this.stream = null;
    this.active = false;
  }

  emit(name, payload) {
    const handler = this.options?.[name];
    if (typeof handler === "function") handler(payload);
  }

  async start(config = {}) {
    if (this.active) await this.stop();
    this.active = true;
    this.emit("onStatus", { state: "connecting" });

    try {
      const sessionPayload = await createRealtimeTranscriptionSession(config);
      const ephemeralKey = pickClientSecret(sessionPayload);
      if (!ephemeralKey) {
        throw new Error("Missing ephemeral client secret from /api/realtime/session");
      }

      const pc = new RTCPeerConnection();
      this.pc = pc;
      pc.onconnectionstatechange = () => {
        this.emit("onStatus", { state: pc.connectionState });
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          noiseSuppression: true,
          autoGainControl: true,
          echoCancellation: true,
        },
      });
      this.stream = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      dc.onopen = () => this.emit("onStatus", { state: "data-channel-open" });
      dc.onclose = () => this.emit("onStatus", { state: "data-channel-closed" });
      dc.onerror = (err) => this.emit("onError", err);
      dc.onmessage = (msg) => this.handleDataChannelMessage(msg);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetch(REALTIME_WEBRTC_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      const answerSdp = await sdpResponse.text();
      if (!sdpResponse.ok) {
        throw new Error(answerSdp || `Realtime SDP failed (${sdpResponse.status})`);
      }
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      this.emit("onStatus", { state: "connected", session: sessionPayload.session });
      return { session: sessionPayload.session };
    } catch (err) {
      this.emit("onError", err);
      await this.stop();
      throw err;
    }
  }

  handleDataChannelMessage(messageEvent) {
    try {
      const event = JSON.parse(messageEvent.data);
      this.emit("onEvent", event);
      const type = event?.type || "";
      const text = resolveTextChunk(event);

      if (
        type === "conversation.item.input_audio_transcription.delta" ||
        type === "response.audio_transcript.delta"
      ) {
        this.emit("onInterim", text);
      }

      if (
        type === "conversation.item.input_audio_transcription.completed" ||
        type === "response.audio_transcript.done"
      ) {
        this.emit("onFinal", text);
      }
    } catch (err) {
      this.emit("onError", err);
    }
  }

  async stop() {
    this.active = false;
    if (this.dc) {
      try {
        this.dc.close();
      } catch {
        // noop
      }
      this.dc = null;
    }
    if (this.pc) {
      try {
        this.pc.getSenders().forEach((sender) => sender.track?.stop());
        this.pc.close();
      } catch {
        // noop
      }
      this.pc = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.emit("onStatus", { state: "stopped" });
  }
}
