# Simulator patches applied for WebInk

Small API additions applied under `vendor/crosspoint-simulator` so CrossInk’s
newer call sites compile on host/web:

| File | Change |
|------|--------|
| `src/HardwareSerial.h` | `setRxBufferSize` / `setTxBufferSize` no-ops |
| `src/HalStorage.h` | `installDateTimeCallback` template no-op |
| `src/WiFi.h` | 3-arg `disconnect` returning `bool` |
| `src/freertos/semphr.h` | `vSemaphoreDelete` |

Re-apply with `scripts/patch_simulator.sh` after submodule updates if needed.
