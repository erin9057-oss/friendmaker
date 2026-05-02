#include "usb_controller_transport.h"
#include "config.h"

// 构造函数
UsbControllerTransport::UsbControllerTransport() : gamepad_() {}

void UsbControllerTransport::begin() {
  // 在启动 USB 前，强制把自己的身份证改成 Switch 官方授权的 HORI Pokken 手柄
  USB.VID(0x0F0D);
  USB.PID(0x0092);
  USB.usbClass(0);
  USB.usbSubClass(0);
  USB.usbProtocol(0);

  gamepad_.begin();
  USB.begin(); 
}

void UsbControllerTransport::applyButtonsToGamepad(uint32_t buttonsMask) {
  // 定义标准按键数组，用于统一松开
  uint8_t standardButtons[] = {
    BUTTON_A, BUTTON_B, BUTTON_X, BUTTON_Y, 
    BUTTON_TL, BUTTON_TR, BUTTON_TL2, BUTTON_TR2, 
    BUTTON_START, BUTTON_SELECT, BUTTON_MODE
  };
  
  // 先松开所有常规按键
  for (uint8_t btn : standardButtons) {
    gamepad_.releaseButton(btn);
  }

  // 根据掩码映射并按下对应的按键 (适配 ESP32 的命名规范)
  if (buttonsMask & controllerButtonMask(ControllerButton::A)) gamepad_.pressButton(BUTTON_A);
  if (buttonsMask & controllerButtonMask(ControllerButton::B)) gamepad_.pressButton(BUTTON_B);
  if (buttonsMask & controllerButtonMask(ControllerButton::X)) gamepad_.pressButton(BUTTON_X);
  if (buttonsMask & controllerButtonMask(ControllerButton::Y)) gamepad_.pressButton(BUTTON_Y);
  if (buttonsMask & controllerButtonMask(ControllerButton::L)) gamepad_.pressButton(BUTTON_TL);
  if (buttonsMask & controllerButtonMask(ControllerButton::R)) gamepad_.pressButton(BUTTON_TR);
  if (buttonsMask & controllerButtonMask(ControllerButton::ZL)) gamepad_.pressButton(BUTTON_TL2);
  if (buttonsMask & controllerButtonMask(ControllerButton::ZR)) gamepad_.pressButton(BUTTON_TR2);
  
  if (buttonsMask & controllerButtonMask(ControllerButton::Plus)) gamepad_.pressButton(BUTTON_START);
  if (buttonsMask & controllerButtonMask(ControllerButton::Minus)) gamepad_.pressButton(BUTTON_SELECT);
  if (buttonsMask & controllerButtonMask(ControllerButton::Home)) gamepad_.pressButton(BUTTON_MODE); 
  
  // 映射 D-Pad
  if (buttonsMask & controllerButtonMask(ControllerButton::DpadUp)) gamepad_.hat(HAT_UP);
  else if (buttonsMask & controllerButtonMask(ControllerButton::DpadDown)) gamepad_.hat(HAT_DOWN);
  else if (buttonsMask & controllerButtonMask(ControllerButton::DpadLeft)) gamepad_.hat(HAT_LEFT);
  else if (buttonsMask & controllerButtonMask(ControllerButton::DpadRight)) gamepad_.hat(HAT_RIGHT);
  else gamepad_.hat(HAT_CENTER);
}

void UsbControllerTransport::pressButtons(
    uint32_t buttonsMask, uint16_t holdMs, uint16_t settleMs) {
  
  applyButtonsToGamepad(buttonsMask);
  delay(holdMs);
  
  // 传 0 进去，代表清空所有按键
  applyButtonsToGamepad(0); 
  // 恢复左摇杆居中
  gamepad_.leftStick(0, 0);
  
  delay(settleMs);
}

void UsbControllerTransport::moveDirection(
    int x, int y, uint16_t holdMs, uint16_t settleMs) {
  
  // USBHIDGamepad 期望摇杆值在 -127 到 127 之间
  int mappedX = x * 127;
  int mappedY = y * 127;

  // 使用 leftStick 接口
  gamepad_.leftStick(mappedX, mappedY);
  delay(holdMs);
  
  // 恢复居中
  gamepad_.leftStick(0, 0);
  delay(settleMs);
}

bool UsbControllerTransport::resetConnection() {
  return true; 
}

void UsbControllerTransport::printStatus(Print &output) const {
  output.print("INFO transport=");
  output.println(name());
  output.println("INFO bt_mode=usb_wired");
  output.println("INFO connected=true"); 
}

const char *UsbControllerTransport::name() const { 
  return "usb_hid"; 
}
