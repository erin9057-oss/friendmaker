#include "usb_controller_transport.h"
#include "config.h"

// 构造函数
UsbControllerTransport::UsbControllerTransport() : gamepad_() {}

void UsbControllerTransport::begin() {
  // 启动 USB 虚拟游戏手柄
  gamepad_.begin();
  USB.begin(); // 启动底层 USB 堆栈
}

void UsbControllerTransport::applyButtonsToGamepad(uint32_t buttonsMask) {
  // 清除所有当前按键状态
  gamepad_.releaseAll();

  // 根据掩码映射并按下对应的按键
  // 注意：这里的 BUTTON_A 等宏是 USBHIDGamepad 库自带的
  if (buttonsMask & controllerButtonMask(ControllerButton::A)) gamepad_.pressButton(BUTTON_A);
  if (buttonsMask & controllerButtonMask(ControllerButton::B)) gamepad_.pressButton(BUTTON_B);
  if (buttonsMask & controllerButtonMask(ControllerButton::X)) gamepad_.pressButton(BUTTON_X);
  if (buttonsMask & controllerButtonMask(ControllerButton::Y)) gamepad_.pressButton(BUTTON_Y);
  if (buttonsMask & controllerButtonMask(ControllerButton::L)) gamepad_.pressButton(BUTTON_L1);
  if (buttonsMask & controllerButtonMask(ControllerButton::R)) gamepad_.pressButton(BUTTON_R1);
  if (buttonsMask & controllerButtonMask(ControllerButton::ZL)) gamepad_.pressButton(BUTTON_L2);
  if (buttonsMask & controllerButtonMask(ControllerButton::ZR)) gamepad_.pressButton(BUTTON_R2);
  
  // Plus, Minus, Home, Capture 等特殊按键映射 (需根据库的具体定义微调，这里用通用按键代替)
  if (buttonsMask & controllerButtonMask(ControllerButton::Plus)) gamepad_.pressButton(BUTTON_START);
  if (buttonsMask & controllerButtonMask(ControllerButton::Minus)) gamepad_.pressButton(BUTTON_SELECT);
  if (buttonsMask & controllerButtonMask(ControllerButton::Home)) gamepad_.pressButton(BUTTON_MODE); 
  // if (buttonsMask & controllerButtonMask(ControllerButton::Capture)) ...

  // 映射 D-Pad
  if (buttonsMask & controllerButtonMask(ControllerButton::DpadUp)) gamepad_.setHat(HAT_UP);
  else if (buttonsMask & controllerButtonMask(ControllerButton::DpadDown)) gamepad_.setHat(HAT_DOWN);
  else if (buttonsMask & controllerButtonMask(ControllerButton::DpadLeft)) gamepad_.setHat(HAT_LEFT);
  else if (buttonsMask & controllerButtonMask(ControllerButton::DpadRight)) gamepad_.setHat(HAT_RIGHT);
  else gamepad_.setHat(HAT_CENTER);

  // 发送状态更新
  gamepad_.sendReport();
}

void UsbControllerTransport::pressButtons(
    uint32_t buttonsMask, uint16_t holdMs, uint16_t settleMs) {
  
  applyButtonsToGamepad(buttonsMask);
  delay(holdMs);
  
  // 松开所有按键并恢复摇杆居中
  gamepad_.releaseAll();
  gamepad_.setHat(HAT_CENTER);
  gamepad_.setAxes(0, 0, 0, 0); 
  gamepad_.sendReport();
  
  delay(settleMs);
}

void UsbControllerTransport::moveDirection(
    int x, int y, uint16_t holdMs, uint16_t settleMs) {
  
  // USBHIDGamepad 通常期望摇杆值在 -127 到 127 之间
  // 我们将输入的 x, y (-1, 0, 1) 映射到这个范围
  int mappedX = x * 127;
  int mappedY = y * 127;

  // 设置左摇杆 (假设只操作左摇杆，右摇杆 Z/RZ 保持 0)
  gamepad_.setAxes(mappedX, mappedY, 0, 0);
  gamepad_.sendReport();
  
  delay(holdMs);
  
  // 恢复居中
  gamepad_.setAxes(0, 0, 0, 0);
  gamepad_.sendReport();
  
  delay(settleMs);
}

bool UsbControllerTransport::resetConnection() {
  // USB 有线连接通常不需要像蓝牙那样重新连接，这里直接返回 true
  return true; 
}

void UsbControllerTransport::printStatus(Print &output) const {
  output.print("INFO transport=");
  output.println(name());
  output.println("INFO bt_mode=usb_wired");
  output.println("INFO connected=true"); // 简化处理，假设一直连接
}

const char *UsbControllerTransport::name() const { 
  return "usb_hid"; 
}
