#pragma once

#include "controller_transport.h"
#include <USB.h>
#include <USBHIDGamepad.h>

class UsbControllerTransport : public ControllerTransport {
 public:
  UsbControllerTransport();
  void begin() override;
  void pressButtons(uint32_t buttonsMask, uint16_t holdMs, uint16_t settleMs) override;
  void moveDirection(int x, int y, uint16_t holdMs, uint16_t settleMs) override;
  bool resetConnection() override;
  void printStatus(Print &output) const override;
  const char *name() const override;

 private:
  USBHIDGamepad gamepad_;
  
  // 将自定义的按钮掩码映射到 USBHIDGamepad 库的按钮枚举
  void applyButtonsToGamepad(uint32_t buttonsMask);
};
