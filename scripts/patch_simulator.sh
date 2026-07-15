#!/usr/bin/env bash
# Re-apply web-friendly API shims on crosspoint-simulator after submodule updates.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIM="$ROOT/vendor/crosspoint-simulator/src"

python3 - <<'PY' "$SIM"
from pathlib import Path
import sys
sim = Path(sys.argv[1])

# HardwareSerial
p = sim / "HardwareSerial.h"
t = p.read_text()
if "setRxBufferSize" not in t:
    t = t.replace(
        "  void begin(unsigned long baud) {}\n  void setTxTimeoutMs(uint32_t timeoutMs) {}",
        "  void begin(unsigned long baud) {}\n  void setTxTimeoutMs(uint32_t timeoutMs) {}\n"
        "  void setRxBufferSize(size_t) {}\n  void setTxBufferSize(size_t) {}",
    )
    p.write_text(t)
    print("patched HardwareSerial.h")

# HalStorage
p = sim / "HalStorage.h"
t = p.read_text()
if "installDateTimeCallback" not in t:
    t = t.replace(
        "  bool removeDir(const char *path);\n",
        "  bool removeDir(const char *path);\n\n"
        "  template <typename T>\n"
        "  void installDateTimeCallback(T *) {}\n",
    )
    p.write_text(t)
    print("patched HalStorage.h")

# WiFi disconnect
p = sim / "WiFi.h"
t = p.read_text()
if "timeoutMs" not in t:
    old = """  void disconnect(bool wifioff = false, bool eraseap = false) {
    (void)wifioff;
    (void)eraseap;
    currentStatus = WL_DISCONNECTED;
  }"""
    new = """  bool disconnect(bool wifioff = false, bool eraseap = false, int timeoutMs = 0) {
    (void)wifioff;
    (void)eraseap;
    (void)timeoutMs;
    currentStatus = WL_DISCONNECTED;
    return true;
  }"""
    if old not in t:
        print("WARN: WiFi disconnect pattern not found")
    else:
        p.write_text(t.replace(old, new, 1))
        print("patched WiFi.h")

# freertos
p = sim / "freertos" / "semphr.h"
t = p.read_text()
if "vSemaphoreDelete" not in t:
    p.write_text(
        t
        + "\ninline void vSemaphoreDelete(SemaphoreHandle_t sem) {\n"
        + "  if (sem)\n    delete sem;\n}\n"
    )
    print("patched freertos/semphr.h")

print("done")
PY
