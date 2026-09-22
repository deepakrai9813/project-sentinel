#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "  Project Sentinel - Healing Primary API                 "
echo "=========================================================="

BASE_URL="http://localhost:8474/proxies/primary_api/toxics"

echo "\n[+] Removing latency toxic..."
curl -s -X DELETE "$BASE_URL/latency_chaos" || true

echo "\n[+] Removing packet loss toxic..."
curl -s -X DELETE "$BASE_URL/loss_chaos" || true

echo "\n=========================================================="
echo " Primary API Restored to Healthy State!"
echo " Watch the Circuit Breaker transition:"
echo " OPEN -> HALF-OPEN (Testing probe) -> CLOSED (Recovered)"
echo " Dashboard: http://localhost:3000"
echo "=========================================================="
