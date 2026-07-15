// Browser stubs for host socket servers / clients excluded from the Wasm link.
// Headers come from crosspoint-simulator; this TU provides linkable no-ops.

#include "network/CrossPointWebServer.h"
#include "NetworkClient.h"
#include "WebServer.h"
#include "WebSocketsServer.h"

#include <cstring>

// ---- NetworkClient ----
struct NetworkClient::Impl {
  int fd = -1;
  explicit Impl(int f = -1) : fd(f) {}
};

NetworkClient::NetworkClient(int fd) : impl_(std::make_shared<Impl>(fd)) {}

int NetworkClient::connect(const char * /*host*/, uint16_t /*port*/) {
  return 0;
}

size_t NetworkClient::write(const uint8_t * /*buf*/, size_t /*size*/) { return 0; }

size_t NetworkClient::write(Stream & /*stream*/) { return 0; }

void NetworkClient::stop() {
  if (impl_)
    impl_->fd = -1;
}

uint8_t NetworkClient::connected() { return 0; }

// ---- WebServer ----
struct WebServer::Impl {
  int port = 0;
  HTTPUpload upload{};
  std::function<void()> notFound;
};

WebServer::WebServer(int port) : impl_(std::make_unique<Impl>()) {
  impl_->port = port;
}

WebServer::~WebServer() = default;

void WebServer::begin() {}
void WebServer::handleClient() {}
void WebServer::on(const char *, int, std::function<void()>) {}
void WebServer::on(const char *, int, std::function<void()>, std::function<void()>) {}
void WebServer::onNotFound(std::function<void()> handler) {
  if (impl_)
    impl_->notFound = std::move(handler);
}
void WebServer::collectHeaders(const char **, size_t) {}
void WebServer::stop() {}
void WebServer::addHandler(RequestHandler *) {}
void WebServer::send(int, const char *, const char *) {}
void WebServer::send_P(int, const char *, const char *, size_t) {}
void WebServer::sendHeader(const char *, const char *, bool) {}
void WebServer::sendContent(const String &) {}
void WebServer::sendContent(const char *) {}
void WebServer::setContentLength(size_t) {}
int WebServer::method() { return HTTP_GET; }
String WebServer::uri() { return String("/"); }
bool WebServer::hasArg(const char *) { return false; }
String WebServer::arg(const char *) { return String(""); }
String WebServer::arg(int) { return String(""); }
int WebServer::args() { return 0; }
String WebServer::argName(int) { return String(""); }
String WebServer::header(const char *) { return String(""); }
String WebServer::header(int) { return String(""); }
String WebServer::headerName(int) { return String(""); }
int WebServer::headers() { return 0; }
bool WebServer::hasHeader(const char *) { return false; }
String WebServer::urlDecode(const String &str) { return str; }
NetworkClient WebServer::client() { return NetworkClient(-1); }
long WebServer::clientContentLength() { return 0; }
HTTPUpload &WebServer::upload() {
  static HTTPUpload empty{};
  return impl_ ? impl_->upload : empty;
}

// ---- WebSocketsServer ----
struct WebSocketsServer::Impl {
  int port = 0;
};

WebSocketsServer::WebSocketsServer(int port) : impl_(std::make_unique<Impl>()) {
  impl_->port = port;
}
WebSocketsServer::~WebSocketsServer() = default;
void WebSocketsServer::begin() {}
void WebSocketsServer::loop() {}
void WebSocketsServer::broadcastTXT(const String &) {}
void WebSocketsServer::broadcastTXT(const char *) {}
void WebSocketsServer::sendTXT(uint8_t, const String &) {}
void WebSocketsServer::sendTXT(uint8_t, const char *) {}
void WebSocketsServer::close() {}

// ---- CrossPointWebServer (device portal — not available in browser) ----
// Header lives in CrossInk; ctor/dtor/methods declared there.
// Simulator normally supplies the .cpp — we replace with no-ops.

CrossPointWebServer::CrossPointWebServer() = default;
CrossPointWebServer::~CrossPointWebServer() { stop(); }

void CrossPointWebServer::begin() {
  running = false; // never starts in browser
}

void CrossPointWebServer::stop() {
  running = false;
  server.reset();
  wsServer.reset();
}

void CrossPointWebServer::handleClient() {}

CrossPointWebServer::WsUploadStatus CrossPointWebServer::getWsUploadStatus() const {
  return {};
}
