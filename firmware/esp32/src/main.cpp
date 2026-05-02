#include <Arduino.h>
#include <WiFi.h>

#include "config.h"
#include "usb_controller_transport.h" 
#include "controller.h"
#include "protocol.h"

namespace {

struct SequencedFrame {
  String sessionId;
  uint32_t sequence = 0;
  String command;
};

struct SequencedCommandCache {
  bool hasSession = false;
  String sessionId;
  uint32_t lastSequence = 0;
  String lastCommand;
  String lastAckLine;
};

UsbControllerTransport usbTransport;
ControllerTransport &transport = usbTransport;
SwitchController controller(transport);
SequencedCommandCache sequencedCommandCache;

// ==========================================
// 【网络配置】修改为你的手机热点名称和密码
// ==========================================
const char* ssid = "REDACTED_WIFI_SSID";
const char* password = "REDACTED_WIFI_PASSWORD";
WiFiServer server(8080);
WiFiClient client;

bool isHexSessionId(const String &value) {
  if (value.length() != 8) return false;
  for (size_t index = 0; index < value.length(); index += 1) {
    const char c = value.charAt(index);
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
  }
  return true;
}

bool parseSequenceToken(const String &value, uint32_t &sequence) {
  if (value.length() == 0) return false;
  uint32_t parsed = 0;
  for (size_t index = 0; index < value.length(); index += 1) {
    const char c = value.charAt(index);
    if (c < '0' || c > '9') return false;
    const uint32_t digit = static_cast<uint32_t>(c - '0');
    if (parsed > (UINT32_MAX - digit) / 10) return false;
    parsed = parsed * 10 + digit;
  }
  if (parsed == 0) return false;
  sequence = parsed;
  return true;
}

bool parseSequencedFrame(const String &line, SequencedFrame &frame) {
  if (!line.startsWith("SEQ ")) return false;
  const int firstSpace = line.indexOf(' ');
  const int secondSpace = line.indexOf(' ', firstSpace + 1);
  const int thirdSpace = line.indexOf(' ', secondSpace + 1);
  if (secondSpace < 0 || thirdSpace < 0) return false;

  String sessionId = line.substring(firstSpace + 1, secondSpace);
  String sequenceToken = line.substring(secondSpace + 1, thirdSpace);
  String command = line.substring(thirdSpace + 1);
  command.trim();

  if (!isHexSessionId(sessionId) || command.length() == 0) return false;

  uint32_t sequence = 0;
  if (!parseSequenceToken(sequenceToken, sequence)) return false;

  sessionId.toLowerCase();
  frame.sessionId = sessionId;
  frame.sequence = sequence;
  frame.command = command;
  return true;
}

String makeOkAck(const SequencedFrame &frame) {
  return "OK " + frame.sessionId + " " + String(frame.sequence);
}

String makeErrorAck(const SequencedFrame &frame, const String &message) {
  return "ERR " + frame.sessionId + " " + String(frame.sequence) + " " + message;
}

bool validateSequencedFrame(const SequencedFrame &frame, String &ackLine) {
  if (!sequencedCommandCache.hasSession || sequencedCommandCache.sessionId != frame.sessionId) {
    if (frame.sequence != 1) {
      ackLine = makeErrorAck(frame, "sequence expected 1 for new session");
      return false;
    }
    sequencedCommandCache.hasSession = true;
    sequencedCommandCache.sessionId = frame.sessionId;
    sequencedCommandCache.lastSequence = 0;
    sequencedCommandCache.lastCommand = "";
    sequencedCommandCache.lastAckLine = "";
    return true;
  }
  if (frame.sequence == sequencedCommandCache.lastSequence) {
    if (frame.command == sequencedCommandCache.lastCommand && sequencedCommandCache.lastAckLine.length() > 0) {
      ackLine = sequencedCommandCache.lastAckLine;
      return false;
    }
    ackLine = makeErrorAck(frame, "duplicate sequence command mismatch");
    return false;
  }
  if (frame.sequence != sequencedCommandCache.lastSequence + 1) {
    ackLine = makeErrorAck(frame, "sequence expected " + String(sequencedCommandCache.lastSequence + 1));
    return false;
  }
  return true;
}

void cacheSequencedResult(const SequencedFrame &frame, const String &ackLine) {
  sequencedCommandCache.lastSequence = frame.sequence;
  sequencedCommandCache.lastCommand = frame.command;
  sequencedCommandCache.lastAckLine = ackLine;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  
  // 启动 USB 手柄功能
  controller.begin();

  // 连接手机热点
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  
  // 阻塞等待连接成功（可以通过串口监视器看状态，或者相信它能连上）
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
  
  // 在 8080 端口启动 TCP 服务器
  server.begin();
}

void loop() {
  // 检查是否有手机客户端连接
  if (!client || !client.connected()) {
    client = server.available();
    if (!client) {
      delay(10);
      return;
    }
  }

  // 读取手机发来的指令
  if (client.available()) {
    String line = client.readStringUntil('\n');
    line.trim();

    SequencedFrame frame;
    if (!parseSequencedFrame(line, frame)) {
      client.println("ERR protocol frame required");
      return;
    }

    String ackLine;
    if (!validateSequencedFrame(frame, ackLine)) {
      client.println(ackLine);
      return;
    }

    String error;
    // 这里就是调用手柄动作的地方
    const bool ok = executeCommand(frame.command, controller, error);

    if (ok) {
      ackLine = makeOkAck(frame);
      cacheSequencedResult(frame, ackLine);
      client.println(ackLine); // 把确认信息通过 Wi-Fi 发回给手机
      return;
    }

    ackLine = makeErrorAck(frame, error.length() > 0 ? error : "unknown error");
    cacheSequencedResult(frame, ackLine);
    client.println(ackLine);
  }
}
