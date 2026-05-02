#include "usb_controller_transport.h"
#include "config.h"
#include "USB.h"
#include "USBHID.h"

// 1. 像素级复刻：Switch 官方授权 HORI Pokken 手柄的数据结构描述符
static const uint8_t switch_report_descriptor[] = {
    0x05, 0x01, 0x09, 0x05, 0xA1, 0x01, 0x15, 0x00,
    0x25, 0x01, 0x35, 0x00, 0x45, 0x01, 0x75, 0x01,
    0x95, 0x10, 0x05, 0x09, 0x19, 0x01, 0x29, 0x10,
    0x81, 0x02, 0x05, 0x01, 0x25, 0x07, 0x46, 0x3B,
    0x01, 0x75, 0x04, 0x95, 0x01, 0x65, 0x14, 0x09,
    0x39, 0x81, 0x42, 0x65, 0x00, 0x95, 0x01, 0x81,
    0x01, 0x26, 0xFF, 0x00, 0x46, 0xFF, 0x00, 0x09,
    0x30, 0x09, 0x31, 0x09, 0x32, 0x09, 0x35, 0x75,
    0x08, 0x95, 0x04, 0x81, 0x02, 0xC0
};

// 2. 匹配描述符的数据包结构（刚好 7 个字节）
struct SwitchReport {
    uint16_t buttons;
    uint8_t hat;
    uint8_t lx;
    uint8_t ly;
    uint8_t rx;
    uint8_t ry;
} __attribute__((packed));

// 3. 我们自己手搓的纯血 Switch 专用底层 USB 驱动
class SwitchUSBGamepad : public USBHIDDevice {
private:
    USBHID hid;
    SwitchReport report;
public:
    SwitchUSBGamepad() {
        static bool initialized = false;
        if(!initialized){
            hid.addDevice(this, sizeof(switch_report_descriptor));
            initialized = true;
        }
        resetReport();
    }
    void begin() { hid.begin(); }
    uint16_t _onGetDescriptor(uint8_t* buffer) override {
        memcpy(buffer, switch_report_descriptor, sizeof(switch_report_descriptor));
        return sizeof(switch_report_descriptor);
    }
    void resetReport() {
        report.buttons = 0;
        report.hat = 8; // 8 代表十字键居中无操作
        report.lx = 128; // 128 代表摇杆居中
        report.ly = 128;
        report.rx = 128;
        report.ry = 128;
    }
    void setButton(uint16_t bitmask) { report.buttons |= bitmask; }
    void setHat(uint8_t hat) { report.hat = hat; }
    void setAxes(uint8_t lx, uint8_t ly) { report.lx = lx; report.ly = ly; }
    void sendReport() {
        hid.SendReport(0, &report, sizeof(SwitchReport));
    }
};

// 实例化我们的终极武器
SwitchUSBGamepad switchPad;

UsbControllerTransport::UsbControllerTransport() {}

void UsbControllerTransport::begin() {
  // 贴上 HORI Pokken 的假身份证
  USB.VID(0x0F0D);
  USB.PID(0x0092);
  USB.usbClass(0);
  USB.usbSubClass(0);
  USB.usbProtocol(0);

  switchPad.begin();
  USB.begin(); 
}

void UsbControllerTransport::applyButtonsToGamepad(uint32_t buttonsMask) {
  switchPad.resetReport();
  
  // 将业务逻辑的按键精准翻译成 Switch 芯片能懂的二进制位
  uint16_t b = 0;
  if (buttonsMask & controllerButtonMask(ControllerButton::Y)) b |= 0x01;
  if (buttonsMask & controllerButtonMask(ControllerButton::B)) b |= 0x02;
  if (buttonsMask & controllerButtonMask(ControllerButton::A)) b |= 0x04;
  if (buttonsMask & controllerButtonMask(ControllerButton::X)) b |= 0x08;
  if (buttonsMask & controllerButtonMask(ControllerButton::L)) b |= 0x10;
  if (buttonsMask & controllerButtonMask(ControllerButton::R)) b |= 0x20;
  if (buttonsMask & controllerButtonMask(ControllerButton::ZL)) b |= 0x40;
  if (buttonsMask & controllerButtonMask(ControllerButton::ZR)) b |= 0x80;
  if (buttonsMask & controllerButtonMask(ControllerButton::Minus)) b |= 0x100;
  if (buttonsMask & controllerButtonMask(ControllerButton::Plus)) b |= 0x200;
  if (buttonsMask & controllerButtonMask(ControllerButton::Home)) b |= 0x1000;
  switchPad.setButton(b);

  uint8_t hat = 8;
  if (buttonsMask & controllerButtonMask(ControllerButton::DpadUp)) hat = 0;
  else if (buttonsMask & controllerButtonMask(ControllerButton::DpadDown)) hat = 4;
  else if (buttonsMask & controllerButtonMask(ControllerButton::DpadLeft)) hat = 6;
  else if (buttonsMask & controllerButtonMask(ControllerButton::DpadRight)) hat = 2;
  switchPad.setHat(hat);
}

void UsbControllerTransport::pressButtons(
    uint32_t buttonsMask, uint16_t holdMs, uint16_t settleMs) {
  applyButtonsToGamepad(buttonsMask);
  switchPad.sendReport();
  delay(holdMs);
  
  switchPad.resetReport();
  switchPad.sendReport();
  delay(settleMs);
}

void UsbControllerTransport::moveDirection(
    int x, int y, uint16_t holdMs, uint16_t settleMs) {
  
  switchPad.resetReport();
  
  uint8_t lx = 128;
  uint8_t ly = 128;
  
  // 坐标系转换：-1, 0, 1 转为 Switch 的 0, 128, 255
  if (x < 0) lx = 0;
  else if (x > 0) lx = 255;
  
  if (y < 0) ly = 0; 
  else if (y > 0) ly = 255;
  
  switchPad.setAxes(lx, ly);
  switchPad.sendReport();
  delay(holdMs);
  
  switchPad.resetReport();
  switchPad.sendReport();
  delay(settleMs);
}

bool UsbControllerTransport::resetConnection() { return true; }

void UsbControllerTransport::printStatus(Print &output) const {
  output.print("INFO transport=");
  output.println(name());
  output.println("INFO bt_mode=usb_wired");
  output.println("INFO connected=true"); 
}

const char *UsbControllerTransport::name() const { 
  return "usb_hid"; 
}
