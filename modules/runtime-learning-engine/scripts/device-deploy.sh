#!/bin/bash
# Phase 3.1: Device Validation Deployment Script
# Quick reference for deploying engine to Android 10+ device

set -e

DEVICE_IP="${DEVICE_IP:-127.0.0.1}"
FRIDA_PORT="${FRIDA_PORT:-27042}"
APP_NAME="${APP_NAME:-com.example.testapp}"

echo "========================================"
echo "Phase 3.1: Device Validation Deployment"
echo "========================================"
echo ""

echo "[1/3] Verifying device connection..."
adb devices | grep -E "device$|emulator$" | head -1

echo ""
echo "[2/3] Getting app PID..."
APP_PID=$(adb shell pidof "$APP_NAME" 2>/dev/null || echo "")

if [ -z "$APP_PID" ]; then
  echo "Starting app: adb shell am start -n ${APP_NAME}/.MainActivity"
  adb shell am start -n "${APP_NAME}/.MainActivity" 2>/dev/null || true
  sleep 3
  APP_PID=$(adb shell pidof "$APP_NAME" 2>/dev/null)
fi

echo "App PID: $APP_PID"

echo ""
echo "[3/3] Injection command:"
echo ""
echo "frida -H $DEVICE_IP:$FRIDA_PORT -p $APP_PID -l modules/runtime-learning-engine/dist/index.js"
echo ""
echo "After injection, verify:"
echo "  adb shell ls /data/local/tmp/frida-learning/"
echo ""
