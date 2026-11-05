# Phase A — GPU host preparation (H100 host `school-hack-h100-100`, 93.119.168.123)

All timestamps UTC. Raw outputs: nvidia-smi-before.txt, inventory-before-*.txt, du-before.txt,
deleted-paths.txt, nvidia-smi-after.txt.

## Findings (2026-11-03T08:39Z)
Host has **7** H100 80GB GPUs visible (indices 0-6), not 6. DeepSeek model serving found:

| What | Owner | GPUs | Action |
|---|---|---|---|
| `llama-dsv41.service` — llama.cpp `llama-server` serving DeepSeek-V4.1-Flash-1017-abliterated (Mix-128G GGUF, 6-GPU split) + `cloudflared-dsv41.service` tunnel | user mk.thomas (systemd) | 0,1,2,3,4,5 | **stopped + disabled** 2026-11-03T08:43:27Z |
| weights `/localstorage/mk.thomas/models/dsv41-gguf` (Mix-128G 5 shards 210G + 2 mmproj 1.9G = **211G**) | mk.thomas | — | **deleted** `rm -rf /localstorage/mk.thomas/models/dsv41-gguf` at 08:43:38Z |
| k8s pods `byom/byom-35dc9378a949493`, `byom/byom-515f649affa24c6` — vLLM `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` (16G emptyDir cache each) | Kubernetes (byom namespace, Deployment-managed, root containers) | 0, 5 | **NOT stopped** — node credentials can `delete pods` but cannot list/scale/patch the owning Deployments; a pod delete would be recreated by the controller within seconds and re-download the weights. Left running; needs cluster-admin action. |
| k8s pods `default/deepseek-ocr-omer`, `default/deepseek-ocr-pdf` — DeepSeek-OCR vLLM servers (6.3-6.4G weights in image) | Kubernetes (Deployment-managed) | 3, 4 | **NOT stopped** — same reason. |
| `/root/gemma4_serve.py` (python, 11G) | root | 1 | not DeepSeek — untouched |

No Ollama installed (`ollama` not found); no `~/.cache/huggingface/hub/models--deepseek-ai--*` on the host user; no docker.

## Result
- Freed GPU memory: GPU0 81017→76355 MiB, GPU1 75915→11279 MiB, GPU2 77569→**0** MiB, GPU3 76603→72863, GPU4 76457→72857, GPU5 80173→76355, GPU6 0→0.
- Fully free GPUs for rendering: **2 and 6** (80 GB each); GPU 1 has ~70 GB free. GPUs 0,3,4,5 remain occupied by Kubernetes-managed DeepSeek pods (see above).
- Disk: `/localstorage` 212G used → 510M used (df before/after in du-before.txt / deleted-paths.txt). Root fs unchanged (k8s emptyDir weights not removable without controller access).
