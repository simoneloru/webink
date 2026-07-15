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

# Arduino delay: blocking sleep freezes the browser event loop under Emscripten
# and prevents cooperative FreeRTOS tasks / SDL present from running.
p = sim / "Arduino.h"
t = p.read_text()
if "emscripten_sleep" not in t:
    old = """inline void delay(unsigned long ms) {
  std::this_thread::sleep_for(std::chrono::milliseconds(ms));
}
inline void yield() { std::this_thread::yield(); }"""
    new = """inline void delay(unsigned long ms) {
#if defined(__EMSCRIPTEN__)
  // ASYNCIFY: yield to the browser (main loop, IDBFS, SDL present).
  emscripten_sleep(ms > 0 ? static_cast<int>(ms) : 0);
#else
  std::this_thread::sleep_for(std::chrono::milliseconds(ms));
#endif
}
inline void yield() {
#if defined(__EMSCRIPTEN__)
  emscripten_sleep(0);
#else
  std::this_thread::yield();
#endif
}"""
    if old not in t:
        print("WARN: Arduino.h delay pattern not found")
    else:
        if '#include <emscripten.h>' not in t:
            t = t.replace("#pragma once\n", "#pragma once\n#ifdef __EMSCRIPTEN__\n#include <emscripten.h>\n#endif\n", 1)
        p.write_text(t.replace(old, new, 1))
        print("patched Arduino.h delay/yield for Emscripten")

print("done")
PY
