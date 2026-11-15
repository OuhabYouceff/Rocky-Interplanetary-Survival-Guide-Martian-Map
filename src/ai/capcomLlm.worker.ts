// WebLLM runs here, off the main thread, so model load / shader compile / decoding never janks the map.
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
