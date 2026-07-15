// Link stubs for units excluded from the web build.

#include "network/UsbSerialFileTransfer.h"

// Desktop simulator smoke harness — not used in browser.
void runSimulatorSmokeTestTick() {}

// USB serial file transfer is device-only; never triggers in browser.
namespace UsbSerialFileTransfer {
ProcessResult process(bool /*fileTransferAllowed*/) { return ProcessResult::None; }
} // namespace UsbSerialFileTransfer
