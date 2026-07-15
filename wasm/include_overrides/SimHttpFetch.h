#pragma once
// Browser build: no curl/fork. Network features return empty failures.

#include <string>

namespace sim_http_fetch {

struct Response {
  int statusCode = 0;
  int curlExitCode = 0;
  std::string body;
};

inline Response get(const std::string & /*url*/) {
  Response r;
  r.statusCode = 0;
  r.curlExitCode = 127; // "command not found" stand-in
  r.body.clear();
  return r;
}

inline Response post(const std::string & /*url*/, const std::string & /*body*/,
                     const std::string & /*contentType*/ = {}) {
  return get("");
}

inline bool downloadToFile(const std::string & /*url*/, const std::string & /*path*/) {
  return false;
}

} // namespace sim_http_fetch
