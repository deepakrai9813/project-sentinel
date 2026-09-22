#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "  Project Sentinel - Injecting Toxiproxy Chaos           "
echo "=========================================================="

BASE_URL="http://localhost:8474/proxies/primary_api/toxics"

echo "\n[+] Injecting 500ms latency into Primary API..."
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "latency_chaos",
    "type": "latency",
    "stream": "downstream",
    "toxicity": 1.0,
    "attributes": {
      "latency": 500,
      "jitter": 0
    }
  }' || true

echo "\n[+] Injecting 20% packet drop rate into Primary API..."
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "loss_chaos",
    "type": "timeout",
    "stream": "downstream",
    "toxicity": 0.2,
    "attributes": {
      "timeout": 1000
    }
  }' || true

echo "\n=========================================================="
echo " Hostile conditions active!"
echo " - Primary latency: 500ms (Limit: 200ms)"
echo " - Primary packet drop: 20%"
echo " Observe Sentinel War Room at http://localhost:3000"
echo " Circuit will trip to OPEN and route 100% to Secondary."
echo "=========================================================="
