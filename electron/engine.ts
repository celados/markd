import * as v from "valibot";
import {
  engineReadySchema,
  engineRequestSchema,
  engineResponseSchema,
  type EngineResponse,
} from "./bridge-contract";

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error("Markd Engine requires an Electron utility-process parent port");
}

parentPort.once("message", (event) => {
  const port = event.ports[0];
  const epoch =
    event.data && typeof event.data === "object" && "epoch" in event.data
      ? Number(event.data.epoch)
      : 0;
  if (!port || !Number.isInteger(epoch) || epoch < 1) {
    throw new Error("Markd Engine received an invalid renderer channel");
  }

  const becomeReady = () => {
    port.on("message", (messageEvent) => {
      const parsed = v.safeParse(engineRequestSchema, messageEvent.data);
      if (!parsed.success) {
        console.error("[markd-engine] rejected invalid request");
        process.exit(1);
        return;
      }

      const request = parsed.output;
      const response: EngineResponse = {
        type: "response",
        id: request.id,
        epoch,
        ok: true,
        value: null,
      };
      port.postMessage(v.parse(engineResponseSchema, response));
    });
    port.start();
    port.postMessage(v.parse(engineReadySchema, { type: "ready", epoch }));
    console.log(`[markd-engine] ready epoch=${epoch}`);
  };

  const delay = Number(process.env.MARKD_ENGINE_READY_DELAY_MS ?? 0);
  if (Number.isFinite(delay) && delay > 0) {
    setTimeout(becomeReady, delay);
  } else {
    becomeReady();
  }
});
