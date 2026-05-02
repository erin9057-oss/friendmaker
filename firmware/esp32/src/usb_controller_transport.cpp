#include "usb_controller_transport.h"

#include "config.h"
#include "USB.h"
#include "USBHID.h"

// Switch-compatible HORI Pokken-style USB HID report descriptor.
// The input report is 8 bytes:
//   16 button bits, 4-bit hat, 4-bit padding, 4 axes, 1 trailing constant byte.
static const uint8_t switch_report_descriptor[] = {
    0x05, 0x01,        // Usage Page (Generic Desktop)
    0x09, 0x05,        // Usage (Game Pad)
    0xA1, 0x01,        // Collection (Application)
    0x15, 0x00,        // Logical Minimum (0)
    0x25, 0x01,        // Logical Maximum (1)
    0x35, 0x00,        // Physical Minimum (0)
    0x45, 0x01,        // Physical Maximum (1)
    0x75, 0x01,        // Report Size (1)
    0x95, 0x10,        // Report Count (16)
    0x05, 0x09,        // Usage Page (Button)
    0x19, 0x01,        // Usage Minimum (Button 1)
    0x29, 0x10,        // Usage Maximum (Button 16)
    0x81, 0x02,        // Input (Data, Variable, Absolute)

    0x05, 0x01,        // Usage Page (Generic Desktop)
    0x25, 0x07,        // Logical Maximum (7)
    0x46, 0x3B, 0x01,  // Physical Maximum (315)
    0x75, 0x04,        // Report Size (4)
    0x95, 0x01,        // Report Count (1)
    0x65, 0x14,        // Unit (English Rotation, Degrees)
    0x09, 0x39,        // Usage (Hat switch)
    0x81, 0x42,        // Input (Data, Variable, Absolute, Null State)

    0x65, 0x00,        // Unit (None)
    0x95, 0x01,        // Report Count (1)
    0x81, 0x01,        // Input (Constant, Array, Absolute) - 4-bit padding

    0x26, 0xFF, 0x00,  // Logical Maximum (255)
    0x46, 0xFF, 0x00,  // Physical Maximum (255)
    0x09, 0x30,        // Usage (X)
    0x09, 0x31,        // Usage (Y)
    0x09, 0x32,        // Usage (Z)
    0x09, 0x35,        // Usage (Rz)
    0x75, 0x08,        // Report Size (8)
    0x95, 0x04,        // Report Count (4)
    0x81, 0x02,        // Input (Data, Variable, Absolute)

    0x75, 0x08,        // Report Size (8)
    0x95, 0x01,        // Report Count (1)
    0x81, 0x01,        // Input (Constant, Array, Absolute) - trailing padding byte
    0xC0               // End Collection
};

struct SwitchReport {
  uint16_t buttons;
  uint8_t hat;
  uint8_t lx;
  uint8_t ly;
  uint8_t rx;
  uint8_t ry;
  uint8_t vendor;
} __attribute__((packed));

static_assert(sizeof(SwitchReport) == 8, "Switch USB report must stay 8 bytes");

class SwitchUSBGamepad : public USBHIDDevice {
 private:
  USBHID hid_;
  SwitchReport report_;
  bool lastSendOk_ = false;

 public:
  SwitchUSBGamepad() {
    static bool initialized = false;
    if (!initialized) {
      hid_.addDevice(this, sizeof(switch_report_descriptor));
      initialized = true;
    }
    resetReport();
  }

  void begin() { hid_.begin(); }

  uint16_t _onGetDescriptor(uint8_t *buffer) override {
    memcpy(buffer, switch_report_descriptor, sizeof(switch_report_descriptor));
    return sizeof(switch_report_descriptor);
  }

  void resetReport() {
    report_.buttons = 0;
    report_.hat = 8;
    report_.lx = 128;
    report_.ly = 128;
    report_.rx = 128;
    report_.ry = 128;
    report_.vendor = 0;
  }

  void setButton(uint16_t bitmask) { report_.buttons |= bitmask; }

  void setHat(uint8_t hat) { report_.hat = hat; }

  void setAxes(uint8_t lx, uint8_t ly) {
    report_.lx = lx;
    report_.ly = ly;
  }

  bool sendReport() {
    lastSendOk_ = hid_.SendReport(0, &report_, sizeof(SwitchReport));
    if (!lastSendOk_) {
      Serial.println("WARN usb_hid_send_failed");
    }
    return lastSendOk_;
  }

  bool lastSendOk() const { return lastSendOk_; }
};

SwitchUSBGamepad switchPad;

UsbControllerTransport::UsbControllerTransport() {}

void UsbControllerTransport::begin() {
  // HORI Pokken Controller VID/PID used by the Switch wired controller path.
  USB.VID(0x0F0D);
  USB.PID(0x0092);
  USB.manufacturerName("HORI CO.,LTD.");
  USB.productName("POKKEN CONTROLLER");
  USB.usbClass(0);
  USB.usbSubClass(0);
  USB.usbProtocol(0);

  switchPad.begin();
  USB.begin();
  switchPad.resetReport();
  switchPad.sendReport();
}

void UsbControllerTransport::applyButtonsToGamepad(uint32_t buttonsMask) {
  switchPad.resetReport();

  uint16_t b = 0;
  if (buttonsMask & controllerButtonMask(ControllerButton::Y)) b |= 0x0001;
  if (buttonsMask & controllerButtonMask(ControllerButton::B)) b |= 0x0002;
  if (buttonsMask & controllerButtonMask(ControllerButton::A)) b |= 0x0004;
  if (buttonsMask & controllerButtonMask(ControllerButton::X)) b |= 0x0008;
  if (buttonsMask & controllerButtonMask(ControllerButton::L)) b |= 0x0010;
  if (buttonsMask & controllerButtonMask(ControllerButton::R)) b |= 0x0020;
  if (buttonsMask & controllerButtonMask(ControllerButton::ZL)) b |= 0x0040;
  if (buttonsMask & controllerButtonMask(ControllerButton::ZR)) b |= 0x0080;
  if (buttonsMask & controllerButtonMask(ControllerButton::Minus)) b |= 0x0100;
  if (buttonsMask & controllerButtonMask(ControllerButton::Plus)) b |= 0x0200;
  if (buttonsMask & controllerButtonMask(ControllerButton::LStick)) b |= 0x0400;
  if (buttonsMask & controllerButtonMask(ControllerButton::RStick)) b |= 0x0800;
  if (buttonsMask & controllerButtonMask(ControllerButton::Home)) b |= 0x1000;
  if (buttonsMask & controllerButtonMask(ControllerButton::Capture)) b |= 0x2000;
  switchPad.setButton(b);

  uint8_t hat = 8;
  if (buttonsMask & controllerButtonMask(ControllerButton::DpadUp)) {
    hat = 0;
  } else if (buttonsMask & controllerButtonMask(ControllerButton::DpadRight)) {
    hat = 2;
  } else if (buttonsMask & controllerButtonMask(ControllerButton::DpadDown)) {
    hat = 4;
  } else if (buttonsMask & controllerButtonMask(ControllerButton::DpadLeft)) {
    hat = 6;
  }
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
  output.println("INFO connected=unknown");
  output.print("INFO usb_last_send_ok=");
  output.println(switchPad.lastSendOk() ? "true" : "false");
}

const char *UsbControllerTransport::name() const { return "usb_hid"; }
