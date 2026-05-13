/**
 * SDR domain via custom `arcpx.sdr.*.v1` extension messages.
 *
 * Tune to 145.500 MHz (2 m FM calling), capture 5 s of IQ at 2.048 MS/s,
 * NBFM-demodulate to 48 kHz PCM. Exercises §21 naming, capability
 * advertisement, and unknown-message handling.
 */
import { randomUUID } from "node:crypto";
import type { BaseEnvelope } from "../../src/index.js";
import {
  type ARCPClient,
  buildEnvelope,
  NotImplementedError,
  newMessageId,
  nowTimestamp,
} from "../../src/index.js";

const EXT_TUNE = "arcpx.sdr.tune.v1";
const EXT_GAIN = "arcpx.sdr.gain.v1";
const EXT_CAPTURE = "arcpx.sdr.capture.v1";
const EXT_DEMODULATE = "arcpx.sdr.demodulate.v1";
const ALL_EXTENSIONS = [EXT_TUNE, EXT_GAIN, EXT_CAPTURE, EXT_DEMODULATE];

declare function request(
  client: ARCPClient,
  env: BaseEnvelope,
  timeoutMs: number,
): Promise<BaseEnvelope>;
declare function advertisedExtensions(client: ARCPClient): string[];

async function main(): Promise<void> {
  // capabilities.extensions=ALL_EXTENSIONS on the open call.
  const client = null as unknown as ARCPClient;

  // If the runtime didn't advertise our required extension set,
  // refuse the session — RFC §7 / §21.2.
  const advertised = new Set(advertisedExtensions(client));
  if (!ALL_EXTENSIONS.every((e) => advertised.has(e))) {
    throw new NotImplementedError(`runtime missing SDR extensions: ${[...advertised].join(",")}`);
  }

  const handle = randomUUID().slice(0, 8);

  await request(
    client,
    buildEnvelope({
      id: newMessageId(),
      type: EXT_TUNE,
      timestamp: nowTimestamp(),
      payload: { center_freq_hz: 145_500_000, sample_rate_hz: 2_048_000, ppm_correction: 1 },
    }) as BaseEnvelope,
    10_000,
  );
  await request(
    client,
    buildEnvelope({
      id: newMessageId(),
      type: EXT_GAIN,
      timestamp: nowTimestamp(),
      payload: { stages: [{ name: "TUNER", value_db: 28.0 }] },
    }) as BaseEnvelope,
    10_000,
  );

  // Capture returns an artifact.ref pointing at the IQ buffer.
  // The buffer never travels inline — demodulate references it.
  const cap = await request(
    client,
    buildEnvelope({
      id: newMessageId(),
      type: EXT_CAPTURE,
      timestamp: nowTimestamp(),
      payload: { seconds: 5.0, capture_handle: handle, decimate: 1 },
    }) as BaseEnvelope,
    15_000,
  );
  const iqArtifact = String((cap.payload as { artifact_id: string }).artifact_id);
  process.stdout.write(`captured IQ → ${iqArtifact}\n`);

  const audio = await request(
    client,
    buildEnvelope({
      id: newMessageId(),
      type: EXT_DEMODULATE,
      timestamp: nowTimestamp(),
      payload: { iq_artifact_id: iqArtifact, mode: "NBFM", audio_rate_hz: 48_000 },
    }) as BaseEnvelope,
    15_000,
  );
  process.stdout.write(`demod  PCM → ${(audio.payload as { artifact_id?: string }).artifact_id}\n`);

  // §21.3 demonstration: unadvertised extension marked optional.
  // Runtime SHOULD ack (silent drop) rather than nack.
  const optional = await request(
    client,
    buildEnvelope({
      id: newMessageId(),
      type: "arcpx.sdr.experimental_doppler.v1",
      timestamp: nowTimestamp(),
      optional: { extensions: { optional: true } },
      payload: { velocity_mps: 7.4 },
    }) as BaseEnvelope,
    5_000,
  );
  process.stdout.write(`optional unknown → ${optional.type}\n`);

  await client.close();
}

void main();
