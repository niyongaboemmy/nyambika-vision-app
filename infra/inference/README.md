# Self-hosted inference pool (E42, AI-GW-07)

Helm chart for a GPU node pool serving permissively licensed models to the AI gateway. Licences and the
model choices are in [ADR-0007](../../docs/adr/0007-self-hosted-inference.md). **Not deployed or tested on real
GPUs**: there was no cluster or GPU while this was written. Locally the same wire protocols are served by the fake
pool (`apps/ai/app/fake_pool.py`).

## What runs where
| Route (gateway) | Server | Protocol | Default model |
|---|---|---|---|
| `llm` (insights / listing phrasing) | vLLM | OpenAI `/v1/chat/completions` | Mistral-7B-Instruct-v0.3 (Apache-2.0) |
| `stt` (Muse voice) | vLLM | OpenAI `/v1/audio/transcriptions` | whisper-large-v3-turbo (MIT) |
| `tryon` | KServe v2 `vton` | `/v2/models/vton/infer` | in-house compositor until a licensed VTON passes the NLB |
| `video` | KServe v2 `video-vton` | `/v2/models/video-vton/infer` | slot, disabled (needs licensed weights + NLB video pass) |
| `avatar` | KServe v2 `avatar` | `/v2/models/avatar/infer` | slot, disabled (SMPL-X needs a commercial licence) |

## Deploy
1. GPU node pool in the approved region (example, GKE in a region serving Rwanda; adapt for your provider):
   `gcloud container node-pools create gpu-inference --cluster nyambika --machine-type g2-standard-8 --accelerator type=nvidia-l4,count=1,gpu-driver-version=latest --num-nodes 1 --enable-autoscaling --min-nodes 1 --max-nodes 4 --node-labels nyambika.rw/pool=gpu-inference --node-taints nvidia.com/gpu=present:NoSchedule`
2. Prerequisites: NVIDIA device plugin + DCGM exporter (for the GPU-utilisation HPA), KServe in RawDeployment mode,
   ingress-nginx, a `inference-pool-key` secret (`token`) and an auth service for the ingress `auth-url`.
3. `helm upgrade --install inference infra/inference/chart -n inference --create-namespace -f my-values.yaml`
4. Gateway env: `INFERENCE_ROUTING=1 INFERENCE_POOL_URL=https://inference.internal.nyambika.rw INFERENCE_POOL_KEY=… INFERENCE_POOL_REGION=rw`
   and `VTON_PROVIDER=routed STT_PROVIDER=routed` to send try-on and speech through the router.
5. Load test each model (`loadtest.py`), set the pool cost per call in Admin → Flags & models → Inference
   (GPU-hour price ÷ sustained calls per hour at 70 % utilisation), and keep `strategy: cost` so the router prefers
   the pool only while it meets the latency SLO.

## Local demo
```
cd apps/ai
uvicorn app.fake_pool:app --port 8144 &
INFERENCE_ROUTING=1 VTON_PROVIDER=routed STT_PROVIDER=routed INFERENCE_POOL_URL=http://localhost:8144 \
  INFERENCE_HEALTH_INTERVAL_S=2 uvicorn app.main:app --port 8104
python ../../infra/inference/loadtest.py --url http://localhost:8144 --model llm -c 8 -d 10
```
Then in Admin → Flags & models → Inference: send test traffic, press **Fail** (pool errors while health says ready →
breaker opens after 3 failures → calls fall back to hosted), **Down** (health check DOWN → pool skipped), **Healthy**
(after the cool-down one half-open trial closes the breaker and traffic returns to the pool).
