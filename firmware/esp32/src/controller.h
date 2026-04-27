#pragma once

#include <Arduino.h>

#include "controller_transport.h"

class SwitchController {
 public:
  explicit SwitchController(ControllerTransport &transport);

  void begin();
  void moveHome();
  void moveCursor(int dx, int dy);
  void drawStroke();
  void pressButton(ControllerButton button);
  void holdButton(ControllerButton button, uint16_t holdMs);
  void tapButton(ControllerButton button, uint16_t count);
  void pressButtons(uint32_t buttonsMask);
  void selectColor(int index);
  void configurePaletteSlot(int index, uint8_t red, uint8_t green, uint8_t blue);
  bool resetBluetooth();
  void pause();
  void resume();
  void end();
  void printTransportStatus(Print &output) const;
  const char *transportName() const;

 private:
  ControllerTransport &transport_;
  bool paused_ = false;

  void waitUntilReady() const;
};
