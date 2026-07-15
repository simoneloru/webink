#pragma once
// WebInk: pure C++ MD5 for Emscripten (simulator only has Apple/Linux backends).

#if !defined(__EMSCRIPTEN__) && defined(__APPLE__)
#include_next "MD5Builder_mac.h"
#elif !defined(__EMSCRIPTEN__) && defined(__linux__)
#include_next "MD5Builder_linux.h"
#else

#include <Arduino.h>
#include <cstdio>
#include <cstring>

// Compact MD5 (public-domain style implementation)
class MD5Builder {
public:
  void begin() {
    a_ = 0x67452301;
    b_ = 0xefcdab89;
    c_ = 0x98badcfe;
    d_ = 0x10325476;
    bitlen_ = 0;
    buflen_ = 0;
  }

  void add(const uint8_t *data, size_t len) {
    bitlen_ += static_cast<uint64_t>(len) * 8;
    while (len > 0) {
      size_t n = 64 - buflen_;
      if (n > len)
        n = len;
      memcpy(buf_ + buflen_, data, n);
      buflen_ += n;
      data += n;
      len -= n;
      if (buflen_ == 64) {
        transform(buf_);
        buflen_ = 0;
      }
    }
  }

  void add(const char *data) { add(reinterpret_cast<const uint8_t *>(data), strlen(data)); }
  void addHexString(const char * /*data*/) {}
  void addStream(Stream & /*stream*/, const size_t /*maxLen*/) {}

  void calculate() {
    uint8_t pad[64];
    size_t i = buflen_;
    pad[0] = 0x80;
    if (i < 56) {
      memset(pad + 1, 0, 55 - i);
      memcpy(buf_ + i, pad, 56 - i);
    } else {
      memset(pad + 1, 0, 63 - i);
      memcpy(buf_ + i, pad, 64 - i);
      transform(buf_);
      memset(buf_, 0, 56);
    }
    for (int j = 0; j < 8; j++)
      buf_[56 + j] = static_cast<uint8_t>((bitlen_ >> (8 * j)) & 0xff);
    transform(buf_);
    for (int j = 0; j < 4; j++) {
      digest_[j] = static_cast<uint8_t>((a_ >> (8 * j)) & 0xff);
      digest_[4 + j] = static_cast<uint8_t>((b_ >> (8 * j)) & 0xff);
      digest_[8 + j] = static_cast<uint8_t>((c_ >> (8 * j)) & 0xff);
      digest_[12 + j] = static_cast<uint8_t>((d_ >> (8 * j)) & 0xff);
    }
  }

  void getBytes(uint8_t *output) { memcpy(output, digest_, 16); }
  void getChars(char *output) {
    for (int i = 0; i < 16; i++)
      sprintf(output + i * 2, "%02x", digest_[i]);
    output[32] = 0;
  }
  String toString() {
    char tmp[33];
    getChars(tmp);
    return String(tmp);
  }

private:
  static uint32_t rotl(uint32_t x, uint32_t n) { return (x << n) | (x >> (32 - n)); }

  void transform(const uint8_t block[64]) {
    static const uint32_t K[64] = {
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
        0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
        0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
        0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
        0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
        0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
        0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
        0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
        0xeb86d391};
    static const uint32_t S[64] = {7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
                                   5, 9,  14, 20, 5, 9,  14, 20, 5, 9,  14, 20, 5, 9,  14, 20,
                                   4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
                                   6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21};
    uint32_t M[16];
    for (int i = 0; i < 16; i++)
      M[i] = static_cast<uint32_t>(block[i * 4]) | (static_cast<uint32_t>(block[i * 4 + 1]) << 8) |
             (static_cast<uint32_t>(block[i * 4 + 2]) << 16) |
             (static_cast<uint32_t>(block[i * 4 + 3]) << 24);
    uint32_t A = a_, B = b_, C = c_, D = d_;
    for (uint32_t i = 0; i < 64; i++) {
      uint32_t F, g;
      if (i < 16) {
        F = (B & C) | ((~B) & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | ((~D) & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | (~D));
        g = (7 * i) % 16;
      }
      F = F + A + K[i] + M[g];
      A = D;
      D = C;
      C = B;
      B = B + rotl(F, S[i]);
    }
    a_ += A;
    b_ += B;
    c_ += C;
    d_ += D;
  }

  uint32_t a_ = 0, b_ = 0, c_ = 0, d_ = 0;
  uint64_t bitlen_ = 0;
  uint8_t buf_[64]{};
  size_t buflen_ = 0;
  uint8_t digest_[16]{};
};

#endif
